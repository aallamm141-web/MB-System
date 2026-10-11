'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// The only things the web page may ask the desktop shell to do.
contextBridge.exposeInMainWorld('shopAPI', {
  isElectron: true,
  info: () => ipcRenderer.invoke('info'),
  print: () => ipcRenderer.invoke('print'),
  printers: () => ipcRenderer.invoke('printers'),
  setConfig: (o) => ipcRenderer.invoke('setConfig', o),
  saveBackup: (text) => ipcRenderer.invoke('saveBackup', text),
  listBackups: () => ipcRenderer.invoke('listBackups'),
  readBackup: (name) => ipcRenderer.invoke('readBackup', name),
  pickBackup: () => ipcRenderer.invoke('pickBackup'),
  chooseBackupDir: () => ipcRenderer.invoke('chooseBackupDir'),
  openBackupDir: () => ipcRenderer.invoke('openBackupDir'),
  savePreUpdate: (text, ver) => ipcRenderer.invoke('savePreUpdate', text, ver),
  updateStatus: () => ipcRenderer.invoke('updateStatus'),
  updateCheck: () => ipcRenderer.invoke('updateCheck'),
  updateDownload: () => ipcRenderer.invoke('updateDownload'),
  updateInstall: () => ipcRenderer.invoke('updateInstall'),
  onUpdate: (cb) => ipcRenderer.on('update-state', (_e, s) => cb(s)),
  onBeforeClose: (cb) => ipcRenderer.on('before-close', () => cb()),
  closeAck: () => ipcRenderer.send('close-ack'),
});
