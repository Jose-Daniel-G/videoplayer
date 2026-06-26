const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getLocalMedia:       () => ipcRenderer.invoke('get-local-media'),
  selectVideosFolder:  () => ipcRenderer.invoke('select-videos-folder'),
  loadPlaylistTxt:     () => ipcRenderer.invoke('load-playlist-txt'),
  savePlaylistTxt: (content) => ipcRenderer.invoke('save-playlist-txt', content)
});