// The Windows app: a window onto the live dashboard, so every dashboard deploy
// reaches it at once. Updates to the app itself come from GitHub Releases.
const { app, BrowserWindow, Menu, WebContentsView, dialog, ipcMain, nativeTheme, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { autoUpdater } = require('electron-updater');
const fiscal = require('./fiscal.js');
const journal = require('./journal.js');
const setupStore = require('./setup.js');
const { keyAction, pathOf } = require('./keys.js');
const frame = require('./frame.js');

// `npm start` can point at a local dashboard instead: DASHBOARD_URL=http://localhost:5173/
const DASHBOARD_URL = (!app.isPackaged && process.env.DASHBOARD_URL) || 'https://4vd.app/';
const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;
// Only the dashboard may open pages, links and printing (dashboard.4vd.app is gone).
const DASHBOARD_ORIGINS = app.isPackaged ? ['https://4vd.app'] : [DASHBOARD_ORIGIN];
// Google's sign-in opens its own small window; everything else leaves for the browser.
const GOOGLE_SIGN_IN = 'https://accounts.google.com';

// Google refuses sign-in from browsers that name themselves Electron, so the
// app presents itself as the plain Chrome it is built on.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|4vd-desktop|4VD)\/\S+/g, '');

// Windows 11's own thin scrollbars, which float over the page instead of taking a strip of it.
app.commandLine.appendSwitch('enable-features', 'FluentScrollbar,FluentOverlayScrollbar');

// The same id the installer gives its shortcuts, so a pinned 4VD and the open
// window are one icon on the taskbar and in Start.
app.setAppUserModelId('app.4vd.desktop');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
// The dashboard, in a view under the app's own title strip (strip.html is the window's own page).
let view = null;
// The page took the app's commands (Go, Search, Log out) since it last loaded; an older saved copy of the dashboard doesn't.
let pageListens = false;
let setup = null;

// Update trouble goes to update.log next to setup.json (the last ~200 lines),
// so a shop PC that stops updating can tell us why.
function logUpdate(message) {
  try {
    const file = path.join(app.getPath('userData'), 'update.log');
    const line = `${new Date().toISOString()} ${message}\n`;
    let old = '';
    try { old = fs.readFileSync(file, 'utf8'); } catch { /* first line */ }
    const kept = (old + line).split('\n').slice(-201).join('\n');
    fs.writeFileSync(file, kept);
  } catch { /* never let logging break the app */ }
}

/** The fiscal printer's job journal (journal.js): each receipt's fate by its sale's key, outside the page's storage. */
function journalFile() {
  return path.join(app.getPath('userData'), 'fiscal-journal.json');
}
// Opened once the app is ready (the settings folder is known then).
let printJournal = null;

function setupFile() {
  return path.join(app.getPath('userData'), 'setup.json');
}

/** The language for the app's own pages: the dashboard's last choice, else the system's. */
function pageLanguage() {
  return setup?.language ?? (app.getLocale().startsWith('sq') ? 'sq' : 'en');
}

/** Starting with Windows only works for the installed app (`npm start` would add Electron itself). */
function openAtLogin() {
  return app.isPackaged && app.getLoginItemSettings().openAtLogin;
}

/** The counter PC fills the screen; F11 still leaves full screen for a moment. */
function applyRole() {
  if (setup.done) win?.setFullScreen(setup.role === 'counter');
}

// The ink colour of each theme (DESIGN.md), for the minimise, maximise and close symbols.
const CAPTION_INK = { light: '#141413', dark: '#f3f1ea' };

function captionStyle() {
  return {
    color: '#00000000',
    symbolColor: CAPTION_INK[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'],
    height: frame.STRIP_HEIGHT,
  };
}

// The window comes back where and how big it was left.
function windowFile() {
  return path.join(app.getPath('userData'), 'window.json');
}

function readWindowState() {
  try {
    const saved = JSON.parse(fs.readFileSync(windowFile(), 'utf8'));
    const { x, y, width, height } = saved.bounds;
    // A screen that has since been unplugged would leave the window out of sight.
    const onScreen = screen.getAllDisplays().some(({ workArea: area }) =>
      x < area.x + area.width && x + width > area.x && y < area.y + area.height && y + height > area.y);
    return onScreen ? saved : { maximized: saved.maximized };
  } catch {
    return { maximized: true };
  }
}

function saveWindowState() {
  try {
    fs.writeFileSync(windowFile(), JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {
    // The settings folder can't be written: the window opens maximised next time.
  }
}

/** The question before typed work is lost, in the dashboard's language. */
const LEAVE_WORDS = {
  en: { message: 'Leave without saving?', detail: 'What you typed here hasn’t been saved yet and will be lost.', leave: 'Leave', stay: 'Stay' },
  sq: { message: 'Të dalësh pa ruajtur?', detail: 'Ajo që shkrove këtu ende nuk është ruajtur dhe do të humbasë.', leave: 'Dil', stay: 'Qëndro' },
};

const EDIT_LABELS = app.getLocale().startsWith('sq')
  ? { cut: 'Prit', copy: 'Kopjo', paste: 'Ngjit', selectAll: 'Zgjidh të gjitha' }
  : { cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all' };

// Right-click gives the usual Windows menu wherever there is text to work with.
function showEditMenu({ editFlags, isEditable, selectionText }) {
  const items = isEditable
    ? [
        { role: 'cut', label: EDIT_LABELS.cut, enabled: editFlags.canCut },
        { role: 'copy', label: EDIT_LABELS.copy, enabled: editFlags.canCopy },
        { role: 'paste', label: EDIT_LABELS.paste, enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: EDIT_LABELS.selectAll },
      ]
    : selectionText.trim()
      ? [{ role: 'copy', label: EDIT_LABELS.copy }]
      : [];
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

// With no menu bar the browser's reload and zoom keys are gone, so they come back here.
// The Counter keeps F5 for itself (it picks the customer there): see keys.js.
// The strip's keys work the same, so a key never goes dead while the strip has the focus.
function handleKeys(event, input) {
  const contents = livePage();
  if (!contents) return;
  const action = keyAction(input, pathOf(contents.getURL()));
  if (!action) return;
  runCommand(action);
  event.preventDefault();
}

/** The dashboard's page while it is there (it goes first when the window closes), else null. */
function livePage() {
  // A view whose page has gone has no webContents at all (undefined), not a destroyed one.
  const contents = view?.webContents;
  return contents && !contents.isDestroyed() ? contents : null;
}

/** The Counter keeps the sale on screen: Back and Forward (keys, mouse side buttons, strip) don't take it away. */
const onCounter = (contents) => /^\/counter(\/|$)/.test(pathOf(contents.getURL()));

/** Where Back (-1) or Forward (+1) would land, or null. */
function stepIndex(contents, offset) {
  if (onCounter(contents)) return null;
  return frame.stepTarget(historyOf(contents), offset, isDashboard);
}

/** Where the dashboard sits: under the strip, or the whole window in full screen. */
function layoutPage() {
  if (!win || win.isDestroyed() || !view) return;
  const [width, height] = win.getContentSize();
  view.setBounds(frame.pageBounds({ width, height }, win.isFullScreen()));
}

/** The dashboard's history as frame.stepTarget reads it. */
function historyOf(contents) {
  const history = contents.navigationHistory;
  const urls = [];
  for (let i = 0; i < history.length(); i++) urls.push(history.getEntryAtIndex(i)?.url ?? '');
  return { index: history.getActiveIndex(), urls };
}

/** Back (-1) or forward (+1), only onto the dashboard: the page's own leave guards still ask first. */
function step(offset) {
  const contents = livePage();
  const target = contents ? stepIndex(contents, offset) : null;
  if (target !== null) contents.navigationHistory.goToIndex(target);
}

/** The strip shows the page's title and whether Back and Forward go anywhere. */
function sendStripState() {
  const contents = livePage();
  if (!win || win.isDestroyed() || !contents) return;
  const words = frame.wordsFor(pageLanguage());
  win.webContents.send('strip:state', {
    title: isDashboard(contents.getURL()) ? contents.getTitle() : '4VD',
    canBack: stepIndex(contents, -1) !== null,
    canForward: stepIndex(contents, 1) !== null,
    focused: win.isFocused(),
    language: pageLanguage(),
    words: { menu: words.menu, back: words.back, forward: words.forward },
  });
}

/** One thing from the ☰ menu, a strip key or a shortcut, done on the dashboard. */
function runCommand(command) {
  const contents = livePage();
  if (!win || win.isDestroyed() || !contents) return;
  // Zoom only the dashboard: the app's own pages share one zoom with the strip (all file://).
  const zoomBy = (by) => isDashboard(contents.getURL()) && contents.setZoomLevel(Math.max(-3, Math.min(3, contents.getZoomLevel() + by)));
  if (command.startsWith('go:')) {
    const where = command.slice(3);
    // The page moves itself, so a form with typed work asks first; an older saved copy just loads the address.
    if (pageListens) contents.send('command', { type: 'go', path: where });
    else contents.loadURL(new URL(where, DASHBOARD_URL).href);
  } else if (command === 'search' || command === 'signOut') {
    if (pageListens) contents.send('command', { type: command });
  } else if (command === 'back') step(-1);
  else if (command === 'forward') step(1);
  else if (command === 'reload') contents.reload();
  else if (command === 'fullscreen') win.setFullScreen(!win.isFullScreen());
  else if (command === 'zoomIn') zoomBy(0.5);
  else if (command === 'zoomOut') zoomBy(-0.5);
  else if (command === 'zoomReset') zoomBy(-contents.getZoomLevel());
  else if (['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].includes(command)) contents[command]();
  else if (command === 'devtools' && !app.isPackaged) contents.openDevTools({ mode: 'detach' });
  else if (command === 'website') shell.openExternal(DASHBOARD_URL);
  else if (command === 'checkUpdates') checkForUpdates();
  else if (command === 'about') {
    const words = frame.wordsFor(pageLanguage());
    dialog.showMessageBox(win, { type: 'info', title: '4VD', message: '4VD', detail: words.aboutDetail(app.getVersion()), noLink: true });
  } else if (command === 'quit') win.close();
  contents.focus();
}

function showMenu(x, y) {
  const contents = livePage();
  if (!contents) return;
  const state = {
    canBack: stepIndex(contents, -1) !== null,
    canForward: stepIndex(contents, 1) !== null,
    fullScreen: win.isFullScreen(),
    signedInPage: pageListens,
    devTools: !app.isPackaged,
  };
  Menu.buildFromTemplate(frame.menuTemplate(pageLanguage(), state, runCommand))
    .popup({ window: win, x, y, callback: () => livePage()?.focus() });
}

/** Google's sign-in window: its exact address, not one that only starts the same (accounts.google.com.evil.example). */
function isGoogleSignIn(url) {
  try {
    return new URL(url).origin === GOOGLE_SIGN_IN;
  } catch {
    return false;
  }
}

/** The app's own loading and offline pages, not any file on the PC. */
const OWN_FILES = pathToFileURL(__dirname + path.sep).href;
const isOwnFile = (url) => url.startsWith(OWN_FILES);

function isDashboard(url) {
  return DASHBOARD_ORIGINS.some((origin) => url.startsWith(origin + '/') || url === origin);
}

// Updates: checked on every start (downloaded quietly, put in when 4VD next closes), and by hand from
// Help → Check for updates, which asks to restart as soon as the new version has downloaded.
let askWhenReady = false;
let restartForUpdate = false;
let updateReady = null;

function updateBox(type, message, detail, buttons) {
  if (!win || win.isDestroyed()) return Promise.resolve({ response: -1 });
  const choice = buttons ? { buttons, defaultId: 0, cancelId: buttons.length - 1 } : {};
  return dialog.showMessageBox(win, { type, title: '4VD', message, detail, noLink: true, ...choice });
}

async function offerRestart(version) {
  const words = frame.wordsFor(pageLanguage());
  const { response } = await updateBox('question', words.ready, words.readyDetail(version), [words.restart, words.later]);
  // The window closes as usual first, so typed work still asks "Leave without saving?"; the installer starts only
  // once the page has gone (window-all-closed). Stay cancels the restart.
  if (response === 0 && win && !win.isDestroyed()) {
    restartForUpdate = true;
    win.close();
  }
}

function watchUpdates() {
  autoUpdater.on('error', (err) => {
    logUpdate(`error: ${err?.message ?? err}`);
    if (!askWhenReady) return;
    askWhenReady = false;
    const words = frame.wordsFor(pageLanguage());
    updateBox('warning', words.updateFailed, words.updateFailedDetail);
  });
  autoUpdater.on('update-available', (info) => {
    logUpdate(`found ${info?.version}`);
    if (!askWhenReady) return;
    const words = frame.wordsFor(pageLanguage());
    updateBox('info', words.downloading, words.downloadingDetail(info?.version ?? ''));
  });
  autoUpdater.on('update-not-available', () => {
    if (!askWhenReady) return;
    askWhenReady = false;
    const words = frame.wordsFor(pageLanguage());
    updateBox('info', words.upToDate, words.upToDateDetail(app.getVersion()));
  });
  autoUpdater.on('update-downloaded', (info) => {
    logUpdate(`downloaded ${info?.version}`);
    updateReady = info?.version ?? '';
    if (!askWhenReady) return;
    askWhenReady = false;
    offerRestart(updateReady);
  });
}

function checkForUpdates() {
  const words = frame.wordsFor(pageLanguage());
  if (!app.isPackaged) return updateBox('info', words.devCopy, words.aboutDetail(app.getVersion()));
  // Already downloaded on start: offer the restart straight away.
  if (updateReady !== null) return offerRestart(updateReady);
  askWhenReady = true;
  logUpdate('checking by hand');
  autoUpdater.checkForUpdates().catch((err) => logUpdate(`check failed: ${err?.message ?? err}`));
}

function createWindow() {
  const state = readWindowState();
  win = new BrowserWindow({
    ...(state.bounds ?? { width: 1440, height: 900 }),
    minWidth: 400,
    minHeight: 600,
    show: false,
    title: '4VD',
    // The app's own strip (strip.html) is the title bar; Windows still draws the caption buttons over its right end.
    titleBarStyle: 'hidden',
    titleBarOverlay: captionStyle(),
    // Mica shows through wherever the strip and the dashboard leave the window clear (strip, top bar, sidebar).
    backgroundMaterial: 'mica',
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'strip-preload.js') },
  });
  // The strip is the app's own page: it never goes anywhere else or opens windows.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', handleKeys);
  // Typing always goes to the dashboard (a barcode scanner types too): the strip hands the focus straight back.
  win.webContents.on('focus', () => livePage()?.focus());

  // The default session, as before: sign-in, the saved offline copy and the till's unsent sales stay where they were.
  view = new WebContentsView({
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  view.setBackgroundColor('#00000000');
  win.contentView.addChildView(view);
  layoutPage();
  const page = view.webContents;

  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize();
    if (setup.done && setup.role === 'counter') win.setFullScreen(true);
    win.show();
    page.focus();
  });
  for (const change of ['resize', 'resized', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) win.on(change, layoutPage);
  win.on('focus', () => {
    livePage()?.focus();
    sendStripState();
  });
  win.on('blur', sendStripState);
  // The mouse's side buttons.
  win.on('app-command', (_event, command) => {
    if (command === 'browser-backward') step(-1);
    else if (command === 'browser-forward') step(1);
  });

  // Closing the window doesn't ask the page by itself (it is a view inside it), so the page is closed first:
  // over typed work it asks "Leave without saving?" (below), and Stay keeps both open.
  let pageClosed = false;
  win.on('close', (event) => {
    saveWindowState();
    if (pageClosed || page.isDestroyed()) return;
    event.preventDefault();
    page.close({ waitForBeforeUnload: true });
  });
  page.once('destroyed', () => {
    pageClosed = true;
    view = null;
    // After the page has gone, not while it is still being taken down.
    setImmediate(() => {
      if (win && !win.isDestroyed()) win.close();
    });
  });
  win.on('closed', () => {
    if (!page.isDestroyed()) page.close();
    win = null;
    view = null;
  });

  // The dashboard holds typed work (beforeunload): Windows' own question before the window closes or reloads.
  // preventDefault lets the page go; doing nothing keeps it.
  page.on('will-prevent-unload', (event) => {
    const words = LEAVE_WORDS[pageLanguage()] ?? LEAVE_WORDS.en;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: [words.leave, words.stay],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: '4VD',
      message: words.message,
      detail: words.detail,
    });
    if (choice === 0) event.preventDefault();
    // Stay: an update waiting for this restart waits for the next close instead.
    else restartForUpdate = false;
  });

  page.setVisualZoomLevelLimits(1, 1);
  page.on('before-input-event', handleKeys);
  page.on('context-menu', (_event, params) => showEditMenu(params));
  // A new document replaced the page: it says again whether it listens (a download or an empty answer replaces nothing).
  page.on('did-navigate', () => {
    pageListens = false;
  });
  for (const change of ['did-navigate', 'did-navigate-in-page', 'page-title-updated']) page.on(change, sendStripState);

  page.setWindowOpenHandler(({ url }) => {
    if (isGoogleSignIn(url)) return { action: 'allow' };
    if (isDashboard(url)) {
      page.loadURL(url);
    } else if (/^https?:|^mailto:|^tel:/.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  page.on('will-navigate', (event, url) => {
    if (isDashboard(url) || isGoogleSignIn(url) || isOwnFile(url)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  // No internet or the dashboard is down: show a calm page that retries.
  page.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    // -3 is a navigation that was replaced by another one, not a failure.
    if (!isMainFrame || code === -3) return;
    page.loadFile(path.join(__dirname, 'offline.html'), {
      query: { retry: isDashboard(url) ? url : startURL(), lang: pageLanguage() },
    });
  });

  // The small 4VD loading page shows at once; it stays up until the dashboard paints.
  page.once('did-finish-load', () => page.loadURL(startURL()));
  page.loadFile(path.join(__dirname, 'loading.html'), { query: { lang: pageLanguage() } });
  win.loadFile(path.join(__dirname, 'strip.html'));
}

/** The welcome screen the first time, then the Counter or the dashboard. */
function startURL() {
  return new URL(setupStore.startPath(setup), DASHBOARD_URL).href;
}

// The dashboard's theme choice also colours the frame: Mica and the caption buttons.
ipcMain.on('theme', (_event, preference) => {
  if (['light', 'dark', 'system'].includes(preference)) nativeTheme.themeSource = preference;
});
// The counter's fiscal printer: only the dashboard itself may print.
const fromDashboard = (event) => isDashboard(event.senderFrame?.url ?? '');
// The strip's keys: only from the strip page itself.
ipcMain.on('strip', (event, message) => {
  if (!win || event.sender !== win.webContents) return;
  if (message?.action === 'ready') sendStripState();
  else if (message?.action === 'back' || message?.action === 'forward') runCommand(message.action);
  else if (message?.action === 'menu' && Number.isFinite(message.x) && Number.isFinite(message.y)) showMenu(message.x, message.y);
});
// The dashboard listens for the menu's Go, Search and Log out (Windows app 0.6.0 and later).
ipcMain.on('commands:ready', (event) => {
  const contents = livePage();
  if (contents && event.sender === contents && fromDashboard(event)) pageListens = true;
});
ipcMain.handle('fiscal:status', (event) => (fromDashboard(event) ? fiscal.status() : null));
ipcMain.handle('fiscal:send', async (event, job) => {
  if (!fromDashboard(event) || typeof job?.name !== 'string' || typeof job?.text !== 'string' || job.text.length > 20_000 || !fiscal.isAllowedJob(job.text)) {
    return { status: 'failed', message: null };
  }
  // A sale's receipt is noted here before it goes and again with F-Link's answer, even if the page that asked is gone by then.
  // A sale's receipt that printed already comes back as it was, never printed twice; one that can't be noted doesn't print.
  return printJournal.track(job.key, job.name, (onFile) => fiscal.send({ name: job.name, text: job.text }, onFile), { confirmed: job.confirmed === true });
});
// What happened to a sale's last receipt (journal.js), or null.
ipcMain.handle('fiscal:lookup', (event, key) => (fromDashboard(event) ? printJournal.lookup(key) : null));
// The Counter noted that receipt's outcome on its side: the journal may let it go in time.
ipcMain.handle('fiscal:ack', (event, key) => (fromDashboard(event) ? printJournal.ack(key) : false));
// The welcome screen and Settings → This computer.
ipcMain.handle('setup:get', (event) =>
  fromDashboard(event) ? { ...setup, openAtLogin: openAtLogin(), canOpenAtLogin: app.isPackaged, version: app.getVersion() } : null);
ipcMain.handle('setup:save', (event, change) => {
  if (!fromDashboard(event)) return null;
  setup = setupStore.merge(setup, change);
  setupStore.write(setupFile(), setup);
  if (app.isPackaged && typeof change?.openAtLogin === 'boolean') app.setLoginItemSettings({ openAtLogin: change.openAtLogin });
  // Full screen comes on when the welcome finishes (or at the next start), never in the middle of Settings.
  if (change?.done === true) applyRole();
  else if (setup.role === 'office') win?.setFullScreen(false);
  return { ...setup, openAtLogin: openAtLogin(), canOpenAtLogin: app.isPackaged, version: app.getVersion() };
});
// The dashboard's language, so the loading and offline pages speak it too.
ipcMain.on('language', (event, language) => {
  if (!fromDashboard(event) || language === setup.language) return;
  setup = setupStore.merge(setup, { language });
  setupStore.write(setupFile(), setup);
  sendStripState();
});
nativeTheme.on('updated', () => win?.setTitleBarOverlay(captionStyle()));

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  setup = setupStore.read(setupFile());
  // A receipt still printing when the app last closed: F-Link's folder says how it went, else it is unknown.
  printJournal = journal.openJournal(journalFile(), { recover: (entry) => fiscal.answerFor(entry.file, entry.at) });
  printJournal.settleStale();
  createWindow();
  // Only an installed copy can update itself; `npm start` skips this.
  if (app.isPackaged) {
    watchUpdates();
    logUpdate(`checking (running ${app.getVersion()})`);
    autoUpdater.checkForUpdatesAndNotify().catch((err) => logUpdate(`check failed: ${err?.message ?? err}`));
  }
});

app.on('window-all-closed', () => {
  if (restartForUpdate) autoUpdater.quitAndInstall(true, true);
  else app.quit();
});
// One last try at writing the print journal: a write the disk refused a moment ago (journal.js retries every few seconds)
// would otherwise go with the app, and the next start would only know the receipt as "printing" (then unknown).
app.on('before-quit', () => {
  try {
    printJournal?.flush();
  } catch {
    // Nothing more to do while quitting; the next start settles it from F-Link's folder.
  }
});
