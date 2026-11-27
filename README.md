# KyassasinDevPush

Bot WhatsApp Node.js 20+ dengan halaman login **TOKEN SITUS** dan WhatsApp **Pairing Code**.

## Menjalankan di GitHub Codespaces

```bash
npm install
export PAIRING_TOKEN="$(openssl rand -hex 24)"
printf 'TOKEN SITUS: %s\n' "$PAIRING_TOKEN"
npm start
```

Buka tab **Ports**, pastikan port 3000 tersedia, lalu buka alamat forwarded port. Masukkan TOKEN SITUS dan nomor WhatsApp dengan kode negara (angka saja), misalnya 62812xxxx.

## Menu perintah

| Perintah | Fungsi |
|---|---|
| `#menu` | Menampilkan bantuan |
| `#optin` | Setuju menerima pengumuman bot (chat pribadi) |
| `#optout` | Berhenti menerima pengumuman |
| `#statusoptin` | Cek status persetujuan |
| `#pushkontak <pesan>` | Kirim pesan hanya ke nomor yang sudah opt-in (owner) |
| `#pushimg <caption>` | Reply gambar lalu kirim ke nomor opt-in (owner) |
| `#savekontak` | Ekspor kontak opt-in ke VCF (owner) |
| `#pushid <idgrup>|<pesan>` | Kirim pengumuman ke grup tujuan (owner) |
| `#listgroup` | Daftar grup bot (owner) |
| `#getidgroup` | Tampilkan ID grup saat dipakai di grup |
| `#inspeksi <tautan>` | Lihat info tautan undangan grup (owner) |
| `#setinterval <ms>` | Atur jeda, minimum 10000 ms (owner) |
| `#cekinterval` | Cek jeda pengiriman |

## Persetujuan penerima

Untuk melindungi privasi dan mencegah spam, bot **tidak mengambil atau mengirim DM massal ke semua anggota grup secara otomatis**. Pengguna harus mengirim `#optin` ke bot melalui chat pribadi sebelum menerima pesan. Mereka dapat berhenti kapan saja dengan `#optout`. Perintah `#pushid` hanya mengirim pengumuman ke grup yang dituju, bukan mengirim DM ke seluruh anggotanya.

## Konfigurasi

- Owner: `6285352860012`
- Nama bot: `KyassasinDev`
- Node.js: 20+
- Session: `database/session` (**jangan unggah ke GitHub**)
- Persetujuan penerima: `database/consent.json`
- Interval: `database/bot-config.json`

Jangan membagikan TOKEN SITUS, kode pairing, atau folder session. Gunakan bot sesuai aturan WhatsApp dan hanya kirim pesan yang memang diharapkan penerimanya.
