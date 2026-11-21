// The Windows app: a window onto the live dashboard, so every dashboard deploy
// reaches it at once. Updates to the app itself come from GitHub Releases.
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { autoUpdater } = require('electron-updater');
const fiscal = require('./fiscal.js');
const journal = require('./journal.js');
const setupStore = require('./setup.js');
const { keyAction, pathOf } = require('./keys.js');

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

// The top bar's height in the dashboard (shell.css), so the caption buttons line up with it.
const TITLE_BAR_HEIGHT = 56;
// The ink colour of each theme (DESIGN.md), for the minimise, maximise and close symbols.
const CAPTION_INK = { light: '#141413', dark: '#f3f1ea' };

function captionStyle() {
  return {
    color: '#00000000',
    symbolColor: CAPTION_INK[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'],
    height: TITLE_BAR_HEIGHT,
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
function handleKeys(event, input) {
  const contents = win.webContents;
  const action = keyAction(input, pathOf(contents.getURL()));
  if (!action) return;
  const zoomBy = (step) => contents.setZoomLevel(Math.max(-3, Math.min(3, contents.getZoomLevel() + step)));
  if (action === 'reload') contents.reload();
  else if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
  else if (action === 'zoomIn') zoomBy(0.5);
  else if (action === 'zoomOut') zoomBy(-0.5);
  else contents.setZoomLevel(0);
  event.preventDefault();
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

function createWindow() {
  const state = readWindowState();
  win = new BrowserWindow({
    ...(state.bounds ?? { width: 1440, height: 900 }),
    minWidth: 400,
    minHeight: 600,
    show: false,
    title: '4VD',
    // The dashboard's top bar is the title bar; Windows still draws the caption buttons.
    titleBarStyle: 'hidden',
    titleBarOverlay: captionStyle(),
    // Mica shows through wherever the dashboard leaves the window clear (top bar, sidebar).
    backgroundMaterial: 'mica',
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize();
    if (setup.done && setup.role === 'counter') win.setFullScreen(true);
    win.show();
  });
  win.on('close', saveWindowState);
  // The dashboard holds typed work (beforeunload): Windows' own question before the window closes or reloads.
  // preventDefault lets the page go; doing nothing keeps it.
  win.webContents.on('will-prevent-unload', (event) => {
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
  });

  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on('before-input-event', handleKeys);
  win.webContents.on('context-menu', (_event, params) => showEditMenu(params));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isGoogleSignIn(url)) return { action: 'allow' };
    if (isDashboard(url)) {
      win.loadURL(url);
    } else if (/^https?:|^mailto:|^tel:/.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isDashboard(url) || isGoogleSignIn(url) || isOwnFile(url)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  // No internet or the dashboard is down: show a calm page that retries.
  win.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    // -3 is a navigation that was replaced by another one, not a failure.
    if (!isMainFrame || code === -3) return;
    win.loadFile(path.join(__dirname, 'offline.html'), {
      query: { retry: isDashboard(url) ? url : startURL(), lang: pageLanguage() },
    });
  });

  // The small 4VD loading page shows at once; it stays up until the dashboard paints.
  win.webContents.once('did-finish-load', () => win.loadURL(startURL()));
  win.loadFile(path.join(__dirname, 'loading.html'), { query: { lang: pageLanguage() } });
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
    autoUpdater.on('error', (err) => logUpdate(`error: ${err?.message ?? err}`));
    autoUpdater.on('update-available', (info) => logUpdate(`found ${info?.version}`));
    autoUpdater.on('update-downloaded', (info) => logUpdate(`downloaded ${info?.version}`));
    logUpdate(`checking (running ${app.getVersion()})`);
    autoUpdater.checkForUpdatesAndNotify().catch((err) => logUpdate(`check failed: ${err?.message ?? err}`));
  }
});

app.on('window-all-closed', () => app.quit());
