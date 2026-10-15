// The Windows app: a window onto the live dashboard, so every dashboard deploy
// reaches it at once. Updates to the app itself come from GitHub Releases.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

const DASHBOARD_URL = 'https://dashboard.4vd.app/';
const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;
// Google's sign-in opens its own small window; everything else leaves for the browser.
const GOOGLE_SIGN_IN = 'https://accounts.google.com';

// Google refuses sign-in from browsers that name themselves Electron, so the
// app presents itself as the plain Chrome it is built on.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|4vd-desktop|4VD)\/\S+/g, '');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function isDashboard(url) {
  return url.startsWith(DASHBOARD_ORIGIN + '/') || url === DASHBOARD_ORIGIN;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 400,
    minHeight: 600,
    show: false,
    title: '4VD',
    // Paper colour, so the window never flashes white before the dashboard paints.
    backgroundColor: '#faf9f5',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

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
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { retry: isDashboard(url) ? url : DASHBOARD_URL } });
  });

  win.loadURL(DASHBOARD_URL);
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  // Only an installed copy can update itself; `npm start` skips this.
  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});

app.on('window-all-closed', () => app.quit());
