# BLUEPRINT ARSITEKTUR FULL-STACK & SPESIFIKASI TEKNIS: SISA-SAJI (PWA)
**Dokumen Spesifikasi Rekayasa Perangkat Lunak (System Architecture & Engineering Blueprint)**  
**Target Pembaca:** AI Coding Agent (Cursor / Autonomous SWE Agent) & Tim Engineering  
**Sumber Referensi Utama:**
1. `proposal_sisa_saji_final.md` (CTARSA Youth Greenovation Session II 2027 — Kategori AI, Digital & Emerging Technology)
2. `Surplus.apk` (Reverse-engineered React Native v0.67.5 / Hermes Bytecode v84 Reference Architecture: Screen Hierarchy, State Slices, Domain Payload Fields, & API Contract Conventions)

---

## RINGKASAN KONTEKS SISTEM & PARAMETER DOMAIN

**Sisa-Saji** adalah platform *food waste recovery* berbasis Progressive Web App (PWA) dan kecerdasan buatan (AI) yang mengintersepsi makanan berlebih (*surplus food*) di tingkat ritel UMKM kuliner/warung makan pada jam-jam kritis menjelang tutup operasional (**window utama: 20.00–23.00 WIB**) dan menghubungkannya dengan konsumen (khususnya mahasiswa) dalam **radius geolokasi 2 km** melalui mekanisme **100% Self-Pickup** dan pembayaran **QRIS / Dompet Digital**.

### Konstanta Domain & Bisnis (Wajib Ditanamkan di Konfigurasi Environment/Constants)
* **Default Search Radius:** `2000` meter (2 km), dapat diperluas pengguna hingga `5000`–`10000` meter jika stok sekitar kosong.
* **Window Intersepsi Utama:** `20:00` s.d. `23:00` waktu lokal warung (`closing_time` dinamis per warung).
* **Platform Service Fee (`commission_fee`):** `Rp 1.000` – `Rp 2.000` flat per transaksi berhasil (otomatis dipotong pada saat settlement/split payment).
* **Merchant Premium Subscription:** `Rp 50.000 / bulan` (benefit: *Priority Ranking Boost* di query PostGIS + badge `"Mitra Terverifikasi"` / `merchant_verified = true`).
* **Faktor Konversi Dampak Lingkungan (IPCC & Proposal Benchmark):**
  * Rata-rata berat 1 porsi makanan: `200 gram` (`0.2 kg`, dapat dikustomisasi per menu via `portion_weight_grams`).
  * Faktor Emisi Karbon (IPCC): `2.5 kg CO2e` per `1 kg` limbah pangan yang diselamatkan (`0.5 kg CO2e` per porsi 200g).
  * Ekuivalensi Pohon: `1 pohon dewasa menyerap ~22.24 kg CO2/tahun` (mengacu rasio proposal: 912 ton CO2 ≈ 41.000 pohon/tahun).
* **Target Kecepatan Transaksi (UX SLA):** `< 3 menit` dari pengguna membuka PWA hingga QRIS terbayar dan kode pengambilan (`pickup_code`) terbit.

---

## 1. UI/UX & Frontend Architecture (PWA)

Arsitektur Frontend mengadopsi pola navigasi, penamaan komponen, serta *micro-interactions* yang telah terbukti di lapangan dari bedah arsitektur **`Surplus.apk`** (`DiscoverScreen`, `NearbyMerchantMapScreen`, `MerchantScreen`, `MenuScreen`, `CheckoutScreen`, `PickupMethodScreen`, `OrderDetailScreen`, `ImpactCard`, `TimesUpModal`, `DiffMerchantModal`), namun disederhanakan dan dioptimalkan menjadi **Single-Codebase Multi-Role Progressive Web App (PWA)** untuk **Pembeli (Customer)** dan **Mitra Warung (Merchant)**.

### 1.1. User Flows (Alur Pengguna End-to-End)

#### A. Alur Mitra Warung (Merchant Flow — *"60-Second Surplus Publishing & Pickup Verification"*)
1. **Onboarding & Konfigurasi Warung (`/merchant/onboarding`):**
   * Pemilik warung login menggunakan Nomor WhatsApp/OTP atau Google OAuth (`authActionSaga` pattern).
   * Mengisi profil warung (`merchant_name`, `merchant_category`, `merchant_address`), menetapkan titik koordinat GPS akurat via *Interactive Map Pin-Drop* (`merchant_latitude`, `merchant_longitude`), menentukan jam operasional & jam tutup harian (`closing_time`, misal `22:30`), serta mengunggah foto QRIS statis/rekening pencairan dana.
   * Menambahkan katalog menu dasar (`master_menus`: nama menu, harga normal `original_price`, estimasi berat porsi `portion_weight_grams` default 200g, foto menu).
2. **Notifikasi Proaktif Pra-Tutup (Jam 19.30 / 30 Menit Sebelum Window Surplus):**
   * Sistem mengirimkan Web Push Notification ke perangkat pemilik warung berbasis *Surplus Prediction Engine*: *"Halo Pak Budi, malam Jumat biasanya Nasi Rendang tersisa ~8 porsi. Siap publikasikan porsi surplus malam ini?"*
3. **Input Cepat Porsi Sisa & Rekomendasi AI (`/merchant/surplus/new` — Pukul 20.00):**
   * Merchant membuka *Quick Surplus Input Sheet*, memilih menu yang tersisa (atau paket *Mystery/Surprise Bag*), dan menginput jumlah porsi (`in_stock`, misal: `10 porsi`) menggunakan tombol stepper `+ / -`.
   * Begitu angka porsi dimasukkan, UI memanggil endpoint kalkulasi AI secara *debounced* (300ms):
     * **Surplus Prediction Engine** menampilkan indikator *Sell-Out Probability* (misal: `88% peluang habis terjual sebelum 22:00`).
     * **Dynamic Discount Optimizer** menampilkan rekomendasi `selling_price` dan `surplus_discount` (misal: Harga Normal `Rp 20.000` $\rightarrow$ Rekomendasi Diskon `50%` = `Rp 10.000` pada H-2 jam sebelum tutup), lengkap dengan toggle **"Aktifkan Auto-Escalation Diskon"** (otomatis menaikkan diskon ke `70%` jika pada H-30 menit sebelum tutup stok masih tersisa $\ge 5$ porsi).
   * Merchant menekan tombol **"Publikasikan Sekarang"** (`1-Tap Publish`). Listing langsung aktif di Redis Geo-Cache dan memicu Push Notification ke mahasiswa dalam radius 2 km.
4. **Monitoring Real-Time & Auto-Escalation (`/merchant/dashboard`):**
   * Dasbor menampilkan sisa stok real-time (`id_stocks`), countdown menuju jam tutup, dan daftar pesanan masuk yang sudah dibayar (`status_order = PAID`).
   * Saat waktu mencapai threshold kritis (misal 30 menit sebelum `closing_time`), worker backend otomatis memperbarui diskon sesuai aturan *Dynamic Discount Optimizer* dan memperbarui UI secara real-time via Server-Sent Events (SSE) / WebSocket.
5. **Verifikasi Self-Pickup di Warung (`/merchant/orders/scan`):**
   * Mahasiswa datang ke warung sebelum `pickup_end_time` dan menunjukkan **QR Pickup Ticket** atau **4-Digit Kode Pengambilan (`pickup_code`)**.
   * Merchant memindai QR melalui kamera PWA atau mengetik 4 digit kode, opsional mengambil foto bukti penyerahan bungkusan (`confirm_pickup` / validasi kantong belanja seperti di `Surplus.apk`), lalu menekan **"Selesaikan Pesanan"**. Saldo otomatis bertambah ke *Merchant Balance* dan metrik dampak (`kg_food_saved`, `kg_co2_avoided`) tercatat.

