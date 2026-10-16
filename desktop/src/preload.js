// Tells the dashboard it runs inside the Windows app, and lets it pass on the
// theme choice so the window's own frame (Mica and the caption buttons) matches.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fourvdDesktop', {
  /** "light", "dark" or "system", exactly as the dashboard saves it. */
  setTheme: (preference) => ipcRenderer.send('theme', preference),
});
