// The title strip's only bridge: its three keys and the state main.js sends it. No printer, no setup.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fourvdStrip', {
  menu: (x, y) => ipcRenderer.send('strip', { action: 'menu', x, y }),
  back: () => ipcRenderer.send('strip', { action: 'back' }),
  forward: () => ipcRenderer.send('strip', { action: 'forward' }),
  /** { title, canBack, canForward, focused, language, words: { menu, back, forward } } */
  onState: (callback) => {
    ipcRenderer.removeAllListeners('strip:state');
    ipcRenderer.on('strip:state', (_event, state) => callback(state));
    ipcRenderer.send('strip', { action: 'ready' });
  },
});