#### B. Alur Pembeli / Mahasiswa (Customer Flow — *"Under 3-Minute Food Rescue"*)
1. **Geolocation Acquisition & Discovery (`/discover` — `DiscoverScreen`):**
   * Saat PWA dibuka, aplikasi meminta izin HTML5 Geolocation API (`origin_lat_long`) atau menggunakan alamat kos/kampus tersimpan (`AddressSetupScreen` / `SavedAddressScreen`).
   * Halaman utama menampilkan:
     * **Header Lokasi & Radius Pill:** Menampilkan lokasi aktif + filter radius (`2 km` default).
     * **Personal Impact Banner (`ImpactCard`):** Ringkasan kontribusi pengguna (*"Kamu telah menyelamatkan 4,2 kg makanan & mencegah 10,5 kg emisi CO₂e"* — terinspirasi dari `Dampak Surplus` & `molecule-co2` di `Surplus.apk`).
     * **Discovery Sections (mengadopsi struktur `Surplus.apk`):**
       * *Hampir Habis & Diskon Tertinggi* (menu dengan auto-escalated discount 60%–70% mendekati jam tutup).
       * *Dibawah Rp 10.000 (`discover_under_10k_menu`)* — filter krusial untuk segmen mahasiswa akhir bulan.
       * *Mitra Terdekat (`discover_nearby_merchant`)* — diurutkan berdasarkan jarak meter terdekat dan status *Mitra Terverifikasi* (Premium Listing).
2. **Eksplorasi Peta Interaktif (`/map` — `NearbyMerchantMapScreen`):**
   * Pengguna beralih ke tampilan peta interaktif (MapLibre GL / Leaflet / Google Maps) yang merender lingkaran radius 2 km dan pin kustom warung aktif.
   * Pin menampilkan persentase diskon aktif (misal `-60%`, warna merah/oranye berdenyut jika `< 45 menit` sebelum tutup) dan jumlah porsi tersisa (`Sisa 3 porsi!`). Klik pada pin memunculkan *Bottom Sheet Preview Card (`MerchantCard`)*.
3. **Pemilihan Menu & Guardrail Keranjang (`/warung/[slug]` — `MerchantScreen` & `MenuScreen`):**
   * Pengguna melihat detail warung, badge `"Toko sudah terverifikasi"`, jarak (`0.6 km`), jam batas ambil (`pickup_start_time` – `pickup_end_time`, misal `20:00 - 22:30 WIB`), dan daftar menu surplus aktif.
   * Setiap kartu menu menampilkan: harga coret (`original_price`), harga pemulihan (`selling_price`), persentase hemat (`surplus_discount`), sisa stok real-time (`in_stock`), dan *Live Countdown Timer* menuju jam tutup.
   * **Single-Merchant Cart Constraint (`DiffMerchantModal` dari `Surplus.apk`):** Jika keranjang sudah berisi menu dari Warung A dan pengguna mencoba menambah menu dari Warung B, muncul modal konfirmasi: *"Pesanan kamu sebelumnya akan terhapus apabila memesan item di mitra ini. Lanjutkan?"* (karena mekanisme *self-pickup* per lokasi warung).
   * **Eco-Incentive Toggle (`LunchboxModal`):** Opsi membawa wadah makan/kotak bekal sendiri untuk mengurangi sampah plastik sekali pakai.
4. **Checkout Cepat & Pembayaran QRIS (`/checkout` — `CheckoutScreen` & `PaymentScreen`):**
   * Menampilkan ringkasan item, rincian metode **Ambil Sendiri (Self-Pickup)** beserta peta mini lokasi warung dan estimasi waktu jalan kaki/motor, serta slot waktu pengambilan (`SET_PICKUP_TIME`).
   * Menampilkan rincian biaya transparan: Subtotal Harga Pemulihan + Biaya Layanan Platform (`Rp 1.000`–`Rp 2.000`) - Potongan Voucher/Poin (`potongan_surplus` / `voucher_discount`) + Kalkulasi Dampak Pesanan ini (`+0.4 kg pangan diselamatkan`, `+1.0 kg CO2e dicegah`).
   * Ketika pengguna menekan **"Lanjut Bayar"**, backend mengunci stok sementara (*Redis TTL Inventory Lock* selama 10 menit) dan menghasilkan **Dynamic QRIS String / Deep-link GoPay/OVO/DANA**.
   * Jika waktu bayar habis atau jam tutup warung terlampaui sebelum dibayar, sistem menampilkan `TimesUpModal`.
5. **Self-Pickup & Bukti Dampak (`/orders/[id]` — `OrderDetailScreen` & `ThankyouScreen`):**
   * Setelah webhook pembayaran sukses (`PAID`), halaman otomatis berubah menjadi **Tiket Pengambilan Aktif** yang memuat:
     * **QR Code Pickup & 4-Digit Kode Unik (`pickup_code`, misal `SJ-4829`)**.
     * **Countdown Batas Waktu Pengambilan (`Segera ambil pesanan kamu sebelum jam 22:30`)**.
     * Tombol **"Petunjuk Arah (Google Maps)"** dan **"Hubungi Warung (WhatsApp)"**.
   * Setelah kode diverifikasi oleh warung (`COMPLETED`), muncul layar selebrasi `ThankyouScreen` & `SavingModal` berisi infografik dampak karbon yang bisa dibagikan ke Instagram Story/WhatsApp, diikuti form rating singkat (`AddReviewScreen`).

---

### 1.2. Key Screens/Pages & Spesifikasi Komponen Utama

Tabel berikut mendefinisikan daftar halaman wajib beserta dekomposisi komponen React/Next.js, props/state utama, dan referensi padanannya dari `Surplus.apk`:

