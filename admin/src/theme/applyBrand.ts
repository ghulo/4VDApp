import type { Brand, BrandGreys } from '../services/types';
import { brandTheme, HOUSE_COLOUR, isBrandHex } from './brandTheme';

/*
 * Puts a business's colours on the page: one <style id="brand-theme"> after
 * tokens.css. 4VD's own business with nothing changed has none, so tokens.css's
 * amber shows as it always has. The sheet is also kept in localStorage, so
 * index.html can put it back before the first paint and a branded business
 * never flashes amber on reload.
 */

export const BRAND_STORAGE_KEY = '4vd.brand';
const STYLE_ID = 'brand-theme';
/** Only colours, names and punctuation: anything else in storage is not ours. */
export const SAFE_SHEET = /^[\w\s:;#\-[\]'=(),.{}]+$/;

/** What the sheet is worked out from: a saved brand, or the colours being tried in Settings. */
export type BrandLook = Pick<Brand, 'house' | 'colour' | 'greys' | 'accent' | 'gradient'>;

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

/** The theme for a look: 4VD's own business keeps tokens.css's amber scale while its main colour is amber. */
export function themeOf(look: BrandLook) {
  return brandTheme(look.colour, look.greys, { accent: look.accent, gradient: look.gradient, keepMain: look.house && look.colour.toLowerCase() === HOUSE_COLOUR });
}

/** The sheet for a look, or null for 4VD's own look. */
export function brandSheet(look: BrandLook | null | undefined): string | null {
  if (!look || !isBrandHex(look.colour)) return null;
  return themeOf(look).css || null;
}

/** The business the person works in now: its colours on every page, remembered for the next load. */
export function applyBrand(look: BrandLook | null | undefined): void {
  const css = brandSheet(look);
  setSheet(css);
  remember(css);
}

/** A brand seen only for a moment (a sign-in page from a link): shown, not remembered. */
export function showBrand(look: BrandLook | null | undefined): void {
  setSheet(brandSheet(look));
}

/** Settings' live preview: the page in colours before they're saved, for the person editing only. */
export function previewBrand(look: BrandLook): void {
  if (isBrandHex(look.colour)) setSheet(brandSheet(look));
}

/** Signed out, or on a page that is always 4VD's (All logs): back to amber. */
export function clearBrand(remembered = true): void {
  setSheet(null);
  if (remembered) remember(null);
}

export type { BrandGreys };
