import type { Brand, BrandGreys } from '../services/types';
import { brandTheme, isBrandHex } from './brandTheme';

/*
 * Puts a business's colours on the page: one <style id="brand-theme"> after
 * tokens.css. 4VD's own business (house) has none, so tokens.css's amber
 * shows as it always has. The sheet is also kept in localStorage, so
 * index.html can put it back before the first paint and a branded business
 * never flashes amber on reload.
 */

export const BRAND_STORAGE_KEY = '4vd.brand';
const STYLE_ID = 'brand-theme';
/** Only colours, names and punctuation: anything else in storage is not ours. */
export const SAFE_SHEET = /^[\w\s:;#\-[\]'=(),.{}]+$/;

function setSheet(css: string | null): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (css === null) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.append(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

function remember(css: string | null): void {
  try {
    if (css === null) localStorage.removeItem(BRAND_STORAGE_KEY);
    else localStorage.setItem(BRAND_STORAGE_KEY, css);
  } catch {
    // A private window: the colours still show, they just load a moment later.
  }
}

/** The sheet for a brand, or null for 4VD's own look. */
export function brandSheet(brand: Pick<Brand, 'house' | 'colour' | 'greys'> | null | undefined): string | null {
  if (!brand || brand.house || !isBrandHex(brand.colour)) return null;
  return brandTheme(brand.colour, brand.greys).css;
}

/** The business the person works in now: its colours on every page, remembered for the next load. */
export function applyBrand(brand: Pick<Brand, 'house' | 'colour' | 'greys'> | null | undefined): void {
  const css = brandSheet(brand);
  setSheet(css);
  remember(css);
}

/** A brand seen only for a moment (a sign-in page from a link): shown, not remembered. */
export function showBrand(brand: Pick<Brand, 'house' | 'colour' | 'greys'> | null | undefined): void {
  setSheet(brandSheet(brand));
}

/** Settings' live preview: the page in a colour before it's saved. */
export function previewBrand(colour: string, greys: BrandGreys): void {
  if (isBrandHex(colour)) setSheet(brandTheme(colour, greys).css);
}

/** Signed out, or on a page that is always 4VD's (All logs): back to amber. */
export function clearBrand(remembered = true): void {
  setSheet(null);
  if (remembered) remember(null);
}
