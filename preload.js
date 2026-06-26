const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getLocalMedia: () => ipcRenderer.invoke('get-local-media'),
  loadPlaylistTxt: () => ipcRenderer.invoke('load-playlist-txt'), // Los que ya tenías
  savePlaylistTxt: (content) => ipcRenderer.invoke('save-playlist-txt', content)
});