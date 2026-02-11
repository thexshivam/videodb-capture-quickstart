const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('factDetector', {
  startSession: (opts) => ipcRenderer.invoke('start-session', opts),
  stopSession: () => ipcRenderer.invoke('stop-session'),
  getStats: () => ipcRenderer.invoke('get-stats'),
  checkHealth: () => ipcRenderer.invoke('check-health'),
  getSessionState: () => ipcRenderer.invoke('get-session-state'),
  quitApp: () => ipcRenderer.send('quit-app'),
  onFactCheckAlert: (cb) => ipcRenderer.on('fact-check-alert', (_event, data) => cb(data)),
  onSessionStatus: (cb) => ipcRenderer.on('session-status', (_event, status) => cb(status)),
  onBackendStatus: (cb) => ipcRenderer.on('backend-status', (_event, status) => cb(status)),
  onErrorMessage: (cb) => ipcRenderer.on('error-message', (_event, data) => cb(data)),
  hideWindow: () => ipcRenderer.send('hide-window'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
});
