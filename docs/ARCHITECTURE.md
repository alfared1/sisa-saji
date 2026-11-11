# Arsitektur Sisa-Saji

Dokumen ini untuk developer yang mengubah kode. Cara menjalankan aplikasi ada di [README](../README.md), spesifikasi awal di [blueprint_sisa_saji.md](../blueprint_sisa_saji.md). Bila skema di kode berbeda dari DDL di blueprint, `src/db/schema.ts` yang berlaku; daftar perbedaannya ada di README.

## Aturan bisnis yang tidak boleh dilanggar

Aturan ini dijaga oleh kode dan test. Mengubah salah satunya berarti mengubah produk, bukan sekadar refactor.

- **Hanya ambil sendiri.** Tidak ada kurir, ongkir, atau `delivery_fee`. Pembeli mengambil pesanan di warung sebelum `pickup_end_time`. Margin warung yang tipis tidak menanggung biaya logistik.
- **Keranjang hanya untuk satu warung.** `src/stores/cart.ts` menolak menu dari warung lain sampai pembeli mengonfirmasi `DiffMerchantDialog`, lalu keranjang lama dikosongkan.
- **Harga tidak pernah di bawah harga lantai.** Optimizer tidak boleh menurunkan `current_selling_price_idr` di bawah `menus.min_recovery_price_idr`, berapa pun sisa waktunya.
- **Stok dikunci secara atomik di PostgreSQL.** Checkout menjalankan satu `UPDATE` bersyarat dalam transaksi (`available_stock -= q`, `reserved_stock += q`, hanya jika `available_stock >= q`). TTL pembayaran 600 detik; bila lewat, worker mengembalikan stok. Invarian per batch: `initial_stock = available_stock + reserved_stock + sold`. Semua penguncian lewat `src/server/services/stock.ts`, jangan menulis versi sendiri.
- **Biaya layanan dibayar pembeli.** Pembeli membayar subtotal harga pemulihan + Rp 1.500 − voucher. Warung menerima subtotal penuh (`net_merchant_payout_idr = subtotal_recovery_idr`), voucher ditanggung platform. Sumber kebenaran: `src/lib/pricing/order-totals.ts`.
- **Fair use saat checkout** (`src/server/services/orders/checkout.ts`):
  - maksimal 1 pesanan belum dibayar per warung dan 2 secara total;
  - checkout ulang dengan item sama mengembalikan pesanan yang sama (aman dari ketukan ganda);
  - porsi per pembeli per batch maksimal `max(3, ceil(initial_stock / 2))`;
  - 3 pesanan batal atau kedaluwarsa dalam 30 menit membuat checkout baru ditolak sementara (`RATE_LIMITED`).
- **Pesanan yang tidak diambil.** Pesanan `PAID` atau `READY_FOR_PICKUP` yang belum diambil sampai `pickup_deadline_at` + 30 menit diubah worker menjadi `EXPIRED`. Warung tetap menerima pembayaran tepat sekali, pembeli tidak mendapat kredit dampak (`closeUnclaimedOrders` di `src/server/services/orders/pickup.ts`).
- **Kode pickup tidak bisa ditebak beruntun.** Setelah 10 kode salah dalam 10 menit, input kode manual warung diblokir sementara (`RATE_LIMITED`). Pemindaian QR (token HMAC) tetap jalan.

## Konstanta

Semua angka domain ada di `src/lib/constants.ts`; ubah di sana, jangan menulis angkanya langsung di komponen.

| Konstanta | Nilai | Arti |
| :--- | :--- | :--- |
| `DEFAULT_SEARCH_RADIUS_M` | 2000 | Radius pencarian default, bisa diperluas ke 5.000 dan 10.000 m |
| `SURPLUS_WINDOW_START` / `_END` | 20:00 / 23:00 | Jendela surplus utama (WIB) |
| `DEFAULT_PORTION_WEIGHT_GRAMS` | 200 | Berat satu porsi |
| `CO2E_PER_KG_FOOD` | 2,5 | Benchmark IPCC: 500 g CO₂e per porsi 200 g |
| `CO2_KG_PER_TREE_YEAR` | 22,24 | Untuk padanan "setara pohon" |
| `PLATFORM_COMMISSION_DEFAULT_IDR` | 1500 | Biaya layanan per transaksi berhasil |
| `MERCHANT_PREMIUM_PRICE_IDR` | 50000 | Langganan bulanan badge "Mitra Terverifikasi" dan prioritas urutan |
| `PAYMENT_TTL_SECONDS` | 600 | Lama stok dikunci menunggu pembayaran |

## Data demo

