const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tspDesktop', {
  isElectron: true,
  platform: process.platform,
  version: 'v1.2.1-enterprise',
  toggleAlwaysOnTop: () => ipcRenderer.invoke('tsp:toggle-always-on-top'),
  openExternal: (url) => ipcRenderer.invoke('tsp:open-external', url),
  navigateTab: (tab) => ipcRenderer.send('tsp:navigate-tab', tab),
  openPopout: (tab, alwaysOnTop = false) =>
    ipcRenderer.invoke('tsp:open-popout', { tab, alwaysOnTop }),
  getDisplayMetrics: () => ipcRenderer.invoke('tsp:display-metrics'),
});
