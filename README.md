# Sisa-Saji

Aplikasi web (PWA) untuk menyelamatkan porsi makanan surplus dari warung di sekitar kampus.

Sisa-Saji menghubungkan warung makan / UMKM kuliner dengan pembeli (terutama mahasiswa) dalam radius **2 km** untuk menyelamatkan porsi makanan surplus menjelang jam tutup (**20.00–23.00 WIB**). Warung memasang sisa porsi dengan harga pemulihan yang turun otomatis menjelang tutup, pembeli memesan dan membayar lewat QRIS, lalu **mengambil sendiri** makanannya di warung dengan tiket QR / kode `SJ-XXXX`. Setiap porsi yang diambil dihitung dampaknya: gram pangan yang terselamatkan, kg CO₂e yang dihindari, dan rupiah yang dihemat.

- **100% ambil sendiri.** Tidak ada kurir, jadi margin warung tetap utuh dan tidak ada emisi logistik.
- **Dua modul inti:** *Dynamic Discount Optimizer*, aturan harga yang menaikkan diskon bertahap dari 50% ke 70% menjelang tutup tanpa pernah turun di bawah harga lantai, dan *Surplus Prediction Engine*, model LightGBM yang memperkirakan porsi sisa per warung dan menu dari histori penjualan.
- **Bisnis:** pembeli membayar biaya layanan Rp 1.500 per transaksi; warung menerima harga pemulihan penuh.

