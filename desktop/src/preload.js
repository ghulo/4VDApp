// Tells the dashboard it runs inside the Windows app, lets it pass on the
// theme choice so the window's own frame (Mica and the caption buttons) matches,
// and lets the counter print on the fiscal printer beside this PC.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fourvdDesktop', {
  /** "light", "dark" or "system", exactly as the dashboard saves it. */
  setTheme: (preference) => ipcRenderer.send('theme', preference),
  /** The fiscal printer (Datecs through F-Link): { folder, flink, path }. */
  fiscalStatus: () => ipcRenderer.invoke('fiscal:status'),
  /** Hand F-Link one job ({ name, text }); resolves with { status, receiptNo?, message? }. */
  fiscalSend: (job) => ipcRenderer.invoke('fiscal:send', job),
});