| Grup Role | Route Path (Next.js App Router) | Nama Halaman & Padanan `Surplus.apk` | Komponen Utama di Dalamnya (Atomic / Feature Components) | State & Data Binding Utama |
| :--- | :--- | :--- | :--- | :--- |
| **Shared / Auth** | `/welcome` | **Welcoming & Role Switcher** (`WelcomingScreen`) | `HeroImpactCounter`, `RoleSelectorCard` (*"Cari Makanan Hemat"* vs *"Daftar Mitra Warung"*), `PWAInstallPromptBanner` | `deferredPrompt` (PWA install), `globalImpactStats` (total kg pangan & CO₂ platform) |
| **Shared / Auth** | `/auth/login` & `/auth/verify` | **Auth & OTP Screen** (`LoginScreen`, `VerificationScreen`, `AddressSetupScreen`) | `PhoneOrEmailInput`, `GoogleOAuthButton`, `OTPInput6Digits`, `CampusLocationPicker` (pilihan cepat kampus: UGM, ITB, UB, UI, dll.) | `authSession`, `otpCountdown`, `selectedCampusCoords` (`lat`, `lng`) |
| **Customer (Pembeli)** | `/discover` | **Customer Home / Discovery** (`DiscoverScreen`) | `StickyLocationHeader` (alamat + badge radius `2 km`), `ImpactCard` (*kg pangan & kg CO₂e*), `CategoryFilterChips` (`makanan_berat`, `makanan_vegan`, `bahan_makanan`, `Mystery Bag`), `Under10kCarousel` (`discover_under_10k_menu`), `UrgentClosingList` (*Hampir Habis*), `NearbyMerchantList` (`MerchantCard`) | `userLocation` (`lat, lng, radius`), `activeFilters`, `surplusFeedQuery` (TanStack Query + SSE live stock) |
| **Customer (Pembeli)** | `/map` | **Interactive Surplus Radar Map** (`NearbyMerchantMapScreen`) | `SurplusRadarMap` (MapLibre/Leaflet canvas + 2km radius circle), `DynamicDiscountPin` (pin menampilkan badge `-50%` s/d `-70%` & warna urgensi), `MapMerchantBottomSheet` (swipeable preview card), `RecenterLocationFAB` (`CurrentLocationButton`) | `mapBounds`, `selectedMerchantId`, `nearbyPins[]` (`merchant_id`, `lat`, `lng`, `max_discount_pct`, `total_available_stock`, `pickup_end_time`, `is_verified`) |
| **Customer (Pembeli)** | `/warung/[slug]` | **Merchant Storefront & Menu Detail** (`MerchantScreen`, `MenuScreen`) | `MerchantHeaderBanner` (logo, `VerifiedBadge`, rating, jarak km, jam batas ambil `pickup_start_time`–`pickup_end_time`), `DynamicPriceMenuCard` (harga asli coret, `selling_price`, badge `"Harga Turun Otomatis"`, sisa porsi `in_stock`, `ClosingCountdownTimer`), `DiffMerchantModal` (peringatan ganti warung), `FloatingCartBar` | `merchantDetail`, `activeBatchMenus[]`, `cartStore` (`merchantId`, `items[]`, `totalPrice`, `totalSavedKg`) |
| **Customer (Pembeli)** | `/checkout` | **Self-Pickup Checkout & QRIS Payment** (`CheckoutScreen`, `PickupMethodScreen`, `PaymentScreen`) | `SelfPickupInfoCard` (peta statis warung + peringatan `"Khusus Ambil Sendiri di Warung"`), `PickupTimeSlotSelector` (`ModalPickupTime`), `BringOwnContainerToggle` (`LunchboxModal`), `VoucherSelectorSheet` (`VoucherListScreen`), `PriceAndImpactBreakdown` (Harga Pemulihan, Komisi Rp 1.000, Penghematan Rp, & Estimasi `kgCO2e`), `QRISPaymentModal` (QRIS image, *Download QR*, status polling/webhook listener, `TimesUpModal`) | `pickupTimeSlot`, `useOwnContainer`, `selectedVoucher`, `orderDraft`, `paymentCountdown` (600 detik TTL) |
| **Customer (Pembeli)** | `/orders` & `/orders/[id]` | **Active Pickup Ticket & Order History** (`OrderDetailScreen`, `ThankyouScreen`, `AddReviewScreen`) | `OrderStatusTabs` (`Belum Dibayar`, `Siap Diambil`, `Selesai`, `Dibatalkan`), `DigitalPickupPass` (QR Code dinamis + `pickup_code` 4 digit besar + animasi anti-screenshot), `PickupDeadlineBanner`, `DirectionsAndWhatsAppButtons`, `ImpactCelebrationModal` (`SavingModal` + tombol share IG Story), `ReviewFormSheet` | `orderDetail`, `orderStatusSSE`, `pickupCode`, `impactEarned` (`food_saved_grams`, `co2_avoided_grams`) |
| **Customer (Pembeli)** | `/impact` | **Surplus Hero & Predictive Alerts** (`LoyaltyScreen`, `FavoriteScreen`) | `EcoHeroBadgeProgress` (`MyBadge`, level *Surplus Rookie* $\rightarrow$ *Surplus Hero*), `MonthlyImpactChart` (grafik kg makanan, CO₂e, dan uang mahasiswa yang dihemat), `PredictiveSubscriptionList` (daftar warung favorit dengan toggle *"Ingatkan saya tiap malam Jumat saat Warung X diprediksi punya surplus"*) | `userImpactSummary`, `favoriteMerchants[]`, `predictionSubscriptions[]` |
| **Merchant (Mitra Warung)** | `/merchant/dashboard` | **Merchant Command Center** | `StoreStatusHeader` (toggle Buka/Tutup + badge `"Mitra Terverifikasi"`), `AIPredictionAlertCard` (insight dari *Surplus Prediction Engine*: *"Prediksi malam ini: ~9 porsi berpotensi sisa pada pukul 20.30"*), `ActiveSurplusBatchList` (daftar menu live dengan indikator harga saat ini, countdown auto-discount berikutnya, dan tombol `+ / -` stok cepat), `IncomingPickupQueue` (antrean mahasiswa yang akan mengambil pesanan) | `merchantStats`, `aiDailyPrediction`, `activeBatches[]`, `pendingPickups[]` |
| **Merchant (Mitra Warung)** | `/merchant/surplus/new` | **AI-Assisted Quick Surplus Publisher** | `MenuTemplateSelector` (pilih menu satuan atau *Paket Kejutan / Mystery Box*), `PortionStepperInput` (input besar untuk jumlah porsi `initial_stock`), `AIDiscountRecommendationCard` (menampilkan output *Surplus Prediction Engine* [% peluang terjual] & *Dynamic Discount Optimizer* [kurva harga otomatis dari 50% $\rightarrow$ 70%]), `PickupWindowConfirm`, `OneTapPublishButton` | `selectedMenuId`, `inputQuantity`, `aiQuoteResponse` (`sellout_probability`, `recommended_discount_pct`, `recommended_selling_price_idr`, `escalation_schedule[]`) |
| **Merchant (Mitra Warung)** | `/merchant/orders/scan` | **QR / PIN Pickup Validator** | `HTML5QRScannerViewport` (kamera pemindai QR tiket pembeli), `ManualPinInput4Digits` (fallback input kode `SJ-XXXX`), `OrderVerificationSheet` (rincian menu yang harus diserahkan + opsional ambil foto bukti bungkusan), `CompletePickupButton` | `scannedCode`, `verifiedOrderData`, `isSubmittingVerification` |
| **Merchant (Mitra Warung)** | `/merchant/analytics` | **Revenue Recovery & Waste Reduction Insights** | `RevenueRecoveredCard` (total Rupiah yang diselamatkan bulan ini vs potensi terbuang), `WeeklySurplusHeatmap` (output analitik *Surplus Prediction Engine*: hari & menu apa yang paling sering berlebih untuk membantu warung mengurangi over-produksi), `PremiumPlanUpgradeCard` (langganan Rp 50.000/bulan untuk prioritas posisi listing) | `revenueMetrics`, `wasteHeatmapData`, `subscriptionStatus` |

---

### 1.3. Tech Stack Frontend (Rekomendasi Modern & Siap Produksi)

Menggabungkan kebutuhan **PWA lintas platform** dari proposal (`proposal_sisa_saji_final.md`) dengan pustaka terbukti yang digunakan di **`Surplus.apk`** (`@tanstack/react-query`, `tailwindcss`, `dayjs`, `axios`, `jwt-decode`), berikut adalah spesifikasi Tech Stack Frontend yang harus diinisialisasi oleh AI Coding Agent:

