import express from "express";
import crypto from "node:crypto";
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { settings } from "./settings.js";

if (!settings.pairingToken) {
  console.error("PAIRING_TOKEN belum disetel. Jalankan perintah TOKEN SITUS dari README.");
  process.exit(1);
}

const app = express();
app.use(express.json());
let sock;
let latestPairingCode = "";
let connectionState = "Belum terhubung";

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${settings.botName} - Login</title>
<style>body{font:16px system-ui;background:#101827;color:#eef2ff;display:grid;place-items:center;min-height:100vh;margin:0}.card{background:#1c293d;padding:28px;border-radius:18px;width:min(90%,420px)}input,button{box-sizing:border-box;width:100%;padding:13px;margin:8px 0;border-radius:9px;border:0}button{background:#22c55e;color:#06210f;font-weight:700}small{color:#aab8ce}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<div class="card"><h2>🤖 ${settings.botName}</h2><p>Login halaman menggunakan TOKEN SITUS dari terminal.</p>
<input id="token" type="password" placeholder="TOKEN SITUS" autocomplete="off">
<input id="phone" inputmode="numeric" placeholder="Nomor WhatsApp, contoh 62812xxxx">
<button onclick="pair()">Minta kode pairing</button><p id="status">Status: ${connectionState}</p><pre id="result"></pre>
<small>Jangan bagikan TOKEN SITUS atau kode pairing kepada siapa pun.</small></div>
<script>
async function pair(){const token=document.querySelector('#token').value;const phone=document.querySelector('#phone').value;const out=document.querySelector('#result');out.textContent='Memproses...';try{const r=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({phone})});const d=await r.json();out.textContent=d.code||d.error||'Selesai';}catch(e){out.textContent=e.message}}
</script></html>`);
});

app.post("/api/pair", async (req, res) => {
  if (!safeEqual(req.headers.authorization?.replace(/^Bearer\s+/i, ""), settings.pairingToken)) {
    return res.status(401).json({ error: "TOKEN SITUS salah." });
  }
  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  if (!/^\d{10,15}$/.test(phone)) return res.status(400).json({ error: "Masukkan nomor WhatsApp dengan kode negara, angka saja." });
  try {
    if (!sock) await startWhatsApp();
    latestPairingCode = await sock.requestPairingCode(phone);
    res.json({ code: latestPairingCode });
  } catch (error) {
    console.error("Pairing error:", error);
    res.status(500).json({ error: "Gagal membuat kode pairing. Periksa log terminal lalu coba lagi." });
  }
});

app.get("/api/status", (req, res) => {
  if (!safeEqual(req.headers.authorization?.replace(/^Bearer\s+/i, ""), settings.pairingToken)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json({ status: connectionState });
});

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./database/session");
  sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["KyassasinDev", "Chrome", "1.0.0"]
  });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection) connectionState = connection;
    if (connection === "close") {
      sock = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => startWhatsApp().catch(console.error), 3000);
      } else {
        connectionState = "Logout - hapus session untuk menautkan ulang";
      }
    }
    if (connection === "open") console.log("WhatsApp terhubung.");
  });
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const message of messages) {
      if (!message.message || message.key.fromMe) continue;
      // Fitur perintah akan ditambahkan setelah daftar fitur dari video tersedia.
    }
  });
}

app.listen(settings.port, "0.0.0.0", () => {
  console.log(`${settings.botName} berjalan pada port ${settings.port}`);
  console.log("Buka halaman web Codespaces dan masukkan TOKEN SITUS.");
});
