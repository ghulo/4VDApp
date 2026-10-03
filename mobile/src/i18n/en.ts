/**
 * Every word the team app shows, in English. Albanian (sq.ts) is typed
 * against this, so a text missing there is a compile error. Texts with
 * numbers or names are functions.
 */
export const en = {
  language: { label: 'Language', english: 'English', albanian: 'Shqip' },
  common: {
    somethingWrong: 'Something went wrong',
    until: (day: string) => `until ${day}`,
  },
};

export type Catalogue = typeof en;
