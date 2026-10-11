import type { Language } from './language.js';

/**
 * A euro amount written out, as invoices print it under the total:
 * "njëzet e nëntë euro e dhjetë cent" / "twenty-nine euros and ten cents".
 * Whole euros up to the billions; cents are rounded to two places.
 */
export function amountInWords(amount: number, language: Language): string {
  const cents = Math.round(Math.abs(amount) * 100);
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return language === 'sq' ? albanian(euros, rest) : english(euros, rest);
}

// ---------- Albanian ----------

const SQ_ONES = ['zero', 'një', 'dy', 'tre', 'katër', 'pesë', 'gjashtë', 'shtatë', 'tetë', 'nëntë'];
const SQ_TEENS = [
  'dhjetë', 'njëmbëdhjetë', 'dymbëdhjetë', 'trembëdhjetë', 'katërmbëdhjetë',
  'pesëmbëdhjetë', 'gjashtëmbëdhjetë', 'shtatëmbëdhjetë', 'tetëmbëdhjetë', 'nëntëmbëdhjetë',
];
const SQ_TENS = ['', '', 'njëzet', 'tridhjetë', 'dyzet', 'pesëdhjetë', 'gjashtëdhjetë', 'shtatëdhjetë', 'tetëdhjetë', 'nëntëdhjetë'];

/** 1–999; parts are joined with "e", as in "njëqind e njëzet e pesë". */
function sqBelowThousand(n: number): string[] {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const below = n % 100;
  if (hundreds) parts.push(`${SQ_ONES[hundreds]}qind`);
  if (below >= 20) {
    parts.push(SQ_TENS[Math.floor(below / 10)]!);
    if (below % 10) parts.push(SQ_ONES[below % 10]!);
  } else if (below >= 10) parts.push(SQ_TEENS[below - 10]!);
  else if (below) parts.push(SQ_ONES[below]!);
  return parts;
}

function sqNumber(n: number): string {
  if (n === 0) return SQ_ONES[0]!;
  const groups: Array<[number, string, string]> = [
    [1_000_000_000, 'miliard', 'miliardë'],
    [1_000_000, 'milion', 'milionë'],
    [1_000, 'mijë', 'mijë'],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [size, one, many] of groups) {
    const count = Math.floor(rest / size);
    if (count) parts.push(`${sqBelowThousand(count).join(' e ')} ${count === 1 ? one : many}`);
    rest %= size;
  }
  if (rest) parts.push(...sqBelowThousand(rest));
  return parts.join(' e ');
}

function albanian(euros: number, cents: number): string {
  const euroPart = `${sqNumber(euros)} euro`;
  return cents ? `${euroPart} e ${sqNumber(cents)} cent` : euroPart;
}

// ---------- English ----------

const EN_ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function enBelowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const below = n % 100;
  const tens = below < 20 ? EN_ONES[below]! : `${EN_TENS[Math.floor(below / 10)]}${below % 10 ? `-${EN_ONES[below % 10]}` : ''}`;
  if (!hundreds) return tens;
  return below ? `${EN_ONES[hundreds]} hundred and ${tens}` : `${EN_ONES[hundreds]} hundred`;
}

function enNumber(n: number): string {
  if (n === 0) return EN_ONES[0]!;
  const groups: Array<[number, string]> = [
    [1_000_000_000, 'billion'],
    [1_000_000, 'million'],
    [1_000, 'thousand'],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [size, name] of groups) {
    const count = Math.floor(rest / size);
    if (count) parts.push(`${enBelowThousand(count)} ${name}`);
    rest %= size;
  }
  if (rest) parts.push(rest < 100 && parts.length ? `and ${enBelowThousand(rest)}` : enBelowThousand(rest));
  return parts.join(' ');
}

function english(euros: number, cents: number): string {
  const euroPart = `${enNumber(euros)} ${euros === 1 ? 'euro' : 'euros'}`;
  return cents ? `${euroPart} and ${enNumber(cents)} ${cents === 1 ? 'cent' : 'cents'}` : euroPart;
}
