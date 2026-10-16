/**
 * The country a barcode was registered in, from its GS1 prefix. That is where
 * the brand signed up for its numbers, which is often (not always) where the
 * product is made, so the product's Country field starts from it and can be
 * corrected by hand.
 */

/** [first prefix, last prefix, ISO 3166 alpha-2], three-digit prefixes of an EAN-13. */
const RANGES: Array<[number, number, string]> = [
  [0, 19, 'US'], [30, 39, 'US'], [60, 139, 'US'],
  [300, 379, 'FR'], [380, 380, 'BG'], [383, 383, 'SI'], [385, 385, 'HR'], [387, 387, 'BA'], [389, 389, 'ME'], [390, 390, 'XK'],
  [400, 440, 'DE'], [450, 459, 'JP'], [460, 469, 'RU'], [470, 470, 'KG'], [471, 471, 'TW'], [474, 474, 'EE'],
  [475, 475, 'LV'], [476, 476, 'AZ'], [477, 477, 'LT'], [478, 478, 'UZ'], [479, 479, 'LK'], [480, 480, 'PH'],
  [481, 481, 'BY'], [482, 482, 'UA'], [483, 483, 'TM'], [484, 484, 'MD'], [485, 485, 'AM'], [486, 486, 'GE'],
  [487, 487, 'KZ'], [488, 488, 'TJ'], [489, 489, 'HK'], [490, 499, 'JP'], [500, 509, 'GB'], [520, 521, 'GR'],
  [528, 528, 'LB'], [529, 529, 'CY'], [530, 530, 'AL'], [531, 531, 'MK'], [535, 535, 'MT'], [539, 539, 'IE'],
  [540, 549, 'BE'], [560, 560, 'PT'], [569, 569, 'IS'], [570, 579, 'DK'], [590, 590, 'PL'], [594, 594, 'RO'],
  [599, 599, 'HU'], [600, 601, 'ZA'], [603, 603, 'GH'], [604, 604, 'SN'], [608, 608, 'BH'], [609, 609, 'MU'],
  [611, 611, 'MA'], [613, 613, 'DZ'], [615, 615, 'NG'], [616, 616, 'KE'], [618, 618, 'CI'], [619, 619, 'TN'],
  [620, 620, 'TZ'], [621, 621, 'SY'], [622, 622, 'EG'], [623, 623, 'BN'], [624, 624, 'LY'], [625, 625, 'JO'],
  [626, 626, 'IR'], [627, 627, 'KW'], [628, 628, 'SA'], [629, 629, 'AE'], [630, 630, 'QA'], [640, 649, 'FI'],
  [690, 699, 'CN'], [700, 709, 'NO'], [729, 729, 'IL'], [730, 739, 'SE'], [740, 740, 'GT'], [741, 741, 'SV'],
  [742, 742, 'HN'], [743, 743, 'NI'], [744, 744, 'CR'], [745, 745, 'PA'], [746, 746, 'DO'], [750, 750, 'MX'],
  [754, 755, 'CA'], [759, 759, 'VE'], [760, 769, 'CH'], [770, 771, 'CO'], [773, 773, 'UY'], [775, 775, 'PE'],
  [777, 777, 'BO'], [778, 779, 'AR'], [780, 780, 'CL'], [784, 784, 'PY'], [786, 786, 'EC'], [789, 790, 'BR'],
  [800, 839, 'IT'], [840, 849, 'ES'], [850, 850, 'CU'], [858, 858, 'SK'], [859, 859, 'CZ'], [860, 860, 'RS'],
  [865, 865, 'MN'], [867, 867, 'KP'], [868, 869, 'TR'], [870, 879, 'NL'], [880, 881, 'KR'], [883, 883, 'MM'],
  [884, 884, 'KH'], [885, 885, 'TH'], [888, 888, 'SG'], [890, 890, 'IN'], [893, 893, 'VN'], [896, 896, 'PK'],
  [899, 899, 'ID'], [900, 919, 'AT'], [930, 939, 'AU'], [940, 949, 'NZ'], [955, 955, 'MY'], [958, 958, 'MO'],
];

/**
 * The ISO country code a barcode's prefix belongs to, or null when it has none:
 * shop-made codes (prefix 2), coupons, books and magazines, and codes that
 * aren't EAN/UPC numbers.
 */
export function countryFromBarcode(code: string | null | undefined): string | null {
  if (!code || !/^\d+$/.test(code)) return null;
  // A 12-digit UPC-A is an EAN-13 with a leading 0; an EAN-8 has its own (unused here) prefixes.
  const ean = code.length === 12 ? `0${code}` : code.length === 13 ? code : null;
  if (!ean) return null;
  const prefix = Number(ean.slice(0, 3));
  return RANGES.find(([first, last]) => prefix >= first && prefix <= last)?.[2] ?? null;
}
