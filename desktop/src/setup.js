// What this computer is for, chosen once on the welcome screen and changed in
// Settings → This computer: the counter (opens the Counter full screen) or the
// back office (opens the dashboard). Kept in the app's settings folder.
const fs = require('node:fs');

const ROLES = ['counter', 'office'];
const LANGUAGES = ['en', 'sq'];
const DEFAULTS = { done: false, role: 'office', language: null };

function read(file) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      done: saved.done === true,
      role: ROLES.includes(saved.role) ? saved.role : DEFAULTS.role,
      language: LANGUAGES.includes(saved.language) ? saved.language : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Keeps only the fields the welcome screen and Settings may change. */
function merge(current, change) {
  const next = { ...current };
  if (typeof change?.done === 'boolean') next.done = change.done;
  if (ROLES.includes(change?.role)) next.role = change.role;
  if (LANGUAGES.includes(change?.language)) next.language = change.language;
  return next;
}

function write(file, setup) {
  try {
    fs.writeFileSync(file, JSON.stringify(setup));
    return true;
  } catch {
    return false;
  }
}

/** Where the app opens: the welcome screen until it is done, then the counter or the dashboard. */
function startPath(setup) {
  if (!setup.done) return 'welcome';
  return setup.role === 'counter' ? 'counter' : '';
}

module.exports = { read, merge, write, startPath };
