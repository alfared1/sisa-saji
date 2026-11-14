/**
 * Copy for /tour: five steps per track. Every number here comes from
 * src/lib/constants.ts (surplus window, radius, service fee, lock time, CO₂e
 * factor, badge thresholds, escalation cadence), so the tour cannot drift from
 * the rules the app enforces.
 */
import type { LucideIcon } from "lucide-react";
import {
  BellRingIcon,
  CalculatorIcon,
  CalendarClockIcon,
  ChartColumnIcon,
  ClipboardListIcon,
  Clock3Icon,
  CloudIcon,
  CloudOffIcon,
  FlameIcon,
  FootprintsIcon,
  KeyboardIcon,
  LeafIcon,
  MapIcon,
  QrCodeIcon,
  ReceiptTextIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SproutIcon,
  StoreIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";
import { impactFigures } from "@/components/common/impact-text";
import {
  BADGE_TIERS,
  CO2E_PER_KG_FOOD,
  DEFAULT_PORTION_WEIGHT_GRAMS,
  DEFAULT_SEARCH_RADIUS_M,
  ESCALATION_INTERVAL_MINUTES,
  PAY_AT_WARUNG_HOLD_MINUTES,
  PAYMENT_TTL_SECONDS,
  PLATFORM_COMMISSION_DEFAULT_IDR,
  SURPLUS_WINDOW_END,
  SURPLUS_WINDOW_START,
} from "@/lib/constants";
import { formatIdr } from "@/lib/time";
import type { TourRole } from "./tour-logic";

/** "20.00–23.00 WIB" (Indonesian clock dots, en dash for the range). */
export const SURPLUS_WINDOW_LABEL = `${SURPLUS_WINDOW_START.replace(":", ".")}–${SURPLUS_WINDOW_END.replace(":", ".")} WIB`;

const NBSP = String.fromCharCode(0x00a0);
const WORD_JOINER = String.fromCharCode(0x2060);
const NB_HYPHEN = String.fromCharCode(0x2011);

/**
 * Keeps numbers with their units and ranges in one piece when the copy wraps
 * ("2 km", "Rp 1.500", "20.00–23.00 WIB", "m-banking"), so a line never ends
 * in "Rp" or starts with "km".
 */
export function keepTogether(text: string): string {
  return text
    .replace(/([0-9]) (km|kg|g|menit|WIB|porsi)(?![A-Za-z])/g, `$1${NBSP}$2`)
    .replace(/Rp (?=[0-9])/g, `Rp${NBSP}`)
    .replace(/([0-9])([–-])([0-9])/g, `$1${WORD_JOINER}$2${WORD_JOINER}$3`)
    .replace(/(^|[^A-Za-z])(m|HP)-(banking|mu)(?![A-Za-z])/g, `$1$2${NB_HYPHEN}$3`);
}

export const LOCK_MINUTES = Math.round(PAYMENT_TTL_SECONDS / 60);
export const RADIUS_KM = DEFAULT_SEARCH_RADIUS_M / 1000;
export const SERVICE_FEE_LABEL = formatIdr(PLATFORM_COMMISSION_DEFAULT_IDR);

/** CO₂e avoided by one default portion: "0,5 kg". */
export const PORTION_CO2 = impactFigures(DEFAULT_PORTION_WEIGHT_GRAMS).co2;
/** Badge thresholds in kg: Penyelamat, Juara Pangan. */
export const SAVER_KG = BADGE_TIERS[1].minFoodSavedGrams / 1000;
export const HERO_KG = BADGE_TIERS[2].minFoodSavedGrams / 1000;
const CO2_PER_KG = CO2E_PER_KG_FOOD.toLocaleString("id-ID");

export type TourMockId =
  | "pembeli-sambut"
  | "pembeli-cari"
  | "pembeli-pesan"
  | "pembeli-ambil"
  | "pembeli-dampak"
  | "mitra-gabung"
  | "mitra-publikasi"
  | "mitra-eskalasi"
  | "mitra-serahkan"
  | "mitra-analitik";

export type TourStep = {
  id: TourMockId;
  title: string;
  body: string;
  bullets: { icon: LucideIcon; text: string }[];
  /** Stage tint behind the phone: alternates so consecutive steps read as different screens. */
  tint: "brand" | "deal";
  /** One line for screen readers: the phone preview itself is decorative (aria-hidden). */
  mockLabel: string;
};

const STEPS: Record<TourRole, TourStep[]> = {
  pembeli: [
    {
      id: "pembeli-sambut",
      title: "Makan malam kenyang mulai Rp 10.000",
      body: "Menjelang tutup, warung dekat kosmu menjual porsi yang belum laku dengan harga miring. Isi menunya jelas, porsinya normal, dan kamu ambil sendiri tanpa ongkos kirim.",
      bullets: [
        { icon: Clock3Icon, text: `Porsi malam muncul tiap malam, ${SURPLUS_WINDOW_LABEL}` },
        { icon: ClipboardListIcon, text: "Isi porsi, lauk tersisa, dan nilai kebersihan dari pembeli lain tertulis jelas" },
        { icon: LeafIcon, text: `Satu porsi yang terselamatkan mencegah ±${PORTION_CO2} emisi CO₂e` },
      ],
      tint: "brand",
      mockLabel: `Contoh tampilan beranda: ringkasan dampak bersama dan jam selamatkan makanan ${SURPLUS_WINDOW_LABEL}.`,
    },
    {
      id: "pembeli-cari",
      title: "Temukan warung yang bisa dijalan kaki",
      body: `Beranda menampilkan porsi malam dalam radius ${RADIUS_KM} km, lengkap dengan jaraknya dalam meter. Makin dekat jam tutup, makin besar diskonnya.`,
      bullets: [
        { icon: SlidersHorizontalIcon, text: "Filter cepat: “< 500 m”, “Harga ≤ Rp 12.000”, atau “Diskon ≥ 30%”" },
        { icon: MapIcon, text: "Buka Peta untuk melihat warung di sekitarmu" },
        { icon: FlameIcon, text: "Label “Hampir Habis!” berarti porsinya tinggal sedikit" },
      ],
      tint: "deal",
      mockLabel: "Contoh tampilan daftar porsi malam di sekitar IPB Dramaga dengan filter cepat di bawah 500 m, lauk tersisa, label diskon, dan sisa porsi.",
    },
    {
      id: "pembeli-pesan",
      title: "Kunci porsi, bayar QRIS atau tunai",
      body: `Pilih porsi dan lauknya, lalu tekan Kunci Porsi Sekarang. Kalau bayar QRIS, porsimu dikunci ${LOCK_MINUTES} menit selama kamu membayar.`,
      bullets: [
        { icon: WalletIcon, text: "QRIS Instan, paling populer. GoPay dan DANA juga bisa" },
        { icon: StoreIcon, text: `Bayar tunai di warung dengan porsi ditahan ${PAY_AT_WARUNG_HOLD_MINUTES} menit` },
        { icon: ReceiptTextIcon, text: `Biaya layanan ${SERVICE_FEE_LABEL} untuk bayar online, tampil sebelum bayar` },
      ],
      tint: "brand",
      mockLabel: `Contoh pesan cepat: satu porsi Nasi Timbel dengan lauk ayam goreng, biaya layanan ${SERVICE_FEE_LABEL}, dan tombol Kunci Porsi Sekarang.`,
    },
    {
      id: "pembeli-ambil",
      title: "Ambil sendiri dengan kode",
      body: "Datang ke warung sebelum batas ambil, lalu tunjukkan QR atau sebutkan kode SJ-. Tiketmu tetap bisa dibuka walau sinyal hilang.",
      bullets: [
        { icon: QrCodeIcon, text: "Kasir memindai QR atau mengetik 4 digit kodenya" },
        { icon: CloudOffIcon, text: "Tiket tersimpan di HP-mu, terbuka tanpa internet" },
      ],
      tint: "deal",
      mockLabel: "Contoh tiket pengambilan berkode SJ-8515 dengan kode QR, tersimpan offline.",
    },
    {
      id: "pembeli-dampak",
      title: "Lihat dampakmu tumbuh",
      body: "Setiap pesanan yang kamu ambil tercatat: pangan yang diselamatkan, emisi CO₂e yang dicegah, dan uang yang kamu hemat.",
      bullets: [
        { icon: SproutIcon, text: `Naik level dari Pemula ke Penyelamat di ${SAVER_KG} kg, lalu Juara Pangan di ${HERO_KG} kg` },
        { icon: CloudIcon, text: `1 kg pangan yang diselamatkan mencegah ${CO2_PER_KG} kg emisi CO₂e` },
      ],
      tint: "brand",
      mockLabel: "Contoh halaman dampak: level Penyelamat, pangan diselamatkan, emisi dicegah, dan uang yang dihemat.",
    },
  ],
  mitra: [
    {
      id: "mitra-gabung",
      title: "Ubah sisa jadi pemasukan",
      body: "Porsi yang belum laku menjelang tutup tetap bisa terjual ke mahasiswa di sekitarmu. Daftarnya gratis.",
      bullets: [
        { icon: WalletIcon, text: "Biaya layanan dibayar pembeli, hasil penjualan masuk utuh ke warungmu" },
        { icon: FootprintsIcon, text: "Pembeli datang dan mengambil sendiri, tanpa kurir" },
        { icon: LeafIcon, text: "Makin sedikit makanan yang dibuang tiap malam" },
      ],
      tint: "deal",
      mockLabel: "Contoh dasbor mitra: saldo warung dan pesanan surplus yang sudah diambil malam ini.",
    },
    {
      id: "mitra-publikasi",
      title: "Publikasikan surplus dalam 60 detik",
      body: "Pilih menu dan jumlah porsi, lalu aplikasi menyarankan harga pemulihan. Satu ketukan, porsimu tampil ke pembeli terdekat.",
      bullets: [
        { icon: CalculatorIcon, text: `Harga dihitung dari sisa porsi, jam tutup, dan pembeli aktif dalam ${RADIUS_KM} km` },
        { icon: ShieldCheckIcon, text: "Tidak pernah di bawah harga minimum yang kamu tetapkan" },
        { icon: SlidersHorizontalIcon, text: "Mau atur sendiri? Diskon manual tetap bisa" },
      ],
      tint: "brand",
      mockLabel: "Contoh layar publikasi: menu Nasi Timbel, 8 porsi, saran harga Rp 10.000 atau hemat 44%, sama dengan harga minimumnya.",
    },
    {
      id: "mitra-eskalasi",
      title: "Diskon naik otomatis",
      body: `Tiap ${ESCALATION_INTERVAL_MINUTES} menit sistem memeriksa sisa porsi dan waktu tutup. Kalau porsi masih banyak menjelang tutup, diskon naik bertahap sampai harga minimum yang kamu tetapkan.`,
      bullets: [
        { icon: TrendingUpIcon, text: "Diskon hanya naik, tidak pernah turun lagi" },
        { icon: BellRingIcon, text: "Diskon Kilat dikabarkan ke pembeli terdekat" },
        { icon: ShieldCheckIcon, text: "Harga minimum tetap jadi batas bawah" },
      ],
      tint: "deal",
      mockLabel: "Contoh kurva harga menu Rp 25.000: Rp 12.500 pukul 20.00, turun bertahap sampai harga minimum Rp 10.000 pukul 21.30, sebelum warung tutup pukul 22.30.",
    },
    {
      id: "mitra-serahkan",
      title: "Scan & serahkan",
      body: "Pembeli menunjukkan QR atau menyebut kode SJ-. Pindai atau ketik 4 digitnya, lalu serahkan pesanannya.",
      bullets: [
        { icon: ScanLineIcon, text: "Cukup kamera HP atau tablet kasir" },
        { icon: KeyboardIcon, text: "Kamera bermasalah? Ketik 4 digit kodenya" },
      ],
      tint: "brand",
      mockLabel: "Contoh layar pindai: kode SJ-8515 diketik, pesanan cocok, lalu tombol Selesaikan Pesanan.",
    },
    {
      id: "mitra-analitik",
      title: "Pantau pendapatan & dampak",
      body: "Lihat porsi terjual, pendapatan yang dipulihkan, dan jam surplus paling ramai. Perkiraan porsi sisa membantumu menyiapkan masakan esok hari.",
      bullets: [
        { icon: ChartColumnIcon, text: "Grafik harian porsi terjual dan terbuang" },
        { icon: CalendarClockIcon, text: "Prediksi surplus untuk 7 hari ke depan" },
      ],
      tint: "deal",
      mockLabel: "Contoh analitik 7 hari: grafik porsi terjual dan terbuang, serta pendapatan yang dipulihkan.",
    },
  ],
};

function tidy(step: TourStep): TourStep {
  return {
    ...step,
    title: keepTogether(step.title),
    body: keepTogether(step.body),
    bullets: step.bullets.map((b) => ({ ...b, text: keepTogether(b.text) })),
  };
}

export const TOUR_STEPS: Record<TourRole, TourStep[]> = {
  pembeli: STEPS.pembeli.map(tidy),
  mitra: STEPS.mitra.map(tidy),
};