- `CAMPUSES` (`src/db/seed/data.ts`) berisi 21 kampus/kota. Tiga titik Bogor (`ipb`, `bogor`, `cibinong`) selalu paling atas, dan `CAMPUSES[0]` (IPB Dramaga) menjadi titik pencarian default. Helper ada di `src/lib/campuses.ts`.
- Seed membuat 95 warung fiktif (Bogor 28, DI Yogyakarta 15, sisanya dari Medan sampai Jayapura). Warung indeks 0 adalah warung demo, Warung Nasi Teh Euis. Di test, pakai `DEMO_MERCHANT_SLUG` dan `DEMO_MERCHANT_NAME`, jangan menulis slug langsung.
- `isDemoData()` di `src/lib/env.ts` bernilai benar saat `DEMO_MODE=true` atau pembayaran masih simulator. Selama itu, aplikasi menampilkan `DemoNotice` di atas layar pembeli dan mitra, dan `/stats/global` mengirim `is_demo_data` supaya statistik dampak berlabel "Data demo". Jangan menampilkan data seed (rating, statistik, badge) seolah nyata.
- Di Vercel (`DEMO_MODE=true`), `topUpDemoBatches` (`src/server/jobs/serverless.ts`) menjaga setiap titik punya batch live: 4 per titik, 10 untuk titik Bogor, maksimal 24 publikasi per panggilan.

## Stack dan keputusan teknis

- **Next.js 16** (App Router, Cache Components, TypeScript strict) sebagai satu aplikasi: UI di `src/app`, REST API di `src/app/api/v1/*` dengan bentuk respons `{ success, data, meta?, error? }`, logika bisnis di `src/server/services/*`. API Next.js 16 berbeda dari versi sebelumnya; rujukan yang benar ada di `node_modules/next/dist/docs/`.
- **PWA:** `src/app/manifest.ts` dan service worker tulisan tangan `public/sw.js`. Service worker meng-cache halaman dan `GET /api/v1/orders/<id>`, sehingga tiket pengambilan (QR + kode 4 digit) tetap terbuka tanpa sinyal. Web Push memakai `web-push` dengan kunci VAPID.
- **UI:** Tailwind CSS v4, shadcn/ui (Radix), lucide-react, motion. Pembeli memakai layout mobile-first (`max-w-md`) yang melebar di desktop; mitra memakai sidebar desktop dan layout tablet kasir.
- **State:** TanStack Query v5 untuk data server, ditambah Server-Sent Events di `/api/v1/stream/batches` (pembeli) dan `/api/v1/stream/merchant` (mitra). State klien memakai zustand dengan persist (`src/stores/cart.ts`, `location.ts`, `tickets.ts`).
- **Database:** PostgreSQL 16+ dengan PostGIS, lewat Drizzle ORM (`casing: "snake_case"`) dan driver `pg`. Kolom `merchants.geom` di-generate dari latitude/longitude, jadi jangan pernah menulisnya. UUID memakai `gen_random_uuid()`. Akses server memakai `getDb()` dari `@/db`; script memakai `createDb()` dari `src/db/client.ts`.
- **Tanpa Redis.** Presensi pengguna aktif ada di tabel `customer_presence` dengan indeks GIST (`src/server/services/presence.ts`), kunci stok di `stock.ts`, dan job terjadwal di `npm run worker` (`scripts/worker.ts`, `src/server/jobs/`). `REDIS_URL` disiapkan untuk scaling nanti.
- **Peta dan QR:** Leaflet + react-leaflet dengan tile OpenStreetMap (`src/components/map/`), `qrcode.react` untuk QRIS dan tiket, `html5-qrcode` untuk pemindai.
- **Validasi dan waktu:** zod (kontrak di `src/lib/contracts`) dan react-hook-form. Semua waktu dalam WIB lewat `src/lib/time.ts`.
- **Pembayaran:** `PAYMENT_PROVIDER=simulator` membuat QRIS dinamis tersimulasi (format EMVCo + CRC16) dan webhook bertanda tangan HMAC-SHA512. Tombol "Simulasi Bayar" hanya untuk demo.
- **Login:** OTP lewat nomor HP atau email. `OTP_DEV_MODE=true` menampilkan kode di layar karena belum ada provider WhatsApp. Sesi berupa cookie httpOnly `ss_session` (JWT).

## Struktur folder

```
├── docs/                 # dokumen ini
├── drizzle/              # migrasi SQL (0000 = CREATE EXTENSION postgis)
├── ml/                   # Surplus Prediction Engine (batch Python, LightGBM)
├── scripts/              # db-local, db-migrate, db-seed, db-verify, demo, worker, ml-run
├── tests/                # Vitest: unit/ dan integration/ (PostGIS in-memory)
├── e2e/                  # Playwright
└── src/
    ├── app/
    │   ├── (public)/     # welcome, auth, tour
    │   ├── (customer)/   # discover, map, warung/[slug], checkout, orders, impact, profile
    │   ├── merchant/     # onboarding, dashboard, surplus/new, orders, menus, analytics, settings
    │   ├── offline/
    │   └── api/v1/       # REST API (kontrak di src/lib/contracts)
    ├── components/       # ui (shadcn), common, customer, merchant, map, shell, pwa, tour
    ├── db/               # schema.ts, client.ts, index.ts, seed/
    ├── hooks/
    ├── lib/              # constants, contracts, pricing, impact, time, env, campuses, api client
    ├── server/           # http, auth, mappers, services/, jobs/
    └── stores/           # cart, location, tickets, map-scope
```

