/**
 * Seed fixtures: 15 fictional warung around UGM / UNY, Yogyakarta.
 *
 * Warung and owner names are invented. Coordinates are approximate points in
 * real neighbourhoods (Pogung, Sendowo, Jl. Kaliurang, Gejayan, Karangmalang,
 * Terban, Sagan, …) so radius queries behave realistically. Two warung
 * (Seturan, Condongcatur) are deliberately ~3–4 km from UGM to exercise the
 * 2 km radius filter and the "expand radius" flow.
 */
import type { menuCategory } from "../schema";

type Category = (typeof menuCategory.enumValues)[number];

export interface SeedMenu {
  name: string;
  category: Category;
  priceIdr: number;
  portionWeightGrams?: number;
  description: string;
  isMysteryBag?: boolean;
  /** Typical evening surplus portions on an ordinary weekday. */
  baseSurplus: number;
}

export interface SeedMerchant {
  slug: string;
  name: string;
  owner: string;
  category: Category;
  address: string;
  lat: number;
  lng: number;
  open: string;
  close: string;
  premium: boolean;
  /** Share of surplus portions that typically sells (drives history). */
  sellRate: number;
  description: string;
  menus: SeedMenu[];
}

export const SEED_MERCHANTS: SeedMerchant[] = [
  {
    slug: "warung-bu-sri-pogung",
    name: "Warung Makan Bu Sri",
    owner: "Sri Wahyuni",
    category: "MAKANAN_BERAT",
    address: "Pogung Kidul, Sinduadi, Mlati, Sleman",
    lat: -7.7628,
    lng: 110.3741,
    open: "07:00",
    close: "22:00",
    premium: true,
    sellRate: 0.82,
    description: "Masakan rumahan prasmanan langganan mahasiswa Pogung.",
    menus: [
      { name: "Nasi Sayur Lodeh + Telur Balado", category: "MAKANAN_BERAT", priceIdr: 14000, description: "Nasi, sayur lodeh, telur balado, kerupuk.", baseSurplus: 6 },
      { name: "Nasi Ayam Goreng Lengkuas", category: "MAKANAN_BERAT", priceIdr: 18000, portionWeightGrams: 250, description: "Ayam goreng lengkuas, sambal, lalapan.", baseSurplus: 5 },
      { name: "Paket Kejutan Bu Sri", category: "MYSTERY_BAG", priceIdr: 20000, portionWeightGrams: 350, description: "Isi acak lauk & sayur sisa hari ini.", isMysteryBag: true, baseSurplus: 3 },
    ],
  },
  {
    slug: "penyetan-cak-darmo",
    name: "Penyetan Cak Darmo",
    owner: "Darmo Santoso",
    category: "MAKANAN_BERAT",
    address: "Jl. Pogung Raya, Sinduadi, Mlati, Sleman",
    lat: -7.7598,
    lng: 110.3768,
    open: "10:00",
    close: "22:30",
    premium: false,
    sellRate: 0.74,
    description: "Ayam & lele penyet sambal bawang level 1–5.",
    menus: [
      { name: "Ayam Penyet Sambal Bawang", category: "MAKANAN_BERAT", priceIdr: 17000, portionWeightGrams: 250, description: "Nasi, ayam penyet, tahu, tempe, sambal bawang.", baseSurplus: 6 },
      { name: "Lele Penyet", category: "MAKANAN_BERAT", priceIdr: 15000, description: "Nasi, lele goreng, lalapan, sambal.", baseSurplus: 5 },
    ],
  },
  {
    slug: "padang-uni-rina-gejayan",
    name: "RM Padang Uni Rina",
    owner: "Rina Marlina",
    category: "MAKANAN_BERAT",
    address: "Jl. Affandi (Gejayan), Caturtunggal, Depok, Sleman",
    lat: -7.7712,
    lng: 110.3893,
    open: "09:00",
    close: "22:00",
    premium: true,
    sellRate: 0.86,
    description: "Masakan Padang porsi kenyang, rendang dimasak 6 jam.",
    menus: [
      { name: "Nasi Rendang", category: "MAKANAN_BERAT", priceIdr: 22000, portionWeightGrams: 250, description: "Nasi, rendang sapi, daun singkong, sambal hijau.", baseSurplus: 7 },
      { name: "Nasi Ayam Pop", category: "MAKANAN_BERAT", priceIdr: 20000, portionWeightGrams: 250, description: "Nasi, ayam pop, sayur nangka, sambal merah.", baseSurplus: 5 },
      { name: "Nasi Telur Dadar Padang", category: "MAKANAN_BERAT", priceIdr: 14000, description: "Telur dadar tebal khas Padang + gulai.", baseSurplus: 4 },
    ],
  },
  {
    slug: "bakmi-jawa-pak-harjo",
    name: "Bakmi Jawa Pak Harjo",
    owner: "Harjo Suwito",
    category: "MAKANAN_BERAT",
    address: "Sendowo, Sinduadi, Mlati, Sleman",
    lat: -7.7665,
    lng: 110.3752,
    open: "16:00",
    close: "23:00",
    premium: false,
    sellRate: 0.7,
    description: "Bakmi godhog & goreng masak arang.",
    menus: [
      { name: "Bakmi Godhog", category: "MAKANAN_BERAT", priceIdr: 18000, portionWeightGrams: 300, description: "Bakmi kuah kaldu ayam kampung.", baseSurplus: 4 },
      { name: "Nasi Goreng Magelangan", category: "MAKANAN_BERAT", priceIdr: 18000, portionWeightGrams: 300, description: "Nasi goreng campur mi, telur, suwiran ayam.", baseSurplus: 4 },
    ],
  },
  {
    slug: "angkringan-lik-jarwo",
    name: "Angkringan Lik Jarwo",
    owner: "Sujarwo",
    category: "MAKANAN_RINGAN",
    address: "Karangmalang, Caturtunggal, Depok, Sleman (dekat UNY)",
    lat: -7.7748,
    lng: 110.3858,
    open: "17:00",
    close: "23:00",
    premium: false,
    sellRate: 0.66,
    description: "Nasi kucing, sate-satean, wedang jahe.",
    menus: [
      { name: "Paket 3 Nasi Kucing + 2 Sate", category: "MAKANAN_RINGAN", priceIdr: 12000, portionWeightGrams: 250, description: "3 bungkus nasi kucing + 2 tusuk sate usus/telur puyuh.", baseSurplus: 8 },
      { name: "Paket Gorengan Isi 6", category: "MAKANAN_RINGAN", priceIdr: 12000, portionWeightGrams: 180, description: "Tempe, tahu isi, bakwan — 6 potong.", baseSurplus: 6 },
    ],
  },
  {
    slug: "gudeg-bu-tini-sagan",
    name: "Gudeg Bu Tini",
    owner: "Sutini",
    category: "MAKANAN_BERAT",
    address: "Sagan, Terban, Gondokusuman, Yogyakarta",
    lat: -7.779,
    lng: 110.3815,
    open: "06:00",
    close: "21:30",
    premium: true,
    sellRate: 0.8,
    description: "Gudeg kering khas Jogja, krecek pedas.",
    menus: [
      { name: "Nasi Gudeg Telur", category: "MAKANAN_BERAT", priceIdr: 16000, description: "Gudeg, krecek, telur pindang, areh.", baseSurplus: 6 },
      { name: "Nasi Gudeg Ayam Suwir", category: "MAKANAN_BERAT", priceIdr: 21000, portionWeightGrams: 250, description: "Gudeg, krecek, ayam suwir opor.", baseSurplus: 4 },
    ],
  },
  {
    slug: "lumbung-gandum-bakery",
    name: "Roti & Pastry Lumbung Gandum",
    owner: "Dewi Anggraini",
    category: "ROTI_PASTRY",
    address: "Jl. Kaliurang Km 5, Caturtunggal, Depok, Sleman",
    lat: -7.7565,
    lng: 110.3818,
    open: "08:00",
    close: "21:00",
    premium: true,
    sellRate: 0.88,
    description: "Roti sobek & pastry dipanggang tiap pagi.",
    menus: [
      { name: "Roti Sobek Cokelat Keju", category: "ROTI_PASTRY", priceIdr: 15000, portionWeightGrams: 220, description: "Roti sobek isi cokelat & keju.", baseSurplus: 6 },
      { name: "Croissant Butter (2 pcs)", category: "ROTI_PASTRY", priceIdr: 18000, portionWeightGrams: 140, description: "Dua croissant butter.", baseSurplus: 5 },
      { name: "Bakery Surprise Box", category: "MYSTERY_BAG", priceIdr: 25000, portionWeightGrams: 400, description: "Campuran roti & pastry yang tidak terjual hari ini.", isMysteryBag: true, baseSurplus: 3 },
    ],
  },
  {
    slug: "warung-vegan-hijau-daun",
    name: "Warung Vegan Hijau Daun",
    owner: "Laras Pratiwi",
    category: "MAKANAN_VEGAN",
    address: "Jl. Kaliurang Km 4,5, Sinduadi, Mlati, Sleman",
    lat: -7.759,
    lng: 110.3807,
    open: "10:00",
    close: "21:30",
    premium: false,
    sellRate: 0.62,
    description: "Menu nabati, tanpa MSG, porsi mahasiswa.",
    menus: [
      { name: "Nasi Tempe Bacem + Urap", category: "MAKANAN_VEGAN", priceIdr: 15000, description: "Tempe bacem, urap sayur, sambal tomat.", baseSurplus: 5 },
      { name: "Gado-gado Lontong", category: "MAKANAN_VEGAN", priceIdr: 16000, portionWeightGrams: 300, description: "Sayur rebus, lontong, saus kacang.", baseSurplus: 4 },
    ],
  },
  {
    slug: "geprek-mbak-lilis",
    name: "Ayam Geprek Mbak Lilis",
    owner: "Lilis Suryani",
    category: "MAKANAN_BERAT",
    address: "Jl. Kaliurang Km 4, Sinduadi, Mlati, Sleman",
    lat: -7.7615,
    lng: 110.3799,
    open: "10:00",
    close: "22:00",
    premium: false,
    sellRate: 0.78,
    description: "Geprek sambal korek, nasi bisa nambah.",
    menus: [
      { name: "Ayam Geprek Sambal Korek", category: "MAKANAN_BERAT", priceIdr: 15000, portionWeightGrams: 250, description: "Nasi, ayam geprek, sambal korek.", baseSurplus: 7 },
      { name: "Ayam Geprek Keju", category: "MAKANAN_BERAT", priceIdr: 19000, portionWeightGrams: 260, description: "Geprek dengan lelehan keju mozarella.", baseSurplus: 4 },
    ],
  },
  {
    slug: "soto-lamongan-cak-har",
    name: "Soto Lamongan Cak Har",
    owner: "Hariyanto",
    category: "MAKANAN_BERAT",
    address: "Samirono, Caturtunggal, Depok, Sleman",
    lat: -7.7765,
    lng: 110.3875,
    open: "06:00",
    close: "21:00",
    premium: false,
    sellRate: 0.72,
    description: "Soto ayam koya gurih.",
    menus: [
      { name: "Soto Ayam Lamongan + Nasi", category: "MAKANAN_BERAT", priceIdr: 15000, portionWeightGrams: 350, description: "Soto ayam koya, nasi, kerupuk.", baseSurplus: 6 },
    ],
  },
  {
    slug: "wedangan-mbah-wiryo",
    name: "Wedangan Mbah Wiryo",
    owner: "Wiryo Atmojo",
    category: "MAKANAN_RINGAN",
    address: "Terban, Gondokusuman, Yogyakarta",
    lat: -7.7808,
    lng: 110.3779,
    open: "18:00",
    close: "23:30",
    premium: false,
    sellRate: 0.6,
    description: "Wedangan klasik, nasi bakar & jadah bakar.",
    menus: [
      { name: "Nasi Bakar Teri (2 pcs)", category: "MAKANAN_RINGAN", priceIdr: 12000, portionWeightGrams: 220, description: "Dua nasi bakar isi teri pedas.", baseSurplus: 6 },
      { name: "Jadah Tempe Bakar (4 pcs)", category: "MAKANAN_RINGAN", priceIdr: 12000, portionWeightGrams: 200, description: "Jadah ketan + tempe bacem dibakar.", baseSurplus: 5 },
    ],
  },
  {
    slug: "sayur-segar-bu-darmi",
    name: "Kedai Sayur Segar Bu Darmi",
    owner: "Sudarmi",
    category: "BAHAN_MAKANAN",
    address: "Blimbingsari, Caturtunggal, Depok, Sleman",
    lat: -7.7762,
    lng: 110.3812,
    open: "05:00",
    close: "20:30",
    premium: false,
    sellRate: 0.58,
    description: "Sayur & buah segar sisa hari ini, cocok untuk anak kos yang masak.",
    menus: [
      { name: "Paket Sayur Sop (1 kg)", category: "BAHAN_MAKANAN", priceIdr: 15000, portionWeightGrams: 1000, description: "Wortel, kentang, kol, buncis, daun bawang.", baseSurplus: 4 },
      { name: "Kantong Buah Campur", category: "MYSTERY_BAG", priceIdr: 18000, portionWeightGrams: 1200, description: "Buah matang yang harus segera dimakan.", isMysteryBag: true, baseSurplus: 3 },
    ],
  },
  {
    slug: "warmindo-barokah-klebengan",
    name: "Warmindo Barokah",
    owner: "Asep Saepudin",
    category: "MAKANAN_BERAT",
    address: "Klebengan, Caturtunggal, Depok, Sleman",
    lat: -7.766,
    lng: 110.388,
    open: "00:00",
    close: "23:59",
    premium: false,
    sellRate: 0.75,
    description: "Warmindo 24 jam: magelangan, nasi telur, es teh.",
    menus: [
      { name: "Nasi Telur Orak-Arik + Sayur", category: "MAKANAN_BERAT", priceIdr: 12000, description: "Telur orak-arik, oseng sayur, sambal.", baseSurplus: 4 },
      { name: "Nasi Sarden Pedas", category: "MAKANAN_BERAT", priceIdr: 13000, description: "Sarden saus pedas, nasi, kerupuk.", baseSurplus: 3 },
    ],
  },
  {
    slug: "pecel-lele-mas-bejo-seturan",
    name: "Pecel Lele Mas Bejo",
    owner: "Bejo Riyanto",
    category: "MAKANAN_BERAT",
    address: "Seturan, Caturtunggal, Depok, Sleman",
    lat: -7.7663,
    lng: 110.4098,
    open: "16:00",
    close: "23:00",
    premium: false,
    sellRate: 0.7,
    description: "Pecel lele & ayam goreng tenda.",
    menus: [
      { name: "Pecel Lele + Nasi", category: "MAKANAN_BERAT", priceIdr: 15000, description: "Lele goreng, lalapan, sambal terasi.", baseSurplus: 5 },
      { name: "Ayam Goreng Kremes + Nasi", category: "MAKANAN_BERAT", priceIdr: 18000, portionWeightGrams: 250, description: "Ayam goreng kremes renyah.", baseSurplus: 4 },
    ],
  },
  {
    slug: "dapur-mama-kost-condongcatur",
    name: "Dapur Mama Kost",
    owner: "Yuliana Kusuma",
    category: "MAKANAN_BERAT",
    address: "Condongcatur, Depok, Sleman",
    lat: -7.753,
    lng: 110.395,
    open: "10:00",
    close: "21:30",
    premium: true,
    sellRate: 0.84,
    description: "Masakan rumahan katering kos, menu ganti tiap hari.",
    menus: [
      { name: "Nasi Box Ayam Bakar", category: "MAKANAN_BERAT", priceIdr: 20000, portionWeightGrams: 300, description: "Ayam bakar kecap, tumis buncis, sambal.", baseSurplus: 6 },
      { name: "Nasi Box Ikan Nila Asam Manis", category: "MAKANAN_BERAT", priceIdr: 20000, portionWeightGrams: 300, description: "Nila goreng saus asam manis, capcay.", baseSurplus: 4 },
    ],
  },
];

