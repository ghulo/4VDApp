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
  /**
   * Hand F-Link one job ({ name, text, key? }); resolves with { status, receiptNo?, message? }. With a sale's key, the app notes
   * the job and its answer (status not_saved: it couldn't be noted, so nothing printed); a key that printed already gives its answer back without printing.
   */
  fiscalSend: (job) => ipcRenderer.invoke('fiscal:send', job),
  /** What happened to that sale's last receipt: { status: printing | printed | failed | not_running | no_folder | unknown, receiptNo, message } or null. */
  fiscalLookup: (key) => ipcRenderer.invoke('fiscal:lookup', key),
  /** The Counter noted that sale's receipt outcome on its side: the journal may let it go in time. */
  fiscalAck: (key) => ipcRenderer.invoke('fiscal:ack', key),
  /** This app asks "Leave without saving?" itself when the dashboard holds typed work (older apps closed silently). */
  confirmsLeave: true,
  /** { done, role: "counter" | "office", openAtLogin, canOpenAtLogin, version }. */
  getSetup: () => ipcRenderer.invoke('setup:get'),
  /** Change any of { done, role, openAtLogin }; resolves with the new setup. */
  saveSetup: (change) => ipcRenderer.invoke('setup:save', change),
  /** "en" or "sq", so the app's own loading and offline pages match. */
  setLanguage: (language) => ipcRenderer.send('language', language),
  /** 0.6.0 and later: the app draws its own title strip above the page, so the page leaves no room for Windows' caption buttons. */
  titleStrip: true,
  /**
   * The strip's ☰ menu asks the page to { type: 'go', path } | { type: 'search' } | { type: 'signOut' }.
   * Calling this tells the app the page listens (an older saved copy of the dashboard doesn't, and the app works around it).
   */
  onCommand: (callback) => {
    ipcRenderer.removeAllListeners('command');
    ipcRenderer.on('command', (_event, command) => callback(command));
    ipcRenderer.send('commands:ready');
  },
});