* **Core Framework:** **Next.js 14/15 (App Router, TypeScript)** — Mendukung Server Components untuk SEO/initial load cepat, serta Client Components interaktif untuk antarmuka pengguna & dasbor warung dalam satu repositori terpadu (atau monorepo Turborepo).
* **PWA & Service Worker Engine:** **`@serwist/next`** (penerus modern `next-pwa` berbasis Workbox) — Mengelola `manifest.json`, *Offline Fallback Shell* (agar tiket QR `pickup_code` tetap bisa dibuka mahasiswa meski sinyal di sekitar warung lemah), dan **Web Push API (`ServiceWorkerRegistration.showNotification`)** untuk notifikasi proaktif *Surplus Prediction Engine*.
* **Styling & UI System:** **Tailwind CSS v3.4+** + **shadcn/ui (Radix UI Primitives)** + **Lucide React Icons** + **Framer Motion** — Mobile-first viewport container (`max-w-md mx-auto min-h-dvh` untuk tampilan mobile layaknya aplikasi native seperti `Surplus.apk`, dengan *responsive split-view* pada layar desktop/tablet kasir warung).
* **State Management (Dual-Layer Pattern sesuai `Surplus.apk`):**
  * **Server State & Real-Time Caching:** **TanStack Query v5 (`@tanstack/react-query`)** — Mengatur fetching, optimistic updates stok, serta *auto-refetching* listing dalam radius.
  * **Client & Persistent Local State:** **Zustand** (dengan middleware `persist` ke `localStorage` / `IndexedDB`) — Menggantikan boilerplate Redux/Saga pada APK untuk menyimpan `cartStore` (dengan guardrail single-merchant), `locationStore` (`lat`, `lng`, `radius`), dan `offlineTicketStore` (menyimpan QR Pickup Ticket aktif secara offline).
* **Peta & Geolokasi:** **MapLibre GL JS (`react-map-gl`)** dengan tile gratis/hemat biaya dari **OpenStreetMap / Stadia / MapTiler** (atau **Google Maps JS API** sebagai opsi konfigurasi via `.env`), ditambah **Browser Geolocation API** dengan fallback pemilih titik kampus.
* **Pemindai & Generator QR (Krusial untuk QRIS & Self-Pickup):**
  * Generator QR Ticket & QRIS: **`qrcode.react`**
  * Pemindai QR di Dasbor Warung: **`html5-qrcode`** atau **`@yudiel/react-qr-scanner`**
* **Utilitas Waktu, Validasi & HTTP:** **`dayjs`** (beserta plugin `relativeTime`, `duration`, `timezone` untuk countdown akurat WIB/WITA/WIT), **`zod`** + **`react-hook-form`** (validasi input), dan **`ky` / `axios`** dengan JWT refresh token interceptor.

---

## 2. Backend & System Architecture

Berdasarkan proposal teknis Sisa-Saji, Backend menggunakan **Node.js**, **PostgreSQL**, dan **Redis**, serta berinteraksi dengan dua modul AI (**Dynamic Discount Optimizer** & **Surplus Prediction Engine**) dan **Payment Gateway Lokal (QRIS/E-Wallet)**.

```
+-----------------------------------------------------------------------------------+
|                        CLIENT LAYER: NEXT.JS PWA (Android / iOS / Web)            |
|   [Customer Discovery & Map UI]            [Merchant 1-Tap Surplus & Scanner UI]  |
+-------------------+-------------------------------------------+-------------------+
                    | HTTPS / REST API (JSON) + SSE + Web Push  |
                    v                                           v
+-----------------------------------------------------------------------------------+
|                     API GATEWAY & CORE BACKEND (Node.js + Fastify/NestJS)         |
|  +----------------+  +------------------+  +-----------------+  +--------------+  |
|  | Auth & RBAC    |  | Geo-Discovery    |  | Order & QRIS    |  | Impact &     |  |
|  | Module (JWT)   |  | Service          |  | Checkout Engine |  | Loyalty Svc  |  |
|  +----------------+  +--------+---------+  +--------+--------+  +--------------+  |
|                               |                     |                             |
|  +----------------------------v---------------------v--------------------------+  |
|  |      AI MODULE 1: DYNAMIC DISCOUNT OPTIMIZER (In-Process Rule Engine)       |  |
|  |  Evaluates: (stock_left, mins_to_close, active_users_2km, hist_conv_rate)   |  |
|  +----------------------------+---------------------+--------------------------+  |
+-------------------------------|---------------------|-----------------------------+
                                |                     |
          +---------------------+                     +--------------------+
          | Low-Latency Geo & Lock                    | Transactional ACID |
          v                                           v                    |
+-----------------------------------+       +------------------------------v--------+
|      REDIS 7 (Cache & BullMQ)     |       |   POSTGRESQL 16 + POSTGIS EXTENSION   |
| - GEOADD/GEOSEARCH active_merchants|      | - users, merchants (GEOGRAPHY Point)  |
| - Atomic Stock Lock (DECRBY + TTL)|       | - menus, surplus_batches, orders      |
| - Active Users Heartbeat (2km)    |       | - discount_adjustment_logs, reviews   |
| - BullMQ Cron (Every 5 mins price |       | - merchant_surplus_predictions        |
|   escalation & order expiry)      |       +-------------------+-------------------+
+-----------------+-----------------+                           |
                  |                                             | Weekly / Nightly
                  | Push Alerts &                               | Historical Data
                  | Cached Predictions                          v
                  |                         +---------------------------------------+
                  |                         | AI MODULE 2: SURPLUS PREDICTION ENGINE|
                  +-------------------------| (Python FastAPI / LightGBM Worker)    |
                                            | - Weekly Batch Training (Cron)        |
                                            | - Daily Surplus & Sell-out Inference  |
                                            +---------------------------------------+
```

### 2.1. Database Schema (PostgreSQL 16 + Ekstensi PostGIS)

Gunakan ekstensi **`postgis`** untuk kueri spasial radius 2 km yang sangat cepat (`ST_DWithin`) dan **`pgcrypto` / `uuid-ossp`** untuk UUID. Berikut adalah spesifikasi DDL SQL lengkap yang siap dijalankan melalui migrasi **Prisma ORM** atau **Drizzle ORM**:

