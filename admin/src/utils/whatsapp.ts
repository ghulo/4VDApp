/**
 * A WhatsApp chat with the message already written, or null when the number
 * can't be read. Local Kosovo numbers ("044 123 456") get the +383 prefix.
 */
export function whatsappLink(phone: string, text: string): string | null {
  let digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `383${digits.slice(1)}`;
  if (!/^\d{8,15}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** A phone number as a link the phone dials. */
export const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Directions to an address in the phone's maps app. */
export const mapsLink = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
