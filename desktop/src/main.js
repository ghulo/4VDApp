// The Windows app: a window onto the live dashboard, so every dashboard deploy
// reaches it at once. Updates to the app itself come from GitHub Releases.
const { app, BrowserWindow, Menu, ipcMain, nativeTheme, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const fiscal = require('./fiscal.js');
const setupStore = require('./setup.js');

// `npm start` can point at a local dashboard instead: DASHBOARD_URL=http://localhost:5173/
const DASHBOARD_URL = (!app.isPackaged && process.env.DASHBOARD_URL) || 'https://dashboard.4vd.app/';
const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;
// The dashboard is moving from dashboard.4vd.app to 4vd.app (the old address
// redirects there), so both count as the dashboard: pages, links and printing.
const DASHBOARD_ORIGINS = app.isPackaged
  ? ['https://4vd.app', 'https://dashboard.4vd.app']
  : [DASHBOARD_ORIGIN];
// Google's sign-in opens its own small window; everything else leaves for the browser.
const GOOGLE_SIGN_IN = 'https://accounts.google.com';

// Google refuses sign-in from browsers that name themselves Electron, so the
// app presents itself as the plain Chrome it is built on.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|4vd-desktop|4VD)\/\S+/g, '');

// Windows 11's own thin scrollbars, which float over the page instead of taking a strip of it.
app.commandLine.appendSwitch('enable-features', 'FluentScrollbar,FluentOverlayScrollbar');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let setup = null;

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
function handleKeys(event, input) {
  if (input.type !== 'keyDown') return;
  const contents = win.webContents;
  const zoomBy = (step) => contents.setZoomLevel(Math.max(-3, Math.min(3, contents.getZoomLevel() + step)));
  const key = input.key.toLowerCase();
  if (key === 'f5' || (input.control && key === 'r')) contents.reload();
  else if (key === 'f11') win.setFullScreen(!win.isFullScreen());
  else if (input.control && (key === '=' || key === '+')) zoomBy(0.5);
  else if (input.control && key === '-') zoomBy(-0.5);
  else if (input.control && key === '0') contents.setZoomLevel(0);
  else return;
  event.preventDefault();
}

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

  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on('before-input-event', handleKeys);
  win.webContents.on('context-menu', (_event, params) => showEditMenu(params));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(GOOGLE_SIGN_IN)) return { action: 'allow' };
    if (isDashboard(url)) {
      win.loadURL(url);
    } else if (/^https?:|^mailto:|^tel:/.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isDashboard(url) || url.startsWith(GOOGLE_SIGN_IN) || url.startsWith('file:')) return;
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
ipcMain.handle('fiscal:send', (event, job) => {
  if (!fromDashboard(event) || typeof job?.name !== 'string' || typeof job?.text !== 'string' || job.text.length > 20_000) {
    return { status: 'failed', message: null };
  }
  return fiscal.send(job);
});
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
  createWindow();
  // Only an installed copy can update itself; `npm start` skips this.
  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});

app.on('window-all-closed', () => app.quit());
