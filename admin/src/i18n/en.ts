/**
 * Every word the dashboard shows, in English. Albanian (sq.ts) is typed
 * against this, so a text missing there is a compile error. Texts with
 * numbers or names are functions.
 */
export const en = {
  language: {
    label: 'Language',
    english: 'English',
    albanian: 'Shqip',
    description: 'The dashboard, the team app, alerts and emails all use it.',
  },
  common: {
    save: 'Save',
    cancel: 'Cancel',
    roles: { developer: 'Developer', admin: 'Admin', owner: 'Owner', employee: 'Employee', family: 'Family' },
  },
};

export type Catalogue = typeof en;
