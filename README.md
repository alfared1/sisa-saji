# Sisa-Saji — PWA Pemulihan Makanan Surplus

Platform yang menghubungkan warung/UMKM kuliner dengan mahasiswa untuk menjual porsi makanan surplus menjelang jam tutup (20.00–23.00), dalam radius 2 km dan 100% ambil sendiri.

Spesifikasi lengkap ada di [blueprint_sisa_saji.md](blueprint_sisa_saji.md).

**Status:** Fase 1 selesai (fondasi project, skema database PostGIS, data seed kampus). Fase 2–4 belum dikerjakan.

## Tech stack

- **Next.js 16** (App Router, TypeScript, Cache Components) dan **Tailwind CSS v4**, dalam satu aplikasi berisi frontend dan API (`src/app/api/v1/*`)
- **PostgreSQL + PostGIS**, diakses dengan **Drizzle ORM** lewat driver `pg` (node-postgres)
- **Redis 7** untuk Fase 2+: cache geo, kunci stok, dan BullMQ

## Menjalankan secara lokal

Butuh Node.js 22 LTS atau lebih baru.

```bash
npm install
cp .env.example .env
```

Pilih salah satu cara menjalankan database.

**A. Tanpa Docker (default di `.env.example`).** Postgres dan PostGIS berjalan di dalam Node memakai PGlite. Biarkan terminal ini tetap terbuka:

```bash
npm run db:local          # 127.0.0.1:5433, data tersimpan di ./.pglite
```

**B. Dengan Docker:**

```bash
docker compose up -d      # PostGIS 16-3.4 + Redis 7
# lalu di .env: DATABASE_URL=postgres://sisasaji:sisasaji@127.0.0.1:5432/sisasaji
```

**C. Database cloud (mis. Neon):** pakai URL koneksi pooled di `DATABASE_URL`. Migrasi pertama otomatis menjalankan `CREATE EXTENSION postgis`.

Setelah database jalan, di terminal lain:

```bash
npm run db:reset          # migrate + seed + verifikasi
npm run dev               # http://localhost:3000
```

Cek koneksi: `GET http://localhost:3000/api/v1/health`

> PGlite hanya untuk development: satu proses dan masih berlabel *experimental* untuk PostGIS. Untuk produksi, pakai Postgres sungguhan (Docker atau cloud).

## Script npm

| Script | Fungsi |
| :--- | :--- |
| `npm run dev` / `build` / `start` | Server Next.js |
| `npm run typecheck` | `next typegen` lalu `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:local` | Server Postgres + PostGIS lokal (PGlite) di port 5433 |
| `npm run db:generate` | Membuat file migrasi SQL dari `src/db/schema.ts` |
| `npm run db:migrate` | Menerapkan migrasi di `./drizzle` |
| `npm run db:seed` | Menghapus semua data lalu mengisi ulang data demo |
| `npm run db:verify` | 17 pemeriksaan integritas data (query radius, harga, uang, dampak, stok, log diskon) |
| `npm run db:reset` | migrate + seed + verify |
| `npm run db:studio` | Drizzle Studio |

## Data demo (hasil `db:seed`)

- **15 warung fiktif** di sekitar UGM/UNY Yogyakarta: Pogung, Sendowo, Jl. Kaliurang, Gejayan, Karangmalang, Terban, Sagan, dan lainnya. Nama warung dan pemiliknya karangan, tapi koordinatnya adalah titik perkiraan di kawasan yang nyata. Dua warung (Seturan dan Condongcatur) sengaja berjarak lebih dari 2 km dari UGM untuk menguji filter radius.
- **Batch aktif "malam ini" dibuat relatif terhadap waktu seed dijalankan.** Jam tutupnya 18–150 menit dari saat itu, jadi demo selalu "live" dan semua tingkat diskon (50% sampai 70%) terlihat. Sekitar 2,5 jam setelah seed, semua batch ini sudah lewat jam tutup. Jalankan ulang `npm run db:seed` sebelum demo. `db:verify` akan menampilkan WARN, bukan FAIL, kalau batch-nya sudah kedaluwarsa.
- **Histori 28 hari** berisi batch yang sudah ditutup, sekitar 2.400 pesanan, ulasan, dan log perubahan diskon. Data ini menjadi bahan latih untuk Surplus Prediction Engine.
- **Prediksi 7 hari ke depan** dari model heuristik (`model_version = heuristic-v0`).
- **Akun demo:**
  - Pembeli: `demo.pembeli@sisasaji.test` / `+6281200000001`. Akun ini selalu punya satu tiket `READY_FOR_PICKUP` di Warung Makan Bu Sri.
  - Mitra: `demo.mitra@sisasaji.test` / `+6281300000001`, pemilik Warung Makan Bu Sri.
  - Admin: `admin@sisasaji.test`

## Struktur folder

```
drizzle/                  migrasi SQL (0000 = ekstensi PostGIS, 0001 = skema)
scripts/                  db-local.ts, db-migrate.ts, db-verify.ts
src/app/api/v1/health/    endpoint health
src/db/schema.ts          skema Drizzle — sumber kebenaran struktur database
src/db/client.ts          factory koneksi (dipakai app & script)
src/db/index.ts           getDb() untuk server (server-only)
src/db/seed/              data & seeder
src/lib/constants.ts      konstanta domain (radius, komisi, faktor CO2e, kampus)
src/lib/env.ts            validasi environment (lazy, per variabel)
src/lib/impact.ts         konversi makanan → CO2e → pohon, tier badge
src/lib/pricing/          Dynamic Discount Optimizer & perhitungan total pesanan
src/lib/pickup-token.ts   kode & token QR pengambilan (HMAC)
```

## Perbedaan dari DDL di blueprint (disengaja)

1. **UUID memakai `gen_random_uuid()`** bawaan Postgres, jadi ekstensi `uuid-ossp` tidak diperlukan.
2. **`merchants.geom` adalah kolom GENERATED** dari `latitude`/`longitude`, sehingga koordinat dan kolom spasial tidak mungkin berbeda. Aplikasi cukup menulis lat/lng.
3. **`users.phone_number` boleh kosong**, karena pengguna yang login dengan Google OAuth belum tentu punya nomor. Sebagai gantinya ada CHECK yang mewajibkan minimal salah satu dari email atau nomor HP. Supaya tombol "Hubungi Warung (WhatsApp)" selalu berfungsi, tabel `merchants` punya kolom baru **`whatsapp_number` (NOT NULL)** yang diisi saat onboarding mitra.
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

## Langkah berikutnya

**Fase 2 (sesuai blueprint §3):**
- unit test dan worker BullMQ untuk `DynamicDiscountService`;
- `SurplusPredictionService` dan endpoint `quote-ai`;
- API discovery berbasis radius PostGIS.
