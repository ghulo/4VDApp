// Tells the dashboard it runs inside the Windows app, lets it pass on the
// theme choice so the window's own frame (Mica and the caption buttons) matches,
// lets the counter print on the fiscal printer beside this PC, and keeps what
// this computer is for (the welcome screen and Settings → This computer).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fourvdDesktop', {
  /** "light", "dark" or "system", exactly as the dashboard saves it. */
  setTheme: (preference) => ipcRenderer.send('theme', preference),
  /** The fiscal printer (Datecs through F-Link): { folder, flink, path }. */
  fiscalStatus: () => ipcRenderer.invoke('fiscal:status'),
  /** Hand F-Link one job ({ name, text }); resolves with { status, receiptNo?, message? }. */
  fiscalSend: (job) => ipcRenderer.invoke('fiscal:send', job),
  /** { done, role: "counter" | "office", openAtLogin, canOpenAtLogin, version }. */
  getSetup: () => ipcRenderer.invoke('setup:get'),
  /** Change any of { done, role, openAtLogin }; resolves with the new setup. */
  saveSetup: (change) => ipcRenderer.invoke('setup:save', change),
  /** "en" or "sq", so the app's own loading and offline pages match. */
  setLanguage: (language) => ipcRenderer.send('language', language),
});
