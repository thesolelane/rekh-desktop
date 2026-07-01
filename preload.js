const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rekhAPI', {
  isMac: process.platform === 'darwin',
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  getProxyState: () => ipcRenderer.invoke('rekh-get-proxy-state'),
  setProxy: (config) => ipcRenderer.invoke('rekh-set-proxy', config),
  getPrivacy: () => ipcRenderer.invoke('rekh-get-privacy'),
  setPrivacy: (p) => ipcRenderer.invoke('rekh-set-privacy', p),
  onBlockedCount: (cb) => ipcRenderer.on('blocked-count', (e,n) => cb(n)),
  aiStatus: () => ipcRenderer.invoke('rekh-ai-status'),
  setAiKey: (key) => ipcRenderer.invoke('rekh-set-ai-key', key),
  importAiKeyEnc: (b64) => ipcRenderer.invoke('rekh-import-ai-key-enc', b64),
  aiRequest: (opts) => ipcRenderer.invoke('rekh-ai-request', opts),
  onVpnHealthStatus: (cb) => ipcRenderer.on('vpn-health-status', (e,d) => cb(d)),
  onVpnKillSwitch: (cb) => ipcRenderer.on('vpn-kill-switch', (e,d) => cb(d)),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (e,d) => cb(d)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (e,d) => cb(d)),
  onOpenNewTab: (cb) => ipcRenderer.on('open-new-tab', (e,url) => cb(url)),
  onDownloadUpdate: (cb) => ipcRenderer.on('download-update', (e,d) => cb(d))
});
