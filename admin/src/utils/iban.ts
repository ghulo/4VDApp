/** An IBAN the way the server keeps it: no spaces, capitals. */
export const cleanIban = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/** Empty, or an IBAN whose check digits match (ISO 13616 mod 97), the same check the server makes. */
export function isIbanOrEmpty(value: string): boolean {
  const iban = cleanIban(value);
  if (!iban) return true;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}
