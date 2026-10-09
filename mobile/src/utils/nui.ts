/** Kosovo's NUI is 9 digits; spaces people type are dropped before saving. */
export const cleanNui = (value: string) => value.replace(/\s+/g, '');
export const isNui = (value: string) => /^\d{9}$/.test(cleanNui(value));