Halaman warung untuk pembeli ada di `/warung/[slug]`, bukan `/merchant/[id]`, supaya tidak bentrok dengan area mitra di `/merchant/*`.

## Dynamic Discount Optimizer

`src/lib/pricing/dynamic-discount.ts` (fungsi murni) dan `src/server/services/escalation/` (worker). Optimizer ini aturan bertingkat, bukan model terlatih, sehingga langsung jalan untuk warung baru tanpa histori.

Input: sisa porsi, menit menuju `pickup_end_time`, jumlah pengguna aktif dalam 2 km selama 30 menit terakhir (`presence.countActiveUsersNear`), dan rasio konversi historis warung (default 0,65 untuk warung baru).

| Sisa waktu dan stok | Diskon aturan |
| :--- | :--- |
| ≤ 30 menit, ≥ 5 porsi | 70%, plus push "Flash Rescue" ke pengguna terdekat sekali per batch |
| ≤ 30 menit, 1–4 porsi | 65% |
| ≤ 60 menit, ≥ 5 porsi | 60% |
| ≤ 90 menit, ≥ 8 porsi | 55% |
| selain itu | 50% (`DISCOUNT_BASELINE_PCT`) |

Setelah itu ada satu penyesuaian permintaan. Bila pengguna aktif kurang dari 0,8 × (3 × sisa porsi) dan konversi historis di bawah 0,5, diskon naik 5 poin (maks. `DISCOUNT_MAX_PCT` = 75%). Bila pengguna aktif lebih dari 2,5 × (3 × sisa porsi), konversi di atas 0,8, dan masih lebih dari 90 menit, diskon turun 5 poin (min. `DISCOUNT_MIN_PCT` = 40%).

Harga dibulatkan ke atas ke kelipatan Rp 500 dengan aritmetika integer, lalu `max(harga lantai, harga bulat)`. Karena pembulatan, diskon efektif bisa sedikit di bawah angka aturan (mis. 70% menjadi 69%), dan UI menampilkan angka efektif itu. Worker hanya boleh menaikkan diskon, dan setiap perubahan harga dicatat di `discount_adjustment_logs`.

## Surplus Prediction Engine

`src/server/services/prediction/` (sisi Node) dan `ml/` (Python).

- `ml/train_predict.py` melatih LightGBMRegressor dan LightGBMClassifier, lalu menulis prediksi 7 hari ke `merchant_surplus_predictions` dengan `model_version = 'lgbm-v1'`. Script ini dijalankan worker tiap minggu atau manual lewat `npm run ml:train`, tidak pernah di dalam request HTTP.
- Dasbor dan `POST /api/v1/merchant/surplus/quote-ai` hanya membaca tabel itu. Bila belum ada baris, dipakai heuristik dari histori 4 minggu (`heuristic-v0`) yang diperbarui worker tiap hari tanpa menimpa baris `lgbm-v1`.
- Di UI, hasilnya ditulis dalam bahasa pemilik warung ("Sekitar 19 porsi kemungkinan belum laku…"), bukan nama model atau skor mentah.

## Pencarian lokasi dan checkout

**Radius 2 km** (`GET /api/v1/discover/nearby`, `src/server/services/discovery/`): selalu `ST_DWithin(geom, ST_MakePoint(lng, lat)::geography, meter)` yang diparameterisasi, memakai indeks GIST. Urutan default: Mitra Terverifikasi, lalu jarak, lalu diskon. Yang tampil hanya batch `ACTIVE` dengan `available_stock > 0` dan `pickup_end_time > NOW()` dari warung yang buka.

**Peta** dibuka dalam cakupan "Seluruh Indonesia" dari `GET /api/v1/discover/map-pins/all` (maks. `ALL_MAP_PINS_LIMIT`). Warung tanpa surplus live menjadi penanda abu-abu, dan penanda yang berdekatan dikelompokkan di zoom rendah (`src/components/map/cluster.ts`). Memilih lokasi lewat "Ambil di sekitar" mengubah peta ke cakupan radius (`src/stores/map-scope.ts`, tidak dipersist). Hanya kontrol pemilih yang memanggil `pickLocation()`; fix GPS di latar tidak mengubah cakupan.

**Verifikasi pengambilan** (`POST /api/v1/orders/:id/verify-pickup`), dalam satu transaksi:

