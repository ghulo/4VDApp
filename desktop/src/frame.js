// The app's own title strip and its ☰ menu: the pieces that need no Electron, so they can be tested.
// main.js draws the strip (strip.html) in the window itself and puts the dashboard in a view below it.

/** The strip's height in pixels; Windows draws its minimise, maximise and close buttons the same height. */
const STRIP_HEIGHT = 36;

/** Where the dashboard sits in the window: under the strip, or the whole window in full screen (the strip hides). */
function pageBounds({ width, height }, fullScreen) {
  const top = fullScreen ? 0 : STRIP_HEIGHT;
  return { x: 0, y: top, width, height: Math.max(0, height - top) };
}

/**
 * The history entry a step back (-1) or forward (+1) lands on, or null when there is none or it isn't the dashboard
 * (the app's own loading and offline pages stay in the history, and going back onto them would strand the user there).
 * @param {{ index: number, urls: string[] }} history
 */
function stepTarget(history, offset, isDashboard) {
  const target = history.index + offset;
  if (target < 0 || target >= history.urls.length) return null;
  return isDashboard(history.urls[target]) ? target : null;
}

const WORDS = {
  en: {
    menu: 'Menu', back: 'Back', forward: 'Forward',
    file: 'File', signOut: 'Log out', quit: 'Quit 4VD',
    edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all',
    view: 'View', reload: 'Reload', zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomReset: 'Actual size', fullScreen: 'Full screen', devTools: 'Developer tools',
    go: 'Go', home: 'Home', counter: 'Counter', search: 'Search…',
    help: 'Help', website: 'Open 4vd.app in the browser', about: 'About 4VD',
    aboutDetail: (version) => `Version ${version}`,
    checkUpdates: 'Check for updates…',
    upToDate: '4VD is up to date', upToDateDetail: (version) => `You have the newest version, ${version}.`,
    downloading: 'Downloading the update…', downloadingDetail: (version) => `Version ${version} is downloading. 4VD will ask to restart when it is ready.`,
    ready: 'The update is ready', readyDetail: (version) => `Restart 4VD now to start using version ${version}? It takes a few seconds.`,
    restart: 'Restart now', later: 'Later',
    updateFailed: 'Couldn’t look for updates', updateFailedDetail: 'Check this computer’s internet and try again.',
    devCopy: 'Only the installed 4VD updates itself.',
  },
  sq: {
    menu: 'Menyja', back: 'Prapa', forward: 'Përpara',
    file: 'Skedari', signOut: 'Dil', quit: 'Mbyll 4VD',
    edit: 'Ndrysho', undo: 'Zhbëj', redo: 'Ribëj', cut: 'Prit', copy: 'Kopjo', paste: 'Ngjit', selectAll: 'Zgjidh të gjitha',
    view: 'Pamja', reload: 'Ringarko', zoomIn: 'Zmadho', zoomOut: 'Zvogëlo', zoomReset: 'Madhësia reale', fullScreen: 'Ekran i plotë', devTools: 'Mjetet e zhvilluesit',
    go: 'Shko', home: 'Kreu', counter: 'Arka', search: 'Kërko…',
    help: 'Ndihmë', website: 'Hap 4vd.app në shfletues', about: 'Rreth 4VD',
    aboutDetail: (version) => `Versioni ${version}`,
    checkUpdates: 'Kërko përditësime…',
    upToDate: '4VD është i përditësuar', upToDateDetail: (version) => `Ke versionin më të ri, ${version}.`,
    downloading: 'Po shkarkohet përditësimi…', downloadingDetail: (version) => `Versioni ${version} po shkarkohet. 4VD do të pyesë për rinisje kur të jetë gati.`,
    ready: 'Përditësimi është gati', readyDetail: (version) => `Ta rinisësh 4VD tani për të përdorur versionin ${version}? Zgjat disa sekonda.`,
    restart: 'Rinise tani', later: 'Më vonë',
    updateFailed: 'Nuk u kërkuan dot përditësimet', updateFailedDetail: 'Kontrollo internetin e këtij kompjuteri dhe provo sërish.',
    devCopy: 'Vetëm 4VD i instaluar përditësohet vetë.',
  },
};

const wordsFor = (language) => WORDS[language] ?? WORDS.en;

/**
 * The ☰ menu, as an Electron menu template. Shortcuts are only shown (the page and keys.js handle the keys themselves).
 * @param {'en' | 'sq'} language
 * @param {{ canBack: boolean, canForward: boolean, fullScreen: boolean, signedInPage: boolean, devTools: boolean }} state
 *   signedInPage: the page listens for the app's commands (an older saved copy of the dashboard doesn't).
 * @param {(command: string) => void} run
 */
function menuTemplate(language, state, run) {
  const w = wordsFor(language);
  const item = (label, command, extra = {}) => ({ label, click: () => run(command), registerAccelerator: false, ...extra });
  const separator = { type: 'separator' };
  return [
    { label: w.file, submenu: [
      item(w.signOut, 'signOut', { enabled: state.signedInPage }),
      separator,
      item(w.quit, 'quit', { accelerator: 'Alt+F4' }),
    ] },
    { label: w.edit, submenu: [
      item(w.undo, 'undo', { accelerator: 'Ctrl+Z' }),
      item(w.redo, 'redo', { accelerator: 'Ctrl+Y' }),
      separator,
      item(w.cut, 'cut', { accelerator: 'Ctrl+X' }),
      item(w.copy, 'copy', { accelerator: 'Ctrl+C' }),
      item(w.paste, 'paste', { accelerator: 'Ctrl+V' }),
      item(w.selectAll, 'selectAll', { accelerator: 'Ctrl+A' }),
    ] },
    { label: w.view, submenu: [
      item(w.reload, 'reload', { accelerator: 'Ctrl+R' }),
      separator,
      item(w.zoomIn, 'zoomIn', { accelerator: 'Ctrl+=' }),
      item(w.zoomOut, 'zoomOut', { accelerator: 'Ctrl+-' }),
      item(w.zoomReset, 'zoomReset', { accelerator: 'Ctrl+0' }),
      separator,
      item(w.fullScreen, 'fullscreen', { accelerator: 'F11', type: 'checkbox', checked: state.fullScreen }),
      ...(state.devTools ? [separator, item(w.devTools, 'devtools', { accelerator: 'Ctrl+Shift+I' })] : []),
    ] },
    { label: w.go, submenu: [
      item(w.back, 'back', { accelerator: 'Alt+Left', enabled: state.canBack }),
      item(w.forward, 'forward', { accelerator: 'Alt+Right', enabled: state.canForward }),
      separator,
      item(w.home, 'go:/'),
      item(w.counter, 'go:/counter'),
      item(w.search, 'search', { accelerator: 'Ctrl+K', enabled: state.signedInPage }),
    ] },
    { label: w.help, submenu: [
      item(w.checkUpdates, 'checkUpdates'),
      item(w.website, 'website'),
      separator,
      item(w.about, 'about'),
    ] },
  ];
}

module.exports = { STRIP_HEIGHT, pageBounds, stepTarget, menuTemplate, wordsFor };
