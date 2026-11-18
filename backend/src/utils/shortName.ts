/**
 * A business's short name: what follows the + in its bill address
 * (bills+<short>@4vd.app). Lowercase letters, digits and dashes, 3 to 30
 * long, starting and ending with a letter or digit.
 */
export const SHORT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

/** A short name made from a business name: "Market Dacaj Ç" → "market-dacaj-c". */
export function toShortName(name: string): string {
  const plain = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return plain.length >= 3 ? plain : `${plain || 'shop'}-biz`.replace(/^-/, '');
}