```sql
-- Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 1. ENUMS
CREATE TYPE user_role AS ENUM ('CUSTOMER', 'MERCHANT', 'ADMIN');
CREATE TYPE merchant_tier AS ENUM ('REGULAR', 'PREMIUM');
CREATE TYPE menu_category AS ENUM ('MAKANAN_BERAT', 'MAKANAN_RINGAN', 'MAKANAN_VEGAN', 'MINUMAN', 'ROTI_PASTRY', 'BAHAN_MAKANAN', 'MYSTERY_BAG');
CREATE TYPE batch_status AS ENUM ('SCHEDULED', 'ACTIVE', 'SOLD_OUT', 'EXPIRED', 'CANCELLED');
CREATE TYPE order_status AS ENUM ('PENDING_PAYMENT', 'PAID', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED', 'EXPIRED');
CREATE TYPE payment_method_type AS ENUM ('QRIS', 'GOPAY', 'OVO', 'DANA', 'SURPLUS_PAY');

-- 2. USERS TABLE (Konsumen / Mahasiswa & Pemilik Warung)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role user_role NOT NULL DEFAULT 'CUSTOMER',
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(150) UNIQUE,
    phone_number VARCHAR(25) UNIQUE NOT NULL,
    password_hash TEXT,
    avatar_url TEXT,
    campus_or_area VARCHAR(100), -- Contoh: 'UGM Yogyakarta', 'ITB Bandung', 'UB Malang'
    default_lat DOUBLE PRECISION,
    default_lng DOUBLE PRECISION,
    webpush_subscription JSONB, -- Menyimpan endpoint & keys Web Push PWA
    loyalty_points INTEGER NOT NULL DEFAULT 0, -- Padanan 'my_point' di Surplus.apk
    badge_tier VARCHAR(50) NOT NULL DEFAULT 'SURPLUS_ROOKIE', -- 'SURPLUS_ROOKIE', 'SURPLUS_HERO'
    total_food_saved_grams INTEGER NOT NULL DEFAULT 0,
    total_co2_avoided_grams INTEGER NOT NULL DEFAULT 0,
    total_money_saved_idr BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. MERCHANTS TABLE (Mitra Warung / UMKM Kuliner)
CREATE TABLE merchants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    merchant_name VARCHAR(150) NOT NULL,
    slug VARCHAR(160) UNIQUE NOT NULL,
    merchant_category menu_category NOT NULL DEFAULT 'MAKANAN_BERAT',
    description TEXT,
    logo_url TEXT,
    banner_url TEXT,
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    geom GEOGRAPHY(Point, 4326) NOT NULL, -- PostGIS spatial column untuk query radius 2km
    operational_open_time TIME NOT NULL DEFAULT '09:00:00',
    operational_close_time TIME NOT NULL DEFAULT '22:00:00', -- Acuan utama Dynamic Discount Optimizer
    default_surplus_start_time TIME NOT NULL DEFAULT '20:00:00',
    is_open BOOLEAN NOT NULL DEFAULT TRUE,
    merchant_verified BOOLEAN NOT NULL DEFAULT FALSE, -- True jika terverifikasi higienitas / langganan Premium
    subscription_tier merchant_tier NOT NULL DEFAULT 'REGULAR',
    subscription_expires_at TIMESTAMPTZ,
    static_qris_payload TEXT, -- Mendukung warung kecil dengan QRIS statis maupun dinamis
    bank_code VARCHAR(30),
    bank_account_number VARCHAR(50),
    bank_account_holder VARCHAR(120),
    wallet_balance_idr BIGINT NOT NULL DEFAULT 0,
    historical_conversion_rate NUMERIC(5,4) NOT NULL DEFAULT 0.6500, -- Variabel input Dynamic Discount Optimizer (default 65% untuk warung baru)
    rating_avg NUMERIC(3,2) NOT NULL DEFAULT 5.00,
    total_reviews INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_merchants_geom ON merchants USING GIST (geom);
CREATE INDEX idx_merchants_tier_open ON merchants (is_open, subscription_tier, rating_avg DESC);

-- 4. MASTER MENUS TABLE (Katalog Menu Warung)
CREATE TABLE menus (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    menu_name VARCHAR(150) NOT NULL, -- Padanan 'nama_menu_makanan'
    category menu_category NOT NULL DEFAULT 'MAKANAN_BERAT',
    description TEXT,
    image_url TEXT,
    original_price_idr INTEGER NOT NULL CHECK (original_price_idr > 0), -- Harga normal sebelum diskon
    min_recovery_price_idr INTEGER NOT NULL CHECK (min_recovery_price_idr > 0), -- Batas bawah harga agar warung tidak rugi HPP
    portion_weight_grams INTEGER NOT NULL DEFAULT 200, -- Default 200g sesuai kalkulasi proposal (10 porsi = 2kg)
    is_mystery_bag BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menus_merchant ON menus (merchant_id, is_active);

-- 5. SURPLUS BATCHES TABLE (Listing Harian Porsi Sisa Real-Time - Padanan 'id_stocks' / 'menu_stock_id')
CREATE TABLE surplus_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    menu_id UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    batch_date DATE NOT NULL DEFAULT CURRENT_DATE,
    initial_stock INTEGER NOT NULL CHECK (initial_stock > 0),
    available_stock INTEGER NOT NULL CHECK (available_stock >= 0),
    reserved_stock INTEGER NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0), -- Stok yang sedang dikunci di halaman checkout (TTL 10m)
    original_price_idr INTEGER NOT NULL,
    current_discount_pct INTEGER NOT NULL CHECK (current_discount_pct BETWEEN 10 AND 90), -- Contoh: 50 (%) -> naik otomatis ke 70 (%)
    current_selling_price_idr INTEGER NOT NULL, -- Padanan 'selling_price'
    auto_discount_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    predicted_sellout_prob NUMERIC(5,4), -- Estimasi dari Surplus Prediction Engine saat batch dibuat (0.0000 - 1.0000)
    pickup_start_time TIMESTAMPTZ NOT NULL, -- Padanan 'pickup_start_time'
    pickup_end_time TIMESTAMPTZ NOT NULL,   -- Padanan 'pickup_end_time' (batas waktu ambil sebelum warung tutup)
    status batch_status NOT NULL DEFAULT 'ACTIVE',
    last_price_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_batches_active_window ON surplus_batches (status, pickup_end_time, current_selling_price_idr);
CREATE INDEX idx_batches_merchant_date ON surplus_batches (merchant_id, batch_date);

-- 6. ORDERS / TRANSACTIONS TABLE (Transaksi Self-Pickup)
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number VARCHAR(32) UNIQUE NOT NULL, -- Contoh: 'SS-20261107-8941' (Padanan 'order_no')
    customer_id UUID NOT NULL REFERENCES users(id),
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    status order_status NOT NULL DEFAULT 'PENDING_PAYMENT',
    pickup_code VARCHAR(10) NOT NULL, -- 4-6 karakter kode verifikasi ambil sendiri (Padanan 'Kode Pengambilan')
    pickup_qr_token TEXT UNIQUE NOT NULL, -- Signed HMAC token untuk pemindaian QR di warung
    scheduled_pickup_time TIMESTAMPTZ, -- Padanan 'pickup_time'
    pickup_deadline_at TIMESTAMPTZ NOT NULL,
    uses_own_lunchbox BOOLEAN NOT NULL DEFAULT FALSE, -- Padanan 'lunchbox_discount'
    subtotal_original_idr INTEGER NOT NULL,
    subtotal_recovery_idr INTEGER NOT NULL, -- Total harga setelah diskon pemulihan
    voucher_discount_idr INTEGER NOT NULL DEFAULT 0,
    platform_commission_idr INTEGER NOT NULL DEFAULT 1500, -- Stream 1 Proposal: Rp 1.000 - Rp 2.000 per transaksi
    total_customer_paid_idr INTEGER NOT NULL,
    net_merchant_payout_idr INTEGER NOT NULL,
    payment_method payment_method_type NOT NULL DEFAULT 'QRIS',
    payment_gateway_ref VARCHAR(120), -- Reference ID dari Midtrans / Xendit
    qris_dynamic_string TEXT,
    payment_expires_at TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    picked_up_at TIMESTAMPTZ,
    pickup_proof_image_url TEXT, -- Foto validasi pengambilan (opsional)
    cancel_reason TEXT,
    total_food_saved_grams INTEGER NOT NULL DEFAULT 0, -- Kuantifikasi dampak transaksi ini
    total_co2_avoided_grams INTEGER NOT NULL DEFAULT 0, -- = (total_food_saved_grams * 2.5)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_customer_status ON orders (customer_id, status, created_at DESC);
CREATE INDEX idx_orders_merchant_status ON orders (merchant_id, status, pickup_deadline_at ASC);

-- 7. ORDER ITEMS TABLE
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    surplus_batch_id UUID NOT NULL REFERENCES surplus_batches(id),
    menu_id UUID NOT NULL REFERENCES menus(id),
    menu_name_snapshot VARCHAR(150) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_original_price_idr INTEGER NOT NULL,
    unit_selling_price_idr INTEGER NOT NULL,
    discount_pct_applied INTEGER NOT NULL,
    portion_weight_grams INTEGER NOT NULL DEFAULT 200
);

-- 8. DISCOUNT ADJUSTMENT LOGS (Audit Trail Dynamic Discount Optimizer)
CREATE TABLE discount_adjustment_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    surplus_batch_id UUID NOT NULL REFERENCES surplus_batches(id) ON DELETE CASCADE,
    previous_discount_pct INTEGER NOT NULL,
    new_discount_pct INTEGER NOT NULL,
    previous_price_idr INTEGER NOT NULL,
    new_price_idr INTEGER NOT NULL,
    remaining_stock INTEGER NOT NULL,
    minutes_to_closing INTEGER NOT NULL,
    active_users_in_radius INTEGER NOT NULL,
    trigger_reason VARCHAR(100) NOT NULL, -- Contoh: 'INITIAL_PUBLISH', 'TIME_DECAY_30M_RULE', 'LOW_DEMAND_BOOST'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. MERCHANT HISTORICAL SURPLUS & PREDICTIONS (Tabel Data Latih & Output Surplus Prediction Engine)
CREATE TABLE merchant_surplus_predictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    menu_id UUID REFERENCES menus(id) ON DELETE CASCADE,
    target_date DATE NOT NULL,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Minggu .. 5=Jumat, 6=Sabtu
    predicted_surplus_portions NUMERIC(6,2) NOT NULL,
    predicted_peak_surplus_hour TIME NOT NULL DEFAULT '20:00:00',
    sellout_probability_at_50pct NUMERIC(5,4) NOT NULL,
    confidence_score NUMERIC(5,4) NOT NULL,
    model_version VARCHAR(40) NOT NULL,
    proactive_notif_sent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (merchant_id, menu_id, target_date)
);

-- 10. CUSTOMER FAVORITES & PROACTIVE ALERT SUBSCRIPTIONS (Untuk Notifikasi "Warung X biasanya surplus malam Jumat")
CREATE TABLE customer_merchant_subscriptions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    notify_on_surplus_live BOOLEAN NOT NULL DEFAULT TRUE,
    notify_on_ai_prediction BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, merchant_id)
);

-- 11. REVIEWS TABLE
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES users(id),
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    tags TEXT[], -- Contoh: ['Porsi Banyak', 'Masih Hangat', 'Pelayanan Ramah']
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### 2.2. API Endpoints (RESTful API v1 Contract + SSE)

Seluruh endpoint menggunakan prefix `/api/v1` dengan autentikasi `Authorization: Bearer <access_token>` (JWT) dan format respons standar `{ success: boolean, data: T, meta?: object, error?: { code: string, message: string } }`.

#### A. Modul Auth & Profil (`/api/v1/auth` & `/api/v1/profile`)
| Method | Endpoint | Role | Deskripsi & Kontrak Payload / Query |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/otp/request` | Public | Mengirim kode OTP 6 digit via WhatsApp/SMS/Email. Body: `{ phone_number, role }`. |
| `POST` | `/api/v1/auth/otp/verify` | Public | Verifikasi OTP & mereturn `{ access_token, refresh_token, user }`. |
| `POST` | `/api/v1/auth/oauth/google` | Public | Login cepat mahasiswa/merchant menggunakan Google ID Token. |
| `PUT` | `/api/v1/profile/location-push` | Auth | Menyimpan lokasi aktif (`lat, lng`) ke Redis Geo-Presence (untuk menghitung *active users in radius*) & mendaftarkan `webpush_subscription`. |
| `GET` | `/api/v1/profile/impact` | Auth | Mengambil ringkasan dampak personal (`total_food_saved_grams`, `total_co2_avoided_grams`, `total_money_saved_idr`, `badge_tier`, histori bulanan). |