Spesifikasi lengkap ada di [blueprint_sisa_saji.md](blueprint_sisa_saji.md). Aturan bisnis, struktur folder, dan konvensi kode ada di [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Mulai cepat (demo satu perintah)

Butuh **Node.js 22 atau lebih baru** ([nodejs.org](https://nodejs.org)). Docker dan Python tidak wajib.

**Windows:** klik dua kali **`start-demo.cmd`**. Script ini menjalankan `npm install` bila perlu, lalu `npm run demo`.

**Semua OS:**

```bash
npm install
npm run demo
```

`npm run demo` (`scripts/demo.ts`) mengerjakan semuanya secara berurutan:

1. mengisi secret yang masih kosong di `.env` (`npm run setup:secrets`; nilai yang sudah ada tidak pernah diubah);
2. menyalakan PostgreSQL + PostGIS lokal (PGlite, tanpa Docker) di port 5433;
3. menjalankan migrasi dan **seed ulang** data demo, sehingga batch "malam ini" selalu aktif;
4. `next build` bila build belum ada atau sumber kode berubah (**run pertama ±1–3 menit**);
5. `next start` (mode produksi, dengan secret asli) + worker terjadwal, lalu menampilkan URL dan akun demo.

Setelah muncul **"Sisa-Saji siap!"**, buka <http://localhost:3000/welcome>. Log diberi awalan per proses (`[db]`, `[web]`, `[worker]`, …); baris `[worker] … [job] minute ok` muncul tiap menit. Status database, PostGIS, dan worker bisa dicek di <http://localhost:3000/api/v1/health>.

**Menghentikan demo:** tekan **Ctrl+C** di jendela demo, atau (Windows) klik dua kali **`stop-demo.cmd`**. Script stop membaca file PID yang ditulis `npm run demo` (`node_modules/.cache/sisa-saji/demo-<port>.json`) dan hanya menghentikan proses demo itu (database, web, worker). Bila file PID tidak ada (mis. server dijalankan manual), script mencari proses `node` yang baris perintahnya memuat path folder repo ini; proses Node lain di komputer tidak disentuh. `stop-demo.cmd --dry-run` hanya menampilkan daftar proses yang akan dihentikan.

Pengaturan opsional (variabel lingkungan atau baris di `.env`):

| Variabel | Default | Fungsi |
| :--- | :--- | :--- |
| `DEMO_PORT` | `3000` | Port web |
| `DEMO_DB_PORT` | `5433` | Port database PGlite lokal |
| `DEMO_DB_DIR` | `./.pglite` | Folder data PGlite |
| `DEMO_DATABASE_URL` | – | Pakai database ini (mis. Docker/Neon) alih-alih PGlite |
| `DEMO_BUILD` | `auto` | `auto` / `always` / `never` (`npm run demo -- --rebuild` = `always`) |
| `DEMO_SEED` | `true` | `false` = data lama dipertahankan (`npm run demo -- --no-seed`) |
| `NEXT_DIST_DIR` | `.next` | Folder hasil build |
| `DEMO_ENV_FILE` | `.env` | File env yang menyimpan secret (diisi otomatis bila kosong) |

Contoh: `DEMO_PORT=3001 npm run demo` (bash), `set DEMO_PORT=3001 && npm run demo` (cmd), atau `$env:DEMO_PORT=3001; npm run demo` (PowerShell).

### Akun demo

Login memakai OTP. Di mode demo kodenya **ditampilkan di layar** (belum ada provider WhatsApp/SMS).

| Peran | Email | Nomor HP | Catatan |
| :--- | :--- | :--- | :--- |
| Pembeli | `demo.pembeli@sisasaji.test` | `+6281200000001` | Raka Pratama, tinggal di sekitar IPB Dramaga. Selalu punya satu tiket `READY_FOR_PICKUP` di Warung Nasi Teh Euis |
| Mitra (warung) | `demo.mitra@sisasaji.test` | `+6281300000001` | Euis Kurniasih, pemilik Warung Nasi Teh Euis (Jl. Babakan Raya, Dramaga, Bogor) |
| Admin | `admin@sisasaji.test` | – | |

### Data demo

Bogor adalah pusat platform. Titik pencarian default aplikasi adalah **IPB Dramaga, Bogor**, dan pemilih lokasi menampilkan 21 kampus/kota yang dikelompokkan per wilayah (Bogor paling atas).

| Wilayah | Kampus / kota | Warung |
| :--- | :--- | ---: |
| Bogor (pusat) | IPB Dramaga, Kota Bogor (Baranangsiang), Cibinong | 28 |
| Jabodetabek | UI Depok, UNJ Rawamangun | 8 |
| Jawa Barat | ITB Bandung, UNPAD Jatinangor | 7 |
| DI Yogyakarta | UGM, UNY | 15 |
| Jawa Tengah | UNDIP Tembalang, UNS Surakarta | 8 |
| Jawa Timur | ITS Surabaya, UB Malang | 8 |
| Sumatera | USU Medan, UNAND Padang, UNSRI Palembang | 9 |
| Kalimantan Barat | UNTAN Pontianak | 2 |
| Bali | Universitas Udayana, Denpasar | 3 |
| Sulawesi | UNHAS Makassar, UNSRAT Manado | 5 |
| Papua | UNCEN Abepura, Jayapura | 2 |
| **Total** | **21 kampus / kota** | **95** |

Semua warung dan pemiliknya fiktif, tetapi koordinatnya berada di lingkungan nyata (Babakan Raya, Bateng, Balebak, Suryakencana, Pogung, Kukusan Teknik, Tembalang, …). Seed juga membuat 120 pembeli (±45% di Bogor), histori 28 hari, dan batch "malam ini" di setiap warung. Di Vercel (`DEMO_MODE=true`) job top-up menjaga setiap kampus/kota tetap punya makanan live: minimal 4 batch per titik dan 10 batch untuk tiap titik di Bogor.

---

## Skrip demo 5 menit

Paling enak memakai dua jendela browser: jendela biasa untuk **pembeli** dan jendela *incognito* untuk **mitra**. Atur lebar jendela pembeli seperti HP (DevTools → mode perangkat).

**Pembeli (±2 menit)**

1. Buka `/welcome` → login sebagai `demo.pembeli@sisasaji.test`, masukkan kode OTP yang tampil di layar.
2. `/discover`: daftar porsi surplus dalam 2 km, diurutkan Mitra Terverifikasi → jarak → diskon. Perhatikan badge **"Hemat 50%"** (hijau) dan **"Flash Rescue 70%"** (oranye, berdenyut menjelang tutup), sisa porsi, hitung mundur, dan estimasi dampak.
3. Ketuk satu kartu menu → **"Pesan & Ambil Sendiri"** → QRIS dinamis tampil dengan hitung mundur 10 menit (stok sudah dikunci).
4. Ketuk **"Simulasi Bayar (Demo)"** → webhook bertanda tangan HMAC diproses → tiket pengambilan dengan QR dan kode **`SJ-XXXX`**. Tiket ini tetap bisa dibuka tanpa sinyal (PWA offline).

**Mitra (±2 menit)**

5. Di jendela incognito buka `/auth/login?role=MERCHANT` → login sebagai `demo.mitra@sisasaji.test` / `+6281300000001` (OTP tampil di layar).
6. **Dasbor**: batch aktif, pesanan masuk secara langsung (SSE), dan **perkiraan porsi sisa** malam ini dari model LightGBM.
7. `/merchant/surplus/new`: pilih menu, atur jumlah porsi, lihat **saran harga** dari Dynamic Discount Optimizer, lalu **"Publikasikan Sekarang"** (< 60 detik).
8. `/merchant/orders/scan`: pindai QR tiket pembeli, atau ketik PIN 4 digit dari `SJ-XXXX` → **Verifikasi**.

**Penutup (±1 menit)**

9. Di jendela pembeli, tiket langsung berubah menjadi **perayaan "Pesanan selesai!"** beserta jumlah makanan yang diselamatkan.
10. `/impact`: total pangan terselamatkan, CO₂e yang dihindari (setara pohon), uang yang dihemat, dan badge (Rookie → Saver → Hero).

> Batch "malam ini" kedaluwarsa ±2,5 jam setelah seed. Sebelum presentasi jalankan `npm run demo:reseed` (demo boleh tetap berjalan), lalu login ulang.

---

## Fitur per fase

**Fase 1: fondasi data**
- Skema PostgreSQL + PostGIS (Drizzle), migrasi SQL, dan constraint integritas (stok, harga lantai, kode pickup unik).
- Seeder 95 warung fiktif di 21 kampus/kota di seluruh Indonesia dengan Bogor sebagai pusat, histori 28 hari (±14.800 pesanan), prediksi 7 hari; `db:verify` dengan 19 pemeriksaan.

**Fase 2: mesin harga, prediksi, dan API**
- *Dynamic Discount Optimizer*: baseline 50%, mid-window 55–60%, critical window 70% + push "Flash Rescue" sekali per batch; pembulatan ke atas kelipatan Rp 500 dengan aritmetika integer; harga lantai dijaga; setiap perubahan tercatat di `discount_adjustment_logs`.
- Worker eskalasi tiap 5 menit, kedaluwarsa pesanan tak dibayar, penutupan batch, notifikasi 17:30, refresh prediksi harian, training ML mingguan.
- *Surplus Prediction Engine*: LightGBM batch (`ml/train_predict.py`) + heuristik cold-start (`heuristic-v0`); `quote-ai` dan publish batch.
- Geo-discovery `ST_DWithin` radius 2 km (ekspansi 5/10 km), presensi pengguna aktif di Postgres.
- Checkout dengan kunci stok atomik (tanpa overselling), QRIS tersimulasi (EMVCo + CRC16), webhook HMAC-SHA512, verifikasi pickup + kalkulasi dampak dalam satu transaksi.

**Fase 3: PWA pembeli**
- Login OTP, `/discover`, `/map` (Leaflet + OpenStreetMap), `/warung/[slug]`, pesan cepat, keranjang satu-warung (dialog konfirmasi ganti warung), checkout, QRIS, tiket QR offline, riwayat pesanan, `/impact`, profil.
- Pembaruan harga/stok langsung lewat SSE, Web Push, dapat di-*install* sebagai aplikasi.

**Fase 4: PWA mitra**
- Onboarding warung (termasuk rekening pencairan), dasbor dengan perkiraan porsi sisa, publikasi surplus dengan saran harga, pemindai QR/PIN, daftar pesanan, kelola menu, analitik, pengaturan.

---

## Arsitektur

```
 Browser (PWA pembeli & mitra)
   │  React 19 + TanStack Query + zustand │ service worker public/sw.js (tiket offline, Web Push)
   │  REST /api/v1/*                      │ SSE /api/v1/stream/{batches,merchant}
   ▼
 ┌──────────────────────── Next.js 16 (satu aplikasi) ────────────────────────┐
 │ src/app            halaman (App Router, Cache Components)                   │
 │ src/app/api/v1     REST API, kontrak zod di src/lib/contracts               │
 │ src/server/services stock · presence · discovery · orders · payment ·       │
 │                     escalation (AI 1) · prediction (AI 2) · push · auth     │
 └────────────────────────────────────┬───────────────────────────────────────┘
                                      │ Drizzle ORM + pg
 ┌────────────────────────────────────▼───────────────────────────────────────┐
 │ PostgreSQL 16 + PostGIS                                                      │
 │  geom GEOGRAPHY + GIST · kunci stok (UPDATE bersyarat) · customer_presence   │
 │  discount_adjustment_logs · merchant_surplus_predictions                     │
 └───────▲─────────────────────────────────────────────────▲──────────────────┘
         │                                                   │ tulis prediksi lgbm-v1
 ┌───────┴──────────────────────────┐          ┌─────────────┴───────────────────┐
 │ Worker (npm run worker, tick 30s) │ ───────▶ │ ml/train_predict.py (LightGBM,  │
 │ eskalasi 5 menit, kedaluwarsa,    │  mingguan│ batch Python, bukan per request)│
 │ notifikasi 17:30, refresh prediksi│          └─────────────────────────────────┘
 └──────────────────────────────────┘
 Pembayaran: QRIS tersimulasi → webhook HMAC-SHA512 → /api/v1/webhooks/payment
```

Poin penting:

- **Monolit Next.js 16**: UI, REST API, dan logika bisnis di satu repo dan satu proses web; job terjadwal di proses worker terpisah.
- **Stok dikunci di Postgres**: satu `UPDATE … WHERE available_stock >= q` dalam transaksi (`src/server/services/stock.ts`), TTL pembayaran 10 menit; worker mengembalikan stok yang tidak dibayar.
- **Presensi** "pengguna aktif dalam 2 km" disimpan di tabel `customer_presence` dengan indeks GIST, dipakai sebagai input harga dinamis.
- **ML tanpa latensi**: training dan inferensi LightGBM berjalan batch; dasbor dan `quote-ai` hanya membaca tabel prediksi.
- **Realtime** lewat Server-Sent Events; **offline** lewat service worker yang meng-cache tiket; **notifikasi** lewat Web Push (VAPID).

Struktur folder lengkap ada di [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#struktur-folder).

---

## Script npm

| Script | Fungsi |
| :--- | :--- |
| `npm run demo` | Demo satu perintah: secret, database PGlite, migrasi, seed, build, `next start` + worker |
| `npm run demo:reseed` | Seed ulang data demo pada database demo yang sedang berjalan |
| `npm run setup:secrets` | Mengisi secret & kunci VAPID yang kosong di `.env` (idempoten, tidak menimpa) |
| `npm run dev` | Server development Next.js |
| `npm run build` / `npm run start` | Build produksi / jalankan build produksi |
| `npm run dev:all` | `next dev` + worker sekaligus |
| `npm run worker` | Worker job terjadwal (eskalasi diskon, kedaluwarsa, notifikasi, ML) |
| `npm run typecheck` | `next typegen` lalu `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest sekali jalan (unit + integration) |
| `npm run test:watch` | Vitest mode watch |
| `npm run test:e2e` | Playwright end-to-end: 35 test di build produksi (DB dan server sendiri) |
| `npm run db:local` | PostgreSQL + PostGIS lokal (PGlite) di port 5433 |
| `npm run db:generate` | Membuat migrasi SQL dari `src/db/schema.ts` |
| `npm run db:migrate` | Menerapkan migrasi di `./drizzle` |
| `npm run db:seed` | Menghapus semua data lalu mengisi ulang data demo |
| `npm run db:verify` | 19 pemeriksaan integritas data |
| `npm run db:reset` | `db:migrate` + `db:seed` + `db:verify` |
| `npm run db:studio` | Drizzle Studio |
| `npm run ml:train` | Training + prediksi LightGBM (butuh Python di `.venv`) |

### Pengembangan tanpa `npm run demo`

```bash
npm install
npm run setup:secrets       # membuat .env dari .env.example bila belum ada
npm run db:local            # terminal 1, biarkan terbuka
npm run db:reset            # terminal 2
npm run dev:all             # http://localhost:3000
```

Database alternatif: `docker compose up -d` (PostGIS 16, lalu `DATABASE_URL=postgres://sisasaji:sisasaji@127.0.0.1:5432/sisasaji`) atau Postgres cloud (mis. Neon) dengan PostGIS aktif. Migrasi pertama menjalankan `CREATE EXTENSION postgis`.

ML opsional: buat `.venv` lalu `pip install -r ml/requirements.txt`, kemudian `npm run ml:train`. Tanpa `.venv`, worker memakai prediksi heuristik.

### Deploy ke Vercel setelah data demo berubah

Build Vercel (`vercel-build`) hanya menjalankan migrasi, tidak seed. Setelah perubahan `src/db/seed/` di-deploy, database produksi masih berisi data lama: titik default IPB Dramaga tampil kosong dan login mitra demo masih memakai pemilik warung lama sampai seed ulang dijalankan.

1. Tunggu deploy selesai, lalu seed ulang: `POST /api/cron/bootstrap?force=1` dengan header `Authorization: Bearer $CRON_SECRET`. Ini **menghapus semua data**, termasuk akun dan sesi, dan tabel terkunci selama seed berjalan (puluhan detik). Jalankan sebelum presentasi, jangan saat presentasi.
2. Cek `/api/v1/discover/nearby?lat=-6.5568&lng=106.7313&radius_m=2000` (harus ada warung) dan login mitra demo.
3. Jalankan `npm run ml:train` dengan `DATABASE_URL` diarahkan ke database produksi, supaya dasbor mitra kembali menampilkan prediksi LightGBM (seed menulis prediksi heuristik).

---

## Pengujian

```bash
npm run test                # Vitest: unit + integration (PostGIS in-memory otomatis)
npm run typecheck && npm run lint
```

Pengujian integrasi memakai database PostGIS in-memory, termasuk uji rebutan stok paralel (tanpa overselling), eskalasi diskon, alur pembayaran + webhook, dan verifikasi pickup.

```bash
npm run test:e2e            # Playwright: 35 test dalam 14 file, di build produksi
```

`test:e2e` menyiapkan semuanya sendiri: database PGlite terpisah (port 5463), migrasi, seed, build ke `.next-e2e`, lalu `next start` di port 3123. Skenario yang diuji: welcome + PWA, login OTP, pencarian dan peta, pesan cepat 3 langkah, keranjang + voucher, verifikasi PIN oleh warung + selebrasi + ulasan, publish surplus dengan saran harga, onboarding mitra, tur produk, tema terang/gelap, rebutan stok (5 checkout paralel untuk 2 porsi), tiket offline, dan keamanan dasar API. Set `E2E_SKIP_BUILD=1` untuk memakai build yang sudah ada, dan `E2E_SERVER_LOG=<file>` untuk menyimpan log database + server (berguna saat test gagal karena error di server).

---

## Konfigurasi (`.env`)

Salin dari [.env.example](.env.example) atau jalankan `npm run setup:secrets`.

| Kunci | Wajib | Keterangan |
| :--- | :--- | :--- |
| `DATABASE_URL` | ya | PostgreSQL + PostGIS. Default PGlite lokal `127.0.0.1:5433` |
| `APP_URL` | ya | URL publik aplikasi (dipakai di tautan push) |
| `SESSION_SECRET` | produksi | Tanda tangan cookie sesi `ss_session` (JWT), min. 32 karakter |
| `PICKUP_QR_SECRET` | produksi | HMAC token QR pengambilan, min. 32 karakter |
| `PAYMENT_WEBHOOK_SECRET` | produksi | HMAC-SHA512 webhook pembayaran, min. 32 karakter |
| `OTP_DEV_MODE` | – | `true` = kode OTP tampil di layar (demo) |
| `PAYMENT_PROVIDER` | – | `simulator` (satu-satunya provider saat ini) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | – | Web Push; push nonaktif bila kosong |
| `DB_POOL_MAX` | – | Ukuran pool koneksi per proses (default 10 web, 4 worker). Isi `1` untuk PGlite, yang hanya punya satu sesi Postgres |
| `REDIS_URL` | – | Tidak dipakai saat ini (cadangan untuk scaling) |
| `DEMO_*`, `NEXT_DIST_DIR` | – | Pengaturan `npm run demo` (lihat di atas) |

Mengganti secret membuat semua sesi logout dan QR tiket lama tidak berlaku; seed ulang data demo sesudahnya.

---

## Perbedaan yang disengaja dari blueprint

1. **UUID memakai `gen_random_uuid()`** bawaan Postgres, jadi ekstensi `uuid-ossp` tidak diperlukan.
2. **`merchants.geom` adalah kolom GENERATED** dari `latitude`/`longitude`, sehingga koordinat dan kolom spasial tidak mungkin berbeda. Aplikasi cukup menulis lat/lng.
3. **`users.phone_number` boleh kosong**, karena pengguna bisa login dengan email saja (login Google dari blueprint belum dibuat). Sebagai gantinya ada CHECK yang mewajibkan minimal salah satu dari email atau nomor HP. Supaya tombol "Hubungi Warung (WhatsApp)" selalu berfungsi, tabel `merchants` punya kolom baru **`whatsapp_number` (NOT NULL)** yang diisi saat onboarding mitra.
4. **`surplus_batches.current_discount_pct` berkisar 0–90**, bukan 10–90. Harga lantai `min_recovery_price_idr` bisa membuat diskon efektif di bawah 10%.
5. **Constraint tambahan:**
   - harga lantai tidak boleh melebihi harga normal;
   - `available + reserved ≤ initial`;
   - jam selesai pickup harus setelah jam mulai;
   - `UNIQUE NULLS NOT DISTINCT` di tabel prediksi;
   - kode pickup unik per warung, khusus untuk pesanan yang masih aktif.
6. **Alur uang:** pembeli membayar subtotal harga pemulihan + biaya layanan − voucher. Warung menerima subtotal harga pemulihan. Voucher ditanggung platform. Lihat `src/lib/pricing/order-totals.ts`.
7. **Dampak (kg pangan, CO2e) baru dihitung saat pesanan `COMPLETED`**, yaitu setelah makanan benar-benar diambil.
8. **`pickup_code` disimpan sebagai 4 digit**, sedangkan awalan `SJ-` hanya ditambahkan di tampilan.
9. **Pembulatan harga di Dynamic Discount Optimizer memakai aritmetika integer.** Kode referensi di blueprint memakai `1 - 0.7`, yang menghasilkan 0.30000000000000004, sehingga Rp 20.000 @70% menjadi Rp 6.500 (68%), bukan Rp 6.000.
10. **Setiap perubahan harga tercatat di `discount_adjustment_logs`** bersama input yang menghasilkannya. Baris log terbaru selalu sama dengan harga batch saat ini. Alasan perubahan dicatat sebagai `INITIAL_PUBLISH`, `TIME_DECAY_RULE`, `TIME_DECAY_30M_RULE`, atau `STOCK_DEMAND_ADJUST`.
11. **Tanpa Redis (keputusan tim).** Kunci stok, presensi pengguna aktif, dan job terjadwal berjalan di PostgreSQL + proses worker (`npm run worker`), bukan Redis/BullMQ. `REDIS_URL` disiapkan untuk scaling nanti.
12. **Komisi platform dibayar pembeli** sebagai biaya layanan Rp 1.500, bukan dipotong dari warung (`net_merchant_payout_idr = subtotal_recovery_idr`).
13. **Peta memakai Leaflet + OpenStreetMap**, bukan MapLibre: lebih ringan, tanpa API key, cukup untuk peta radius 2 km.
14. **Service worker ditulis tangan** (`public/sw.js`) alih-alih plugin PWA, supaya caching tiket offline dan Web Push bisa dikontrol penuh dengan Next.js 16.
15. **OTP mode development**: kode OTP ditampilkan di layar (`OTP_DEV_MODE=true`) karena belum ada provider WhatsApp/SMS.
16. **Pembayaran tersimulasi**: QRIS dinamis berformat EMVCo + CRC16 dan webhook bertanda tangan HMAC-SHA512 asli, tetapi pembayarannya dipicu tombol "Simulasi Bayar (Demo)" (`PAYMENT_PROVIDER=simulator`).
17. **Fair-use checkout**: maksimal 1 pesanan belum dibayar per warung dan 2 secara total, serta batas porsi per pembeli per batch `max(3, ceil(stok awal / 2))`. Tujuannya mencegah satu akun mengunci seluruh stok surplus.
18. **Pesanan tidak diambil** sampai 30 menit setelah batas waktu menjadi `EXPIRED`. Warung tetap dibayar sekali, dan pembeli tidak mendapat kredit dampak.

---

## Troubleshooting

| Masalah | Solusi |
| :--- | :--- |
| `port 3000 sudah dipakai program lain` | Tutup server lama (`stop-demo.cmd`, atau Ctrl+C di jendelanya) atau pakai port lain: `DEMO_PORT=3001 npm run demo`. Untuk database: `DEMO_DB_PORT=5434`. `stop-demo.cmd --dry-run` menampilkan proses yang akan dihentikan tanpa menghentikannya. |
| `/discover` kosong / semua batch "tutup" | Batch demo kedaluwarsa ±2,5 jam setelah seed. Jalankan `npm run demo:reseed` (demo boleh tetap berjalan), lalu login ulang. |
| Error aneh setelah `DROP SCHEMA` / reset manual database | PGlite bisa menyimpan cache katalog lama. Matikan database (Ctrl+C / `stop-demo.cmd`) lalu jalankan lagi `npm run demo` atau `npm run db:local`. Bila tetap rusak, hapus folder `.pglite` (data demo dibuat ulang oleh seed). |
| `butuh Node.js 22 atau lebih baru` | Pasang Node.js 22 LTS atau lebih baru, tutup lalu buka lagi terminal. |
| Muncul dialog Windows Defender / Firewall saat start | Klik **Izinkan** (cukup jaringan privat). Node membuka port lokal untuk web (3000) dan database (5433). |
| `… belum diisi (min. 32 karakter)` | Jalankan `npm run setup:secrets`. Jika secret sudah ada tapi terlalu pendek, kosongkan nilainya lalu jalankan lagi. |
| Login dari HP lewat alamat jaringan tidak berfungsi | Cookie sesi dan service worker butuh HTTPS di luar `localhost`. Untuk demo, pakai browser di laptop (mode perangkat DevTools) atau tunnel HTTPS. |
| Build ingin diulang | `npm run demo -- --rebuild` |
| Jendela demo tertutup paksa, port masih terpakai | Jalankan `stop-demo.cmd` (cek dulu dengan `stop-demo.cmd --dry-run`), lalu `npm run demo` lagi. |
