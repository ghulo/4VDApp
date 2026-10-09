import type { InputHTMLAttributes } from 'react';

/** Kosovo's NUI is 9 digits; spaces people type are dropped before saving. */
export const isNui = (value: string) => /^\d{9}$/.test(value.replace(/\s+/g, ''));
export const cleanNui = (value: string) => value.replace(/\s+/g, '');

/** A text box for an NUI: number keyboard on phones, checked as 9 digits by the browser. */
export function NuiInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'pattern'>) {
  return <input {...props} type="text" inputMode="numeric" autoComplete="off" pattern="\s*(\d\s*){9}" maxLength={13} />;
}
