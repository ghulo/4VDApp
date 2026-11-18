/** The part after the + in a business's bill address; the same rule as the server's utils/shortName.ts. */
export const SHORT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

/** A short name made from a business name: "Market Dacaj Ç" → "market-dacaj-c". */
export function toShortName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
}

/** bills+<short>@4vd.app; the first business ('4vd') keeps the plain address. */
export const billAddressFor = (shortName: string) => (shortName && shortName !== '4vd' ? `bills+${shortName}@4vd.app` : 'bills@4vd.app');
