/**
 * A number typed in a text field the phone's way: "7,5" (an Albanian keyboard
 * has a comma) or "7.5", spaces ignored. NaN for anything else, so a typo is
 * caught instead of read as something else. Fields use type="text" with
 * inputMode="decimal": type="number" refuses the comma on many phones.
 */
export function decimalFromText(text: string): number {
  const typed = text.replace(/\s/g, '').replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(typed)) return Number.NaN;
  return Number(typed);
}
