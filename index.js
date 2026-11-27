import express from "express";
import fs from "node:fs";
import path from "node:path";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage
} from "@whiskeysockets/baileys";
import pino from "pino";
import { settings } from "./settings.js";

const DATA_DIR = "./database";
const SESSION_DIR = path.join(DATA_DIR, "session");
const CONSENT_FILE = path.join(DATA_DIR, "consent.json");
const CONFIG_FILE = path.join(DATA_DIR, "bot-config.json");
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CONSENT_FILE)) fs.writeFileSync(CONSENT_FILE, JSON.stringify({ subscribers: [] }, null, 2));
if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify({ intervalMs: 10000 }, null, 2));

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
};
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const digits = (value) => String(value || "").replace(/\D/g, "");
const ownerJid = `${digits(settings.ownerNumber)}@s.whatsapp.net`;
const isOwner = (jid) => digits(jid?.split("@")[0]) === digits(settings.ownerNumber);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let sock = null;
let starting = null;
let connectionState = "Belum terhubung";
let reconnectTimer = null;

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${settings.botName} - Login</title>
<style>
*{box-sizing:border-box}body{font:16px system-ui;background:#101827;color:#eef2ff;display:grid;place-items:center;min-height:100vh;margin:0;padding:18px}
.card{background:#1c293d;padding:28px;border-radius:18px;width:min(100%,430px);box-shadow:0 18px 55px #0005}
input,button{width:100%;padding:14px;margin:8px 0;border-radius:9px;border:1px solid #34445d;background:#101827;color:#eef2ff}
button{background:#22c55e;color:#06210f;font-weight:800;border:0;cursor:pointer}small{color:#aab8ce}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#86efac}
</style>
<div class="card"><h2>🤖 ${settings.botName}</h2><p>Masukkan nomor WhatsApp dengan kode negara untuk mendapatkan kode pairing.</p>
<input id="phone" inputmode="numeric" placeholder="Nomor WhatsApp, contoh 62812xxxx">
<button onclick="pair()">Minta kode pairing</button><p id="status">Status: ${connectionState}</p><pre id="result"></pre>
<small>Masukkan kode di WhatsApp &gt; Perangkat tertaut &gt; Tautkan perangkat &gt; Tautkan dengan nomor telepon. Jangan bagikan kode pairing kepada siapa pun.</small></div>
<script>
async function pair(){const phone=document.querySelector('#phone').value;const out=document.querySelector('#result');out.textContent='Memproses...';try{const r=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})});const d=await r.json();out.textContent=d.code||d.error||'Selesai';}catch(e){out.textContent=e.message}}
</script></html>`);
});

const pairAttempts = new Map();
app.post("/api/pair", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (pairAttempts.get(ip) || []).filter(time => now - time < 10 * 60 * 1000);
  if (recent.length >= 5) return res.status(429).json({ error: "Terlalu banyak permintaan. Coba lagi dalam 10 menit." });
  recent.push(now);
  pairAttempts.set(ip, recent);
  const phone = digits(req.body?.phone);
  if (!/^\\d{10,15}$/.test(phone)) return res.status(400).json({ error: "Masukkan nomor dengan kode negara, angka saja." });
  try {
    await startWhatsApp();
    if (sock?.user) return res.status(409).json({ error: "WhatsApp sudah tertaut." });
    const code = await sock.requestPairingCode(phone);
    res.json({ code });
  } catch (error) {
    console.error("Pairing error:", error);
    res.status(500).json({ error: "Gagal membuat kode pairing. Periksa log terminal." });
  }
});

app.get("/api/status", (_req, res) => {
  res.json({ status: connectionState, connected: Boolean(sock?.user) });
});

function messageText(message) {
  const msg = message.message || {};
  return msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.buttonsResponseMessage?.selectedButtonId ||
    msg.listResponseMessage?.singleSelectReply?.selectedRowId || "";
}

async function isGroupAdmin(chat, sender) {
  if (!chat.endsWith("@g.us")) return false;
  const metadata = await sock.groupMetadata(chat);
  const participant = metadata.participants.find(p => p.id === sender);
  return Boolean(participant?.admin);
}

function getSubscribers() {
  const data = readJson(CONSENT_FILE, { subscribers: [] });
  return Array.isArray(data.subscribers) ? data.subscribers : [];
}
function setSubscribers(subscribers) {
  writeJson(CONSENT_FILE, { subscribers: [...new Set(subscribers)] });
}
function getInterval() {
  const value = Number(readJson(CONFIG_FILE, { intervalMs: 10000 }).intervalMs);
  return Number.isFinite(value) && value >= 10000 ? value : 10000;
}

async function sendToOptedIn(text, imageBuffer = null) {
  const recipients = getSubscribers();
  let sent = 0, failed = 0;
  for (const number of recipients) {
    try {
      const jid = `${digits(number)}@s.whatsapp.net`;
      if (imageBuffer) await sock.sendMessage(jid, { image: imageBuffer, caption: text });
      else await sock.sendMessage(jid, { text });
      sent++;
    } catch (error) {
      failed++;
      console.error("Gagal mengirim ke salah satu penerima:", error?.message || error);
    }
    await sleep(getInterval());
  }
  return { total: recipients.length, sent, failed };
}

async function handleCommand(message) {
  if (!message.message || message.key.fromMe) return;
  const chat = message.key.remoteJid;
  if (chat === "status@broadcast") return;
  const sender = message.key.participant || chat;
  const body = messageText(message).trim();
  if (!body.startsWith("#")) return;
  const [rawCommand, ...rest] = body.slice(1).split(/\s+/);
  const command = (rawCommand || "").toLowerCase();
  const text = rest.join(" ").trim();
  const reply = (value) => sock.sendMessage(chat, { text: value }, { quoted: message });
  const owner = isOwner(sender);

  if (command === "menu" || command === "help") {
    return reply(`╭─「 ${settings.botName} 」