#### B. Modul Customer Discovery & Geolocation (`/api/v1/discover`)
| Method | Endpoint | Role | Deskripsi & Kontrak Payload / Query |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/discover/nearby` | Customer | **Core Geo-Query:** Mengambil daftar warung & batch surplus aktif dalam radius. Query: `?lat=-7.77&lng=110.37&radius_m=2000&category=MAKANAN_BERAT&max_price=10000&sort=priority_distance`. Menggabungkan prioritas `subscription_tier = 'PREMIUM'` + jarak `ST_Distance` + sisa waktu tutup. |
| `GET` | `/api/v1/discover/map-pins` | Customer | Mengambil payload ringan untuk pin peta interaktif (`merchant_id, merchant_name, lat, lng, max_discount_pct, total_available_stock, pickup_end_time, is_verified`). Di-cache di Redis selama 15 detik. |
| `GET` | `/api/v1/merchants/:slugOrId` | Customer | Mengambil profil lengkap warung, daftar `surplus_batches` yang `ACTIVE` malam ini, ulasan terbaru, dan jarak dari titik pengguna. |
| `POST` | `/api/v1/merchants/:id/subscribe` | Customer | Toggle favorit & langganan notifikasi prediksi AI untuk warung tertentu (`notify_on_surplus_live`, `notify_on_ai_prediction`). |
| `GET` | `/api/v1/stream/batches` | Customer | **Server-Sent Events (SSE):** Stream real-time perubahan `available_stock` dan kenaikan `current_discount_pct` untuk batch di area pengguna. |

#### C. Modul Checkout, Pembayaran QRIS & Self-Pickup (`/api/v1/orders`)
| Method | Endpoint | Role | Deskripsi & Kontrak Payload / Query |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/orders/checkout` | Customer | **Atomic Reservation & QRIS Generation:** Body: `{ merchant_id, items: [{ batch_id, quantity }], scheduled_pickup_time, uses_own_lunchbox, payment_method: 'QRIS' }`. Mengeksekusi Lua Script di Redis untuk mendekremen `available_stock` secara atomik (mencegah *race condition/overselling*), membuat record `orders` (`PENDING_PAYMENT`), memanggil Payment Gateway (Midtrans/Xendit) untuk membuat QRIS Dinamis, dan mereturn `qris_dynamic_string` serta `payment_expires_at` (10 menit). |
| `POST` | `/api/v1/webhooks/payment` | System | Webhook callback dari Payment Gateway. Memvalidasi signature SHA-512, mengubah status pesanan menjadi `READY_FOR_PICKUP`, menerbitkan `pickup_code` 4 digit & `pickup_qr_token`, serta mengirim notifikasi ke kasir warung & pembeli. |
| `GET` | `/api/v1/orders/:id` | Auth | Mengambil detail pesanan, status pembayaran real-time, `pickup_code`, `pickup_qr_token`, koordinat arah warung, dan rincian dampak karbon. |
| `POST` | `/api/v1/orders/:id/verify-pickup`| Merchant | **Verifikasi Pengambilan di Warung:** Body: `{ pickup_code_or_qr_token, proof_image_url? }`. Memvalidasi kecocokan kode & kepemilikan warung, mengubah status menjadi `COMPLETED`, mengkreditkan `net_merchant_payout_idr` ke saldo warung, serta menambahkan `total_food_saved_grams` & `total_co2_avoided_grams` ke ledger pengguna dan warung. |

