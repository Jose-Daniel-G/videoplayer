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
  uploadPlaylist: (filenames)     => ipcRenderer.invoke('upload-playlist', filenames),
  
  // ── NUEVO: Playlist del domingo desde la nube ──────────────────────
  // Descarga la playlist guardada en BIN_PLAYLIST (index-cliente la escribe)
  fetchCloudPlaylist: ()          => ipcRenderer.invoke('fetch-cloud-playlist'),
 
  // ── NUEVO: Descargas pendientes desde la nube ──────────────────────
  // Lee BIN_PENDING y encola automáticamente al arrancar
  processPendingDownloads: ()     => ipcRenderer.invoke('process-pending-downloads'),
  // Notificación cuando una descarga pendiente termina o falla
  onPendingDownloadDone: (cb)     => {
    ipcRenderer.on('pending-download-done', (_e, data) => cb(data));
  },

  // ── NUEVO: Multi-pantalla / Proyección estilo OpenLP ───────────────
  getDisplays:        ()          => ipcRenderer.invoke('get-displays'),
  startProjection:    (displayId) => ipcRenderer.invoke('start-projection', displayId),
  stopProjection:     ()          => ipcRenderer.invoke('stop-projection'),
  toggleMainMaximize: ()          => ipcRenderer.invoke('toggle-main-maximize'),
  getMainMaximizeState: ()        => ipcRenderer.invoke('get-main-maximize-state'),
  onMainMaximizeChanged: (cb)     => {
    ipcRenderer.on('main-window-maximize-changed', (_e, maximized) => cb(maximized));
  },
  onDisplaysChanged:  (cb)        => {
    ipcRenderer.on('displays-changed', (_e, data) => cb(data));
  },
  onProjectorClosed:  (cb)        => {
    ipcRenderer.on('projector-closed', () => cb());
  },
  // Usado por la ventana principal para enviar comandos al proyector,
  // y por la propia ventana proyectora (projector.html) para recibirlos.
  sendProjectorSync:  (data)      => ipcRenderer.send('projector-sync', data),
  onProjectorSync:    (cb)        => {
    ipcRenderer.on('projector-sync', (_e, data) => cb(data));
  },
  getProjectorState:  ()          => ipcRenderer.invoke('get-projector-state'),
});