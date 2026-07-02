const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Media
  getLocalMedia:    ()            => ipcRenderer.invoke('get-local-media'),
  extractThumb:     (url)         => ipcRenderer.invoke('extract-thumb', url),
  renameVideo:      (opts)        => ipcRenderer.invoke('rename-video', opts),

  // Descarga (cola con progreso)
  downloadYoutube:  (url)         => ipcRenderer.invoke('download-youtube', url),
  onDownloadProgress: (cb)        => {
    ipcRenderer.on('download-progress', (_e, data) => cb(data));
  },
  offDownloadProgress: ()         => ipcRenderer.removeAllListeners('download-progress'),

  // Playlist guardada (local)
  loadPlaylistTxt:  ()            => ipcRenderer.invoke('load-playlist-txt'),
  savePlaylistTxt:  (content)     => ipcRenderer.invoke('save-playlist-txt', content),

  // Estado del reproductor (volumen + posición)
  savePlayerState:  (state)       => ipcRenderer.invoke('save-player-state', state),
  loadPlayerState:  ()            => ipcRenderer.invoke('load-player-state'),

  // Carpeta → JSON para subir a la nube
  getFolderJson: (folderPath)     => ipcRenderer.invoke('get-folder-json', folderPath),
  uploadToCloud: (jsonData)       => ipcRenderer.invoke('upload-to-cloud', jsonData),
  
  // ── NUEVO: Playlist del domingo desde la nube ──────────────────────
  // Descarga la playlist guardada en BIN_PLAYLIST (index-cliente la escribe)
  fetchCloudPlaylist: ()          => ipcRenderer.invoke('fetch-cloud-playlist'),
 
  // ── NUEVO: Descargas pendientes desde la nube ──────────────────────
  // Lee BIN_PENDING y encola automáticamente al arrancar
  processPendingDownloads: ()     => ipcRenderer.invoke('process-pending-downloads'),
  // Notificación cuando una descarga pendiente termina o falla
  onPendingDownloadDone: (cb)     => {
    ipcRenderer.on('pending-download-done', (_e, data) => cb(data));
  }
});