│ #optin — setuju menerima pesan bot (chat pribadi)
│ #optout — berhenti menerima pesan bot
│ #statusoptin — cek status persetujuan
│ #getidgroup — tampilkan ID grup
│ #listgroup — daftar grup (owner)
│ #pushkontak <pesan> — kirim ke penerima opt-in (owner)
│ #pushimg <caption> — kirim gambar reply ke penerima opt-in (owner)
│ #savekontak — ekspor kontak opt-in (owner)
│ #pushid <idgrup>|<pesan> — kirim ke grup tujuan (owner)
│ #setinterval <ms> — jeda minimal 10000 (owner)
│ #cekinterval — cek jeda
╰────────────
Pesan pribadi massal hanya dikirim kepada nomor yang sudah opt-in.`);
  }

  if (command === "optin") {
    if (chat.endsWith("@g.us")) return reply("Kirim #optin melalui chat pribadi bot agar persetujuan tercatat.");
    const number = digits(sender.split("@")[0]);
    setSubscribers([...getSubscribers(), number]);
    return reply("Persetujuan dicatat. Kamu sekarang dapat menerima pengumuman dari bot. Kirim #optout kapan saja untuk berhenti.");
  }
  if (command === "optout") {
    const number = digits(sender.split("@")[0]);
    setSubscribers(getSubscribers().filter(item => digits(item) !== number));
    return reply("Kamu sudah berhenti berlangganan pesan bot.");
  }
  if (command === "statusoptin") {
    const subscribed = getSubscribers().includes(digits(sender.split("@")[0]));
    return reply(subscribed ? "Status: sudah opt-in." : "Status: belum opt-in.");
  }
  if (command === "getidgroup") {
    if (!chat.endsWith("@g.us")) return reply("Gunakan perintah ini di dalam grup.");
    return reply(`ID Grup: ${chat}`);
  }
  if (command === "listgroup") {
    if (!owner) return reply("Perintah khusus owner.");
    const groups = await sock.groupFetchAllParticipating();
    const rows = Object.values(groups).map((g, i) => `${i + 1}. ${g.subject}\nID: ${g.id}\nAnggota: ${g.participants.length}`);
    return reply(rows.length ? rows.join("\n\n") : "Bot belum bergabung ke grup.");
  }
  if (command === "cekinterval") return reply(`Interval saat ini: ${getInterval()} ms`);
  if (command === "setinterval") {
    if (!owner) return reply("Perintah khusus owner.");
    const ms = Number(text);
    if (!Number.isInteger(ms) || ms < 10000) return reply("Contoh: #setinterval 10000 (minimum 10000 ms).");
    writeJson(CONFIG_FILE, { intervalMs: ms });
    return reply(`Interval berhasil diatur: ${ms} ms`);
  }
  if (command === "pushkontak") {
    if (!owner) return reply("Perintah khusus owner.");
    if (!text) return reply("Contoh: #pushkontak Halo, ini informasi terbaru.");
    const result = await sendToOptedIn(text);
    return reply(`Selesai. Penerima opt-in: ${result.total}\nTerkirim: ${result.sent}\nGagal: ${result.failed}`);
  }
  if (command === "pushimg") {
    if (!owner) return reply("Perintah khusus owner.");
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted?.imageMessage) return reply("Reply sebuah gambar dengan caption: #pushimg Teks caption");
    if (!text) return reply("Tambahkan caption setelah #pushimg.");
    try {
      const image = await downloadMediaMessage({ key: message.message.extendedTextMessage.contextInfo.stanzaId ? { id: message.message.extendedTextMessage.contextInfo.stanzaId, remoteJid: chat, participant: sender } : message.key, message: quoted }, "buffer", {}, { logger: pino({ level: "silent" }) });
      const result = await sendToOptedIn(text, image);
      return reply(`Selesai. Penerima opt-in: ${result.total}\nTerkirim: ${result.sent}\nGagal: ${result.failed}`);
    } catch (error) {
      console.error(error);
      return reply("Gagal membaca gambar. Coba kirim ulang gambar lalu reply dengan perintah #pushimg.");
    }
  }
  if (command === "savekontak") {
    if (!owner) return reply("Perintah khusus owner.");
    const numbers = getSubscribers();
    if (!numbers.length) return reply("Belum ada pengguna yang opt-in.");
    const vcard = numbers.map(number => [
      "BEGIN:VCARD", "VERSION:3.0", `FN:KyassasinDev ${number}`,
      `TEL;TYPE=CELL;waid=${number}:+${number}`, "END:VCARD", ""
    ].join("\n")).join("");
    return sock.sendMessage(chat, {
      document: Buffer.from(vcard, "utf8"),
      mimetype: "text/vcard",
      fileName: "kontak-opt-in.vcf",
      caption: `Kontak dengan persetujuan: ${numbers.length}`
    }, { quoted: message });
  }
  if (command === "pushid") {
    if (!owner) return reply("Perintah khusus owner.");
    const separator = text.indexOf("|");
    if (separator < 1 || !text.slice(separator + 1).trim()) return reply("Contoh: #pushid 123456789@g.us|Pengumuman grup");
    const groupId = text.slice(0, separator).trim();
    const announcement = text.slice(separator + 1).trim();
    if (!groupId.endsWith("@g.us")) return reply("ID grup tidak valid.");
    await sock.sendMessage(groupId, { text: announcement });
    return reply("Pengumuman berhasil dikirim ke grup tujuan.");
  }
  if (command === "inspeksi") {
    if (!owner) return reply("Perintah khusus owner.");
    const match = text.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
    if (!match) return reply("Contoh: #inspeksi https://chat.whatsapp.com/KODEUNDANGAN");
    try {
      const info = await sock.groupGetInviteInfo(match[1]);
      return reply(`Nama grup: ${info.subject}\nID: ${info.id}\nJumlah anggota: ${info.size ?? "tidak tersedia"}\nDibuat: ${info.creation ? new Date(info.creation * 1000).toLocaleString("id-ID") : "tidak tersedia"}`);
    } catch {
      return reply("Tidak bisa membaca info tautan. Pastikan tautan undangan masih berlaku.");
    }
  }
}

async function startWhatsApp() {
  if (sock) return;
  if (starting) return starting;
  starting = (async () => {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      browser: ["KyassasinDev", "Chrome", "1.0.0"]
    });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
      if (connection) connectionState = connection;
      if (connection === "open") console.log("WhatsApp terhubung sebagai", sock.user?.id);
      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        sock = null;
        if (code === DisconnectReason.loggedOut) {
          connectionState = "Logout. Hapus database/session untuk menautkan ulang.";
          return;
        }
        if (!reconnectTimer) reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          starting = null;
          startWhatsApp().catch(console.error);
        }, 3000);
      }
    });
    sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const message of messages) {
        try { await handleCommand(message); }
        catch (error) {
          console.error("Command error:", error);
          if (message.key?.remoteJid) await sock?.sendMessage(message.key.remoteJid, { text: "Terjadi kesalahan saat menjalankan perintah." }).catch(() => {});
        }
      }
    });
  })();
  try { await starting; } finally { starting = null; }
}

app.listen(settings.port, "0.0.0.0", () => {
  console.log(`${settings.botName} berjalan pada port ${settings.port}`);
  console.log("Buka halaman forwarded port, masukkan nomor WhatsApp, lalu gunakan kode pairing.");
});