#### D. Modul Merchant & Integrasi AI (`/api/v1/merchant`)
| Method | Endpoint | Role | Deskripsi & Kontrak Payload / Query |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/merchant/surplus/quote-ai` | Merchant | **Simulasi Pra-Publikasi AI:** Body: `{ menu_id, available_stock, pickup_end_time }`. Memanggil *Surplus Prediction Engine* & *Dynamic Discount Optimizer* secara sinkron (< 50ms) untuk mereturn: `{ sellout_probability, recommended_discount_pct, recommended_selling_price_idr, escalation_schedule: [{ time: '21:30', discount_pct: 60 }, { time: '22:00', discount_pct: 70 }] }`. |
| `POST` | `/api/v1/merchant/surplus/publish` | Merchant | Mempublikasikan batch porsi sisa malam ini ke database & Redis Geo-Index, sekaligus memicu job BullMQ untuk mengirim Web Push ke pengguna dalam radius 2 km. |
| `PATCH`| `/api/v1/merchant/surplus/:batchId/stock` | Merchant | Update cepat jumlah porsi tersisa (`+ / -`) jika ada porsi yang terjual offline di warung. |
| `GET` | `/api/v1/merchant/predictions/insights` | Merchant | Mengambil prediksi mingguan dari *Surplus Prediction Engine* (estimasi potensi sisa per hari/menu & rekomendasi pengurangan porsi masak untuk menekan over-produksi). |

---

### 2.3. Strategi Arsitektur Integrasi Modul AI

Sesuai dokumen proposal Sisa-Saji, kedua fitur AI dirancang agar **pragmatis, hemat biaya komputasi (sesuai unit economics Rp 3–5 juta/bulan di fase pilot), dan tetap berfungsi penuh meskipun warung baru bergabung (cold-start ready)**.

#### 1. Arsitektur `Dynamic Discount Optimizer` (Real-Time Adaptive Rule & Scoring Engine)
* **Penempatan Layanan:** Diimplementasikan langsung sebagai **In-Process TypeScript Module (`DynamicDiscountService`)** di dalam Backend Node.js yang dipicu melalui dua jalur:
  1. **On-Demand (Synchronous):** Saat merchant menginput jumlah porsi sisa pada pukul 20.00 (`POST /api/v1/merchant/surplus/quote-ai`).
  2. **Scheduled Time-Decay Worker (BullMQ Cron setiap 5 menit):** Mengevaluasi seluruh `surplus_batches` berstatus `ACTIVE` dan menaikkan diskon secara otomatis seiring mendekati `pickup_end_time`.
* **Variabel Input (4 Parameter Inti sesuai Proposal):**
  1. $S_{rem}$ (`available_stock`): Jumlah porsi tersisa saat ini.
  2. $\Delta t$ (`minutes_to_close`): Selisih menit antara waktu sekarang (`NOW()`) dengan jam tutup warung (`pickup_end_time`).
  3. $U_{2km}$ (`active_users_in_radius`): Jumlah pengguna aktif dalam radius 2 km dari koordinat warung selama 30 menit terakhir (dihitung secara instan via `GEOSEARCH` pada Redis key `presence:customers:geo`).
  4. $CR_{hist}$ (`historical_conversion_rate`): Rata-rata rasio porsi terjual per jam milik warung tersebut (default `0.65` untuk warung baru tanpa histori).
* **Algoritma & Aturan Threshold (Deterministic + Demand-Adjusted Formula):**

$$\text{UrgencyIndex} = \left(\frac{S_{rem}}{\max(1, \Delta t / 30)}\right) \times \left(\frac{1}{\max(0.3, CR_{hist})}\right) \times \text{DemandFactor}(U_{2km})$$

  **Tabel Aturan Threshold & Eskalasi Otomatis (Sesuai Spesifikasi Proposal Bab 4):**

| Waktu Tersisa ($\Delta t$) | Kondisi Stok ($S_{rem}$) & Permintaan ($U_{2km}$) | Diskon Dasar (`discount_pct`) | Penyesuaian Adaptif (Rule Engine) |
| :--- | :--- | :--- | :--- |
| **$\ge 120$ menit** (Misal 20:00 untuk tutup 22:00) | $S_{rem} \ge 10$ porsi | **50%** | Jika $U_{2km}$ sangat tinggi ($> 50$ user aktif) & $CR_{hist} > 0.80$, diskon ditahan di **40%–45%** untuk mengoptimalkan margin warung. |
| **$60 - 119$ menit** sebelum tutup | $S_{rem} \ge 5$ porsi | **55% – 60%** | Naik otomatis +5% s/d +10% jika laju penjualan 30 menit pertama di bawah target kurva deplesi linear. |
| **$30 - 59$ menit** sebelum tutup | $S_{rem} \ge 5$ porsi | **70%** *(Sesuai contoh eksplisit proposal)* | Memicu event `URGENT_PRICE_DROP`: mengirim Push Notification *"Flash Rescue 70%"* ke pengguna dalam radius 1,5 km. |
| **$< 30$ menit** sebelum tutup | $S_{rem} \ge 1$ porsi | **70% – 80%** *(Capped pada `min_recovery_price_idr`)* | Diskon maksimum namun harga jual tidak pernah boleh turun di bawah `menus.min_recovery_price_idr` yang ditetapkan warung. |

* **Contoh Implementasi Kode Inti (`DynamicDiscountService.ts`) untuk AI Coding Agent:**
```typescript
export interface DiscountContext {
  originalPriceIdr: number;
  minRecoveryPriceIdr: number;
  availableStock: number;
  minutesToClose: number;
  activeUsersIn2km: number;
  historicalConversionRate: number; // 0.0 - 1.0 (default 0.65 for cold-start)
}

