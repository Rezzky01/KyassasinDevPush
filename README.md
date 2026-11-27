# KyassasinDevPush

WhatsApp bot berbasis Node.js 20+ dengan halaman login TOKEN SITUS dan WhatsApp Pairing Code.

## Menjalankan di Codespaces

```bash
npm install
export PAIRING_TOKEN="$(openssl rand -hex 24)"
printf 'TOKEN SITUS: %s\n' "$PAIRING_TOKEN"
npm start
```

Buka tab **Ports**, pastikan port 3000 tersedia, lalu buka alamat forwarded port. Masukkan TOKEN SITUS dan nomor WhatsApp dengan kode negara (angka saja) untuk meminta kode pairing.

## Konfigurasi

- Owner: `6285352860012`
- Nama bot: `KyassasinDev`
- Node.js: 20 atau lebih baru
- Session WhatsApp disimpan di `database/session` (jangan unggah session ke GitHub).

## Catatan

Ini adalah kerangka awal: login TOKEN SITUS dan pairing WhatsApp sudah disiapkan. Daftar fitur bot yang harus disamakan dengan video belum dimasukkan karena isi videonya belum tersedia untuk diperiksa. Kirim video atau screenshot menu/perintah agar fitur dapat dibuat sesuai sumber, bukan ditebak.
