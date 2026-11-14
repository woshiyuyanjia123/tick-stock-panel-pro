const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tspDesktop', {
  isElectron: true,
  platform: process.platform,
  version: '1.1.0-enterprise',
  toggleAlwaysOnTop: () => ipcRenderer.invoke('tsp:toggle-always-on-top'),
  openExternal: (url) => ipcRenderer.invoke('tsp:open-external', url),
  navigateTab: (tab) => ipcRenderer.send('tsp:navigate-tab', tab),
});
