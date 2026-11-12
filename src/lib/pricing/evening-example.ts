/**
 * One example menu priced by the real optimizer at three points of the evening. Shown on
 * /welcome and the login screen to explain how the price falls toward closing time. It is
 * an illustration, labelled "Contoh" wherever it appears, never live data.
 */
import { SURPLUS_WINDOW_START } from "@/lib/constants";
import { calculateOptimalRecoveryPrice } from "./dynamic-discount";

export const EVENING_EXAMPLE = { name: "Nasi Timbel Ayam Goreng", priceIdr: 18000, floorIdr: 5000 } as const;

function examplePrice(minutesToClose: number, availableStock: number) {
  return calculateOptimalRecoveryPrice({
    originalPriceIdr: EVENING_EXAMPLE.priceIdr,
    minRecoveryPriceIdr: EVENING_EXAMPLE.floorIdr,
    availableStock,
    minutesToClose,
    activeUsersIn2km: 20,
  });
}

export const EVENING_TIMELINE = [
  {
    when: SURPLUS_WINDOW_START.replace(":", "."),
    text: "Warung memasang porsi sisa. Harga mulai dari diskon dasar.",
    quote: examplePrice(150, 10),
    flash: false,
  },
  { when: "1 jam lagi tutup", text: "Masih banyak yang belum laku? Diskon naik sendiri.", quote: examplePrice(60, 6), flash: false },
  {
    when: "30 menit lagi",
    text: "Diskon Kilat: potongan terbesar, dan pembeli di sekitar warung dapat notifikasi.",
    quote: examplePrice(30, 5),
    flash: true,
  },
] as const;
