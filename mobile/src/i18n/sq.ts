import type { Catalogue } from './en';

/** Every word the team app shows, in Albanian. Terms follow the glossary in the Albanian plan. */
export const sq: Catalogue = {
  language: { label: 'Gjuha', english: 'English', albanian: 'Shqip' },
  common: {
    somethingWrong: 'Diçka shkoi keq',
    until: (day) => `deri më ${day}`,
  },
};
