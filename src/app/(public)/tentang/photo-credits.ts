/**
 * Attribution for the blurred stand-in photos (FoodThumb, public/food-placeholders/).
 * Shown inline on /tentang so the credit is readable in the app; CC BY needs
 * title, author, source and licence, which every entry carries.
 * Keep in sync with public/food-placeholders/CREDITS.md.
 */

export type PhotoLicence = "CC BY 2.0" | "CC BY 4.0" | "CC0";

export const LICENCE_URL: Record<PhotoLicence, string> = {
  "CC BY 2.0": "https://creativecommons.org/licenses/by/2.0/",
  "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
  CC0: "https://creativecommons.org/publicdomain/zero/1.0/",
};

export type PhotoCredit = {
  /** Category the photo stands in for, as the app names it. */
  usedFor: string;
  /** File name of the original on Wikimedia Commons. */
  title: string;
  author: string;
  licence: PhotoLicence;
  sourceUrl: string;
};

export const PHOTO_CREDITS: readonly PhotoCredit[] = [
  {
    usedFor: "Makanan berat",
    title: "Nasi Campur.jpg",
    author: "Fei Tan",
    licence: "CC BY 2.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Nasi_Campur.jpg",
  },
  {
    usedFor: "Makanan ringan",
    title: "Pisang Goreng Hangat.jpg",
    author: "AndriFB",
    licence: "CC0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Pisang_Goreng_Hangat.jpg",
  },
  {
    usedFor: "Makanan vegan",
    title: "Gado-gado - Bali 2025-09-25.jpg",
    author: "Andy Li",
    licence: "CC0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Gado-gado_-_Bali_2025-09-25.jpg",
  },
  {
    usedFor: "Minuman",
    title: "Es teh manis.jpg",
    author: "Cendy00",
    licence: "CC BY 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Es_teh_manis.jpg",
  },
  {
    usedFor: "Roti dan pastry",
    title: "Croissants au beurre (18953292873).jpg",
    author: "Herry Wibisono (herryway)",
    licence: "CC0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Croissants_au_beurre_(18953292873).jpg",
  },
  {
    usedFor: "Bahan makanan",
    title: "Pasar Tanjung Anyar 152626.jpg",
    author: "Abdul Hanif Arromy",
    licence: "CC BY 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Pasar_Tanjung_Anyar_152626.jpg",
  },
  {
    usedFor: "Paket kejutan",
    title: "Nasi Kotak-1.jpg",
    author: "Indonesiagood",
    licence: "CC BY 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Nasi_Kotak-1.jpg",
  },
];