export const FIRST_NAMES = [
  "Raka", "Nadia", "Bima", "Salsa", "Fajar", "Ayu", "Dimas", "Putri", "Gilang", "Intan",
  "Rizky", "Anisa", "Yoga", "Citra", "Hafiz", "Nabila", "Arif", "Dinda", "Bayu", "Kirana",
  "Fikri", "Laila", "Galih", "Tasya", "Reza", "Wulan", "Ilham", "Zahra", "Aldi", "Rani",
];

export const LAST_NAMES = [
  "Pratama", "Saputra", "Lestari", "Nugroho", "Wibowo", "Rahmawati", "Hidayat", "Kurniawan",
  "Permata", "Setiawan", "Maharani", "Siregar", "Putra", "Utami", "Hakim", "Ramadhan",
];

export const REVIEW_TAGS = [
  "Porsi Banyak",
  "Masih Hangat",
  "Pelayanan Ramah",
  "Rasa Enak",
  "Hemat Banget",
  "Pengambilan Cepat",
];

export const REVIEW_COMMENTS = [
  "Masih enak banget padahal udah malam, makasih!",
  "Lumayan buat makan malam akhir bulan.",
  "Porsinya pas, ambilnya cepat.",
  "Harga turun pas mau tutup, mantap.",
  "Bapaknya ramah, makanannya masih hangat.",
  null,
  null,
];