export function calculateOptimalRecoveryPrice(ctx: DiscountContext) {
  let discountPct = 50; // Baseline proposal: 2 jam sebelum tutup dengan 10 porsi = 50%

  // 1. Time-to-Close & Remaining Stock Thresholds (Proposal Rule)
  if (ctx.minutesToClose <= 30 && ctx.availableStock >= 5) {
    discountPct = 70;
  } else if (ctx.minutesToClose <= 30 && ctx.availableStock >= 1) {
    discountPct = 65;
  } else if (ctx.minutesToClose <= 60 && ctx.availableStock >= 5) {
    discountPct = 60;
  } else if (ctx.minutesToClose <= 90 && ctx.availableStock >= 8) {
    discountPct = 55;
  }

  // 2. Real-time Local Demand & Historical Conversion Adjustment
  const demandRatio = ctx.activeUsersIn2km / Math.max(1, ctx.availableStock * 3);
  if (demandRatio < 0.8 && ctx.historicalConversionRate < 0.5) {
    discountPct = Math.min(75, discountPct + 5); // Boost konversi jika area sepi
  } else if (demandRatio > 2.5 && ctx.historicalConversionRate > 0.8 && ctx.minutesToClose > 90) {
    discountPct = Math.max(40, discountPct - 5); // Jaga margin warung jika demand tinggi
  }

  // 3. Enforce Floor Price (minRecoveryPriceIdr) & Pembulatan Rp 500 terdekat
  const rawPrice = ctx.originalPriceIdr * (1 - discountPct / 100);
  const roundedPrice = Math.ceil(rawPrice / 500) * 500;
  const finalSellingPriceIdr = Math.max(ctx.minRecoveryPriceIdr, roundedPrice);
  const effectiveDiscountPct = Math.round((1 - finalSellingPriceIdr / ctx.originalPriceIdr) * 100);

  return {
    recommendedDiscountPct: effectiveDiscountPct,
    recommendedSellingPriceIdr: finalSellingPriceIdr,
  };
}
```

#### 2. Arsitektur `Surplus Prediction Engine` (Gradient Boosting Batch ML Pipeline)
* **Arsitektur & Pemisahan Beban Kerja:** Sesuai proposal Bab 5 (*"Model machine learning ringan regresi berbasis gradient boosting yang berjalan di server... diperbarui secara mingguan menggunakan data batch, bukan real-time, untuk menjaga efisiensi komputasi"*):
  * **Training & Batch Inference Worker (Python 3.11 + `scikit-learn` / `LightGBM` + `FastAPI` atau CLI Script):** Berjalan sebagai container/worker ringan yang dieksekusi oleh penjadwal mingguan & harian.
  * **Penyimpanan Prediksi (Zero-Latency Serving):** Hasil prediksi batch langsung ditulis ke tabel PostgreSQL `merchant_surplus_predictions` dan di-cache ke Redis. Dengan demikian, ketika API Node.js membutuhkan prediksi saat merchant membuka dasbor pukul 20.00, Node.js cukup membaca hasil pre-computed dari PostgreSQL/Redis dalam waktu **$< 5\text{ ms}$** tanpa perlu memanggil proses Python secara sinkron di jalur kritis transaksi.
* **Fitur Input Model (Feature Engineering):**
  * `merchant_id`, `menu_id`, `category`
  * `day_of_week` (0–6), `is_weekend`, `is_exam_or_holiday_week` (kalender akademik kota kampus), `is_end_of_month` (tanggal 25–31, korelasi kuat dengan lonjakan permintaan mahasiswa)
  * `rolling_4w_avg_surplus_portions`: Rata-rata porsi sisa pada hari yang sama dalam 4 minggu terakhir.
  * `rolling_4w_sellout_rate`: Rasio porsi habis terjual pada tingkat diskon 50%, 60%, dan 70%.
  * `rain_probability_evening`: Prakiraan cuaca jam 18.00–22.00 di koordinat warung (hujan sore/malam meningkatkan jumlah porsi sisa warung secara signifikan).
* **Siklus Operasional Batch (3 Cron Jobs Utama):**
  1. **Weekly Model Retraining (`Minggu Pukul 02:00 WIB`):** Mengambil data transaksi & batch 12 minggu terakhir dari PostgreSQL, melatih model `LightGBMRegressor` (untuk prediksi jumlah porsi surplus $\hat{y}_{\text{portions}}$) dan `LightGBMClassifier` (untuk estimasi probabilitas habis terjual $P(\text{sellout})$), menyimpan artefak model `.pkl/.txt`, lalu mengisi tabel `merchant_surplus_predictions` untuk 7 hari ke depan.
  2. **Proactive Customer Notification Trigger (`Setiap Hari Pukul 17:30 WIB`):** Mengambil warung yang memiliki `predicted_surplus_portions >= 5` dan `confidence_score >= 0.70` untuk malam tersebut, lalu mengirimkan Web Push Notification ke pelanggan yang berlangganan warung tersebut: *"Warung Padang Murah biasanya punya surplus Nasi Rendang malam Jumat mulai jam 20.00. Mau diingatkan saat stok dibuka?"*
  3. **Merchant Production Advisory (`Setiap Senin Pukul 07:00 WIB`):** Mengirimkan ringkasan analitik ke dasbor warung: *"Minggu lalu rata-rata Ayam Bakar tersisa 9 porsi tiap hari Selasa & Rabu. Kurangi produksi ~5 porsi pada hari tersebut untuk menghemat biaya bahan baku Rp 60.000/hari."*

---

## 3. Langkah Implementasi Selanjutnya (Actionable MVP Execution Plan)

Daftar urutan pengerjaan teknis (Fase MVP) di bawah ini dirancang secara modular agar Anda dapat menyalin perintah per fase dan menugaskannya langsung kepada saya (atau AI Coding Agent) pada prompt berikutnya:

### Fase 1: Inisialisasi Monorepo, Skema Database PostGIS, & Seed Data Kampus
* [ ] **1.1. Setup Project Structure:** Inisialisasi proyek menggunakan **Next.js 14/15 (App Router, TypeScript, Tailwind CSS, shadcn/ui)** dengan arsitektur Full-Stack terintegrasi (atau monorepo `apps/web-pwa` + `apps/api-server`) beserta konfigurasi `docker-compose.yml` untuk **PostgreSQL 16 (image `postgis/postgis:16-3.4-alpine`)** dan **Redis 7 (`redis:7-alpine`)**.
* [ ] **1.2. Database Migration & ORM:** Implementasikan seluruh 11 tabel skema PostgreSQL + indeks spasial `GIST(geom)` di atas menggunakan **Prisma** atau **Drizzle ORM**.
* [ ] **1.3. Realistic Campus Seeder (`seed.ts`):** Buat skrip seeder berisi 15 mitra warung realistis di sekitar kawasan kampus (misal: kawasan Pogung/Gejayan Yogyakarta, Dipatiukur/Cisitu Bandung, atau Sumbersari Malang), lengkap dengan koordinat GPS nyata, menu seharga Rp 12.000–Rp 25.000, batch surplus aktif malam ini, dan histori 4 minggu untuk pengujian AI.

### Fase 2: Engine AI (`Dynamic Discount Optimizer` & `Surplus Prediction Engine`) + Geo-Discovery API
* [ ] **2.1. Implementasi `DynamicDiscountService` & BullMQ Worker:** Bangun modul kalkulasi harga pemulihan dinamis (threshold 50% pada H-2 jam $\rightarrow$ 70% pada H-30 menit) beserta unit test untuk memastikan harga tidak pernah menembus batas bawah `min_recovery_price_idr`.
* [ ] **2.2. Implementasi `SurplusPredictionService`:** Bangun modul inferensi prediksi surplus (dilengkapi *heuristic fallback* untuk warung baru dan *LightGBM batch script* untuk data historis) serta endpoint `POST /api/v1/merchant/surplus/quote-ai`.
* [ ] **2.3. PostGIS Radius Discovery API:** Bangun endpoint `GET /api/v1/discover/nearby` dan `GET /api/v1/discover/map-pins` menggunakan kueri `ST_DWithin(geom, ST_MakePoint(lng, lat)::geography, radius_m)` dengan sorting hibrida (*Mitra Terverifikasi / Premium* + *Jarak Terdekat* + *Diskon Tertinggi*).

### Fase 3: UI/UX Pembeli (Customer PWA — Discovery, Radar Map 2km, & Self-Pickup Checkout)
* [ ] **3.1. Halaman Utama `/discover` & `ImpactCard`:** Implementasikan UI mobile-first dengan pemilih lokasi kampus, kartu dampak karbon personal (`kg pangan` & `kg CO₂e`), karusel *"Makan Malam di Bawah Rp 10.000"*, dan kartu menu dengan *live countdown timer*.
* [ ] **3.2. Peta Interaktif `/map` (`NearbyMerchantMapScreen`):** Integrasikan MapLibre GL / Leaflet dengan visualisasi lingkaran radius 2 km, pin diskon dinamis (`-50%` s/d `-70%`), dan *swipeable bottom sheet preview*.
* [ ] **3.3. Alur Checkout QRIS & Tiket Self-Pickup (`/checkout` & `/orders/[id]`):** Implementasikan guardrail keranjang satu-warung (`DiffMerchantModal`), penguncian stok Redis TTL 10 menit, simulator pembayaran QRIS instan (untuk demo/MVP), serta layar **Digital Pickup Pass** berisi QR Code & 4-Digit `pickup_code` yang dapat diakses secara offline via Service Worker PWA.

### Fase 4: UI/UX Mitra Warung (Merchant PWA — 1-Tap Surplus Publisher & QR Scanner)
* [ ] **4.1. Wizard Publikasi Sisa Makanan (`/merchant/surplus/new`):** Bangun antarmuka *60-Second Surplus Input* dengan stepper porsi besar, kartu rekomendasi harga & probabilitas terjual dari AI, serta tombol **1-Tap Publish**.
* [ ] **4.2. Pemindai QR & Verifikasi PIN (`/merchant/orders/scan`):** Integrasikan pemindai kamera QR dan input 4 digit `pickup_code` untuk memvalidasi pengambilan pesanan oleh mahasiswa dan mencairkan saldo warung secara instan.
* [ ] **4.3. Dasbor Dampak & Langganan Mitra Terverifikasi (`/merchant/dashboard` & `/merchant/analytics`):** Bangun visualisasi pendapatan yang berhasil dipulihkan dari limbah, heatmap prediksi sisa mingguan, dan fitur upgrade *Premium Listing (Rp 50.000/bulan)*.
