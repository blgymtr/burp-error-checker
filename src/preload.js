'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bec', {
  info: () => ipcRenderer.invoke('app:info'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  scan: () => ipcRenderer.invoke('scan:run'),
  onProgress: (fn) => {
    const h = (_e, p) => fn(p);
    ipcRenderer.on('scan:progress', h);
    return () => ipcRenderer.removeListener('scan:progress', h);
  },
  exportReport: (format) => ipcRenderer.invoke('report:export', format),
  copyReport: () => ipcRenderer.invoke('report:copy'),
  copyExtension: (id) => ipcRenderer.invoke('ext:copy', id),
  copyText: (t) => ipcRenderer.invoke('clip:write', t),
  showPath: (id, kind) => ipcRenderer.invoke('path:show', id, kind),
  pick: (kind) => ipcRenderer.invoke('dialog:pick', kind),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  shot: (name) => ipcRenderer.invoke('shot:capture', name),
  shotsDone: () => ipcRenderer.invoke('shot:done'),
});