1. pastikan status `READY_FOR_PICKUP` atau `PAID`, pesanan milik warung yang login, dan kode/QR cocok;
2. hitung dampak: pangan = Σ(jumlah × berat porsi), CO₂e = round(pangan × 2,5), uang hemat = subtotal normal − subtotal pemulihan + voucher;
3. set `COMPLETED` dan `picked_up_at`;
4. tambahkan `net_merchant_payout_idr` ke `merchants.wallet_balance_idr`;
5. tambahkan dampak dan poin ke profil pembeli; badge naik dari Surplus Rookie ke Surplus Saver (≥ 2 kg) dan Surplus Hero (≥ 5 kg).

## Konvensi UI

- **Bahasa:** semua teks UI berbahasa Indonesia yang ramah dan langsung ("Porsi Surplus", "Harga Pemulihan", "Ambil Sendiri di Warung"). Jangan memakai "makanan bekas". Jangan memakai em dash (—); pakai titik, koma, atau titik dua. Jangan menyebut aturan harga sebagai "AI"; sebut "saran harga" atau "harga otomatis".
- **Kartu menu:** badge "Hemat 50%" hijau (`--color-hemat`), atau "Flash Rescue 70%" oranye (`--color-flash`) yang berdenyut bila kurang dari 45 menit sebelum tutup; sisa porsi; hitung mundur; dan estimasi dampak ("Selamatkan 200 g pangan • −0,5 kg CO₂e").
- **Target kecepatan:** pembeli dari /discover sampai QRIS dalam maksimal 3 layar; mitra dari /merchant/surplus/new sampai "Publikasikan Sekarang" dalam kurang dari 60 detik.
- **Tema:** Terang, Gelap, atau Sistem lewat next-themes (localStorage `theme`). Gaya gelap selalu lewat varian `dark:` (kelas `.dark` di `<html>`), bukan `prefers-color-scheme`. Setiap layar dicek di kedua tema.
- **Warna punya peran, bukan hiasan.** Komponen hanya memakai token di `src/app/globals.css`:
  - hijau = merek dan dampak (`primary`, `brand-soft`, `brand-strong`/`impact`); badge Hemat memakai emerald dari spesifikasi;
  - oranye = harga, diskon, dan uang (`deal`, `deal-soft`, `flash`);
  - merah = error dan waktu habis (`urgent`); kuning = label demo dan peringatan (`warning-soft`);
  - selain itu netral (`muted`, `surface`, `food` untuk thumbnail tanpa foto).

  Jangan memberi ikon, tile, atau baris menu warna berbeda hanya supaya bervariasi. Pengecualian: bintang rating (kuning), warna merek e-wallet, dan overlay kamera pemindai. Hindari juga gradien dekoratif, orb blur, dan animasi denyut kecuali untuk status yang mendesak.
- **Kunjungan pertama:** "/" mengirim tamu baru ke /tour (`?peran=mitra` untuk mitra). Selesai atau lewati tur menyimpan `ss-tour-seen`, sehingga kunjungan berikutnya ke /welcome. Pembeli yang login langsung ke /discover, mitra ke /merchant/dashboard.

## Alur kerja

- Butuh Node.js 22 atau lebih baru. Dengan Node 20, test gagal memuat ekstensi PostGIS di PGlite.
- Sebelum commit: `npm run typecheck && npm run lint && npm run test`. Untuk perubahan UI, jalankan juga `npm run test:e2e`.
- Mengubah skema: edit `src/db/schema.ts`, jalankan `npm run db:generate`, periksa SQL-nya (drizzle-kit memberi tanda kutip pada `geography(Point, 4326)`, hapus manual), lalu `npm run db:migrate`.
- Database lokal tanpa Docker: `npm run db:local` (PGlite + PostGIS, port 5433), pakai driver `pg`. PGlite hanya punya satu sesi Postgres untuk semua koneksi socket, sehingga koneksi paralel bisa saling menyela (`portal "" does not exist`, hasil kosong, bahkan statement asing di tengah transaksi). Karena itu `DB_POOL_MAX=1` dipakai untuk PGlite (`.env.example`, `npm run demo`, E2E). Web dan worker tetap dua proses, jadi sisa risiko itu masih ada di demo lokal. Uji rebutan stok yang benar-benar paralel butuh Postgres sungguhan (Docker atau Neon).
- Untuk melihat error server di balik test E2E yang gagal, jalankan dengan `E2E_SERVER_LOG=<file>`. Reset dengan `DROP SCHEMA` saat server jalan membuat cache PostGIS basi ("no spatial operator found"); jalankan ulang `db:local` atau hapus `.pglite/` saat server mati.
- Batch "malam ini" di data demo kedaluwarsa sekitar 2,5 jam setelah seed. Jalankan `npm run db:seed` (atau `npm run demo:reseed`) sebelum demo.
