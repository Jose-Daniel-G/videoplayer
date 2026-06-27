let currentTab = 'video';
let listScope = 'all';
let searchQuery = '';

// Almacenes dinámicos (Exclusivos para Video)
let masterPlaylist = [];
let savedPlaylist = [];
let localVideos = [];

let currentIndex = -1;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;

const videoPlayer = document.getElementById('video-player');

// Al iniciar la aplicación de escritorio
window.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Cargar videos desde la carpeta configurada por el usuario
    if (window.electronAPI && typeof window.electronAPI.getLocalMedia === 'function') {
      const media = await window.electronAPI.getLocalMedia();
      localVideos = (media && Array.isArray(media.videos)) ? media.videos : [];

      // Mostrar ruta activa bajo el botón Cargar
      if (media && media.currentFolder) {
        const folderLabel = document.getElementById('folder-label');
        if (folderLabel) folderLabel.textContent = media.currentFolder;
      }
    }

    // 2. Cargar playlist persistente
    if (window.electronAPI && typeof window.electronAPI.loadPlaylistTxt === 'function') {
      const txtContent = await window.electronAPI.loadPlaylistTxt();
      if (txtContent && txtContent.startsWith("REMANENTE_PLAYLIST_EXPORT")) {
        const jsonStr = txtContent.substring(txtContent.indexOf("\n") + 1);
        savedPlaylist = JSON.parse(jsonStr);
      }
    }

    initDefaults();
    renderPlaylist();
  } catch (error) {
    console.error("Error inicializando la app desde renderer.js:", error);
    initDefaults();
    renderPlaylist();
  }
});

// Botón "Cargar" — el usuario elige la carpeta de videos
async function loadFolder() {
  if (!window.electronAPI || typeof window.electronAPI.selectVideosFolder !== 'function') return;
  const folder = await window.electronAPI.selectVideosFolder();
  if (!folder) return;

  const media = await window.electronAPI.getLocalMedia();
  localVideos = (media && Array.isArray(media.videos)) ? media.videos : [];

  const folderLabel = document.getElementById('folder-label');
  if (folderLabel) folderLabel.textContent = folder;

  initDefaults();
  renderPlaylist();
}

function initDefaults() {
  masterPlaylist = [...localVideos];
}

function getActivePlayer() {
  return videoPlayer;
}

function getActivePlaylist() {
  let baseList = (listScope === 'all') ? masterPlaylist : savedPlaylist;
  if (searchQuery.trim() !== '') {
    return baseList.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }
  return baseList;
}

/* ─── Cambio de Pestaña Principal (Forzado a Video) ─── */
function switchTab(tab) {
  currentTab = 'video'; // Forzar fijación en video
  currentIndex = -1;
  isPlaying = false;
  searchQuery = '';

  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  updatePlayPauseUI();

  const tabVideo = document.getElementById('tab-video');
  const screenVideo = document.getElementById('screen-video');
  const playlistLabel = document.getElementById('playlist-label');

  if (tabVideo) tabVideo.classList.add('active');
  if (screenVideo) screenVideo.classList.remove('hidden');
  if (playlistLabel) playlistLabel.textContent = 'Lista de Videos';

  const badge = document.getElementById('sermon-badge');
  if (badge) {
    badge.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> Predicación en Video';
  }

  if (videoPlayer) videoPlayer.pause();

  initDefaults();
  renderPlaylist();

  const trackTitle = document.getElementById('track-title');
  const trackAuthor = document.getElementById('track-author');
  const progressFill = document.getElementById('progress-fill');
  const timeCurrent = document.getElementById('time-current');
  const timeTotal = document.getElementById('time-total');

  if (trackTitle) trackTitle.textContent = 'Selecciona un archivo';
  if (trackAuthor) trackAuthor.textContent = '—';
  if (progressFill) progressFill.style.width = '0%';
  if (timeCurrent) timeCurrent.textContent = '0:00';
  if (timeTotal) timeTotal.textContent = '0:00';
}

function setListScope(scope) {
  listScope = scope;
  const btnAll = document.getElementById('btn-filter-all');
  const btnSaved = document.getElementById('btn-filter-saved');

  if (btnAll) btnAll.classList.toggle('active', scope === 'all');
  if (btnSaved) btnSaved.classList.toggle('active', scope === 'saved');
  currentIndex = -1;
  renderPlaylist();
}

function handleSearch(val) {
  searchQuery = val;
  renderPlaylist();
}

async function autoSaveSavedList() {
  if (window.electronAPI && typeof window.electronAPI.savePlaylistTxt === 'function') {
    let content = "REMANENTE_PLAYLIST_EXPORT\n";
    content += JSON.stringify(savedPlaylist, null, 2);
    await window.electronAPI.savePlaylistTxt(content);
  }
}

async function clearSavedList() {
  if (confirm("¿Estás seguro de que deseas limpiar la lista de guardados? Esto borrará el archivo de registro permanente.")) {
    savedPlaylist = [];
    await autoSaveSavedList();
    renderPlaylist();
  }
}

async function toggleSaveTrack(index, event) {
  event.stopPropagation();
  let currentDisplayList = getActivePlaylist();
  let selectedTrack = currentDisplayList[index];

  if (!selectedTrack) return;

  let existIndex = savedPlaylist.findIndex(item => item.name === selectedTrack.name);
  if (existIndex > -1) {
    savedPlaylist.splice(existIndex, 1);
  } else {
    savedPlaylist.push(selectedTrack);
  }

  await autoSaveSavedList();
  renderPlaylist();
}

/* ─── Pintar la Lista en Pantalla ─── */
function renderPlaylist() {
  const list = document.getElementById('playlist-list');
  const count = document.getElementById('playlist-count');
  if (!list) return;

  let currentDisplayList = getActivePlaylist();

  if (count) {
    count.textContent = currentDisplayList.length + (currentDisplayList.length === 1 ? ' video' : ' videos');
  }

  if (currentDisplayList.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <p>No se encontraron videos disponibles.<br>Verifica la carpeta de origen configurada en el sistema principal.</p>
    </div>`;
    return;
  }

  list.innerHTML = '';
  currentDisplayList.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'playlist-item' + (i === currentIndex ? ' active' : '');
    div.onclick = () => { loadTrack(i); };

    const icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(32,51,160,0.7)"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> `;

    let isInSaved = savedPlaylist.some(s => s.name === item.name);
    let saveIconColor = isInSaved ? 'var(--gold)' : 'currentColor';

    const dur = item.duration ? formatTime(item.duration) : '—';
    div.innerHTML = `
      <div class="item-num">
        <span class="idx-num">${i + 1}</span>
        <span class="playing-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="#C9A84C"><polygon points="5 3 19 12 5 21 5 3"/></svg></span>
      </div>
      <div class="item-thumb">${icon}</div>
      <div class="item-info">
        <strong title="${item.name}">${item.name}</strong>
        <span>${item.author || 'Predicación'}</span>
      </div>
      <span class="item-dur" style="margin-right: 0.5rem;">${dur}</span>
      <div class="action-icon" onclick="toggleSaveTrack(${i}, event)" title="Guardar/Remover de momentos">
         <svg width="15" height="15" viewBox="0 0 24 24" fill="${isInSaved ? 'var(--gold)' : 'none'}" stroke="${saveIconColor}" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      </div>
    `;
    list.appendChild(div);
  });
}

/* ─── Carga de Video Activo ─── */
function loadTrack(index) {
  let currentDisplayList = getActivePlaylist();
  if (index < 0 || index >= currentDisplayList.length) return;

  currentIndex = index;
  const item = currentDisplayList[index];
  const player = getActivePlayer();
  if (!player) return;

  player.pause();
  player.src = item.url;

  const volumeSlider = document.getElementById('volume-slider');
  if (volumeSlider) {
    player.volume = parseFloat(volumeSlider.value);
  }

  const trackTitle = document.getElementById('track-title');
  const trackAuthor = document.getElementById('track-author');
  if (trackTitle) trackTitle.textContent = item.name;
  if (trackAuthor) trackAuthor.textContent = item.author || 'Predicación';

  player.addEventListener('loadedmetadata', () => {
    const timeTotal = document.getElementById('time-total');
    if (timeTotal) timeTotal.textContent = formatTime(player.duration);
    item.duration = player.duration;
  }, { once: true });

  const listItems = document.querySelectorAll('.playlist-item');
  listItems.forEach((li, idx) => { li.classList.toggle('active', idx === currentIndex); });

  setTimeout(() => {
    player.play().catch(err => console.log("Reproducción automática prevenida:", err));
  }, 150);
}

function togglePlay() {
  const player = getActivePlayer();
  if (!player || !player.src) return;
  if (isPlaying) player.pause();
  else player.play().catch(() => { });
}

function forward10() {
  const player = getActivePlayer();
  if (player && player.src && player.duration) player.currentTime = Math.min(player.duration, player.currentTime + 10);
}

function rewind10() {
  const player = getActivePlayer();
  if (player && player.src) player.currentTime = Math.max(0, player.currentTime - 10);
}

if (videoPlayer) {
  videoPlayer.addEventListener('play', () => {
    isPlaying = true;
    updatePlayPauseUI();
    const overlay = document.getElementById('video-overlay');
    if (overlay) overlay.classList.add('playing');
  });

  videoPlayer.addEventListener('pause', () => {
    isPlaying = false;
    updatePlayPauseUI();
    const overlay = document.getElementById('video-overlay');
    if (overlay) overlay.classList.remove('playing');
  });

  videoPlayer.addEventListener('timeupdate', () => {
    if (!videoPlayer.duration) return;
    const pct = (videoPlayer.currentTime / videoPlayer.duration) * 100;
    const progressFill = document.getElementById('progress-fill');
    const timeCurrent = document.getElementById('time-current');

    if (progressFill) progressFill.style.width = pct + '%';
    if (timeCurrent) timeCurrent.textContent = formatTime(videoPlayer.currentTime);
  });

  videoPlayer.addEventListener('ended', () => {
    if (isRepeat) {
      videoPlayer.currentTime = 0;
      videoPlayer.play().catch(() => { });
    } else {
      nextTrack();
    }
  });
}

function updatePlayPauseUI() {
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');
  if (iconPlay) iconPlay.classList.toggle('hidden', isPlaying);
  if (iconPause) iconPause.classList.toggle('hidden', !isPlaying);
}

function seekTo(e) {
  const player = getActivePlayer();
  if (!player || !player.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  player.currentTime = pct * player.duration;

  // ─── CONTROL DE ARRASTRE DE LA BARRA DE PROGRESO ───

  const videoPlayer = document.getElementById('video-player');
  const progressBg = document.getElementById('video-progress-bg');
  const progressFill = document.getElementById('video-progress-fill');

  let isDraggingProgress = false;

  // 1. Función base para calcular la posición y aplicar el tiempo al video
  function setProgressPosition(event) {
    if (!videoPlayer || !progressBg || videoPlayer.duration === 0) return;

    // Obtener las dimensiones y posición de la barra de fondo
    const rect = progressBg.getBoundingClientRect();

    // Calcular la posición X del mouse relativa a la barra
    let x = event.clientX - rect.left;

    // Limitar que el valor no se salga de los bordes (0% a 100%)
    if (x < 0) x = 0;
    if (x > rect.width) x = rect.width;

    // Calcular el porcentaje e inyectarlo al reproductor
    const percentage = x / rect.width;
    videoPlayer.currentTime = percentage * videoPlayer.duration;

    // Actualizar visualmente el relleno de la barra de forma inmediata
    if (progressFill) {
      progressFill.style.width = (percentage * 100) + '%';
    }
  }

  // 2. Evento al hacer CLIC directo o iniciar el arrastre (MouseDown)
  if (progressBg) {
    progressBg.addEventListener('mousedown', (e) => {
      isDraggingProgress = true;
      setProgressPosition(e); // Actualiza la posición al hacer clic inicial
    });
  }

  // 3. Evento mientras se ARRASTRA el mouse por la pantalla (MouseMove)
  window.addEventListener('mousemove', (e) => {
    if (isDraggingProgress) {
      setProgressPosition(e);
    }
  });

  // 4. Evento al SOLTAR el botón del mouse (MouseUp)
  window.addEventListener('mouseup', () => {
    if (isDraggingProgress) {
      isDraggingProgress = false;
    }
  });
}

function prevTrack() {
  let currentDisplayList = getActivePlaylist();
  if (currentDisplayList.length === 0) return;
  let newIdx = currentIndex > 0 ? currentIndex - 1 : currentDisplayList.length - 1;
  loadTrack(newIdx);
}

function nextTrack() {
  let currentDisplayList = getActivePlaylist();
  if (currentDisplayList.length === 0) return;
  let newIdx;
  if (isShuffle) {
    newIdx = Math.floor(Math.random() * currentDisplayList.length);
  } else {
    newIdx = (currentIndex + 1) % currentDisplayList.length;
  }
  loadTrack(newIdx);
}

function toggleShuffle() {
  isShuffle = !isShuffle;
  const btnShuffle = document.getElementById('btn-shuffle');
  if (btnShuffle) btnShuffle.classList.toggle('active', isShuffle);
}

function toggleRepeat() {
  isRepeat = !isRepeat;
  const btnRepeat = document.getElementById('btn-repeat');
  if (btnRepeat) btnRepeat.classList.toggle('active', isRepeat);
}

function setVolume(val) {
  if (videoPlayer) videoPlayer.volume = val;
}

function toggleFullscreen() {
  const wrapper = document.getElementById('screen-video');
  if (!wrapper) return;
  if (!document.fullscreenElement) wrapper.requestFullscreen().catch(() => { });
  else document.exitFullscreen();
}

document.addEventListener('fullscreenchange', () => {
  const inFs = !!document.fullscreenElement;
  const expand = document.getElementById('icon-fs-expand');
  const shrink = document.getElementById('icon-fs-shrink');
  if (expand) expand.classList.toggle('hidden', inFs);
  if (shrink) shrink.classList.toggle('hidden', !inFs);
});

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

// ─── FUNCIÓN PARA DESCARGAR DESDE YOUTUBE ───
async function actionDownloadYoutube() {
  const inputUrl = document.getElementById('youtube-url-input');
  const statusDiv = document.getElementById('download-status');
  const btnDownload = document.getElementById('btn-download-yt');

  const url = inputUrl.value.trim();

  if (!url) {
    showDownloadStatus("Por favor, introduce un enlace de YouTube válido.", "error");
    return;
  }

  // Cambiar estado de la interfaz a "Cargando"
  btnDownload.disabled = true;
  showDownloadStatus("Obteniendo video e integrando a la lista... Por favor espera.", "loading");

  try {
    // Enviar la URL al proceso Main de Electron para que maneje la descarga con yt-dlp
    const result = await window.electronAPI.downloadYoutube(url);

    if (result.success) {
      showDownloadStatus("¡Video descargado e indexado con éxito!", "success");
      inputUrl.value = "";

      // Recargar videos locales y actualizar ambos paneles
      const media = await window.electronAPI.getLocalMedia();
      localVideos = (media && Array.isArray(media.videos)) ? media.videos : [];
      initDefaults();
      renderPlaylist();
      updateDownloadedLocalList();
      await refreshRecentPanel();

    } else {
      showDownloadStatus("Error al descargar: " + result.error, "error");
    }
  } catch (error) {
    console.error("Error en el proceso de descarga:", error);
    showDownloadStatus("Error de comunicación con el sistema.", "error");
  } finally {
    btnDownload.disabled = false;
  }
}

// Función auxiliar para mostrar los mensajes de estado estéticos
function showDownloadStatus(message, type) {
  const statusDiv = document.getElementById('download-status');
  statusDiv.style.display = 'block';
  statusDiv.textContent = message;

  // Limpiar clases anteriores
  statusDiv.className = "download-status " + type;

  // Ocultar automáticamente si fue un éxito o error ordinario después de 5 segundos
  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 5000);
  }
}
/* ─── Tab switch ─── */
// ─── 1. FUNCIÓN PARA CONTROLAR EL CAMBIO DE PESTAÑAS (TABS) ───
function switchMainTab(tab) {
  document.getElementById('tab-video').classList.toggle('active', tab === 'video');
  document.getElementById('tab-download').classList.toggle('active', tab === 'download');

  document.getElementById('screen-video').classList.toggle('hidden', tab !== 'video');
  document.getElementById('screen-download').classList.toggle('hidden', tab !== 'download');

  const playlistCard = document.querySelector('.playlist-card');

  if (tab === 'download') {
    if (playlistCard) playlistCard.style.display = 'none';
    showRecentDownloadsPanel();
    updateDownloadedLocalList();
  } else {
    if (playlistCard) playlistCard.style.display = '';
    const recentPanel = document.getElementById('recent-downloads-panel');
    if (recentPanel) recentPanel.remove();
    document.getElementById('playlist-label').textContent = 'Lista de Videos';
  }
}

// ─── PANEL DERECHO DE DESCARGAS RECIENTES ───
async function showRecentDownloadsPanel() {
  // Evitar duplicados
  if (document.getElementById('recent-downloads-panel')) return;

  const mainLayout = document.querySelector('.main-layout');
  if (!mainLayout) return;

  const panel = document.createElement('div');
  panel.id = 'recent-downloads-panel';
  panel.className = 'playlist-card'; // mismos estilos que la playlist normal
  panel.innerHTML = `
    <div class="playlist-header">
      <h2>Descargas Recientes</h2>
      <span class="playlist-count" id="recent-count">— videos</span>
    </div>
    <div class="playlist-list" id="recent-list">
      <p style="font-size:0.72rem;color:var(--pearl-muted);padding:12px;">Cargando...</p>
    </div>
  `;
  mainLayout.appendChild(panel);

  await refreshRecentPanel();
}

async function refreshRecentPanel() {
  const listEl = document.getElementById('recent-list');
  const countEl = document.getElementById('recent-count');
  if (!listEl) return;

  try {
    const data = await window.electronAPI.getLocalMedia();
    const allVideos = (data && Array.isArray(data.videos)) ? data.videos : [];

    // Filtrar solo los de hoy
    const todayStr = new Date().toDateString();
    const videos = allVideos.filter(v => {
      if (!v.addedAt) return false;
      return new Date(v.addedAt).toDateString() === todayStr;
    });

    if (countEl) countEl.textContent = videos.length + (videos.length === 1 ? ' video hoy' : ' videos hoy');

    if (videos.length === 0) {
      listEl.innerHTML = `<div class="empty-state"><p>No hay videos descargados hoy.</p></div>`;
      return;
    }

    listEl.innerHTML = '';
    [...videos]
      .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))
      .forEach((video, i) => {
        const hora = new Date(video.addedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        const div = document.createElement('div');
        div.className = 'playlist-item';
        div.style.cursor = 'default';
        div.innerHTML = `
          <div class="item-num"><span class="idx-num">${i + 1}</span></div>
          <div class="item-thumb">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(32,51,160,0.8)">
              <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
          </div>
          <div class="item-info">
            <strong title="${video.name}">${video.name}</strong>
            <span style="font-size:0.65rem;color:var(--pearl-muted);">Hoy · ${hora}</span>
          </div>
        `;
        listEl.appendChild(div);
      });
  } catch (err) {
    console.error('Error cargando descargas recientes:', err);
    listEl.innerHTML = `<p style="font-size:0.72rem;color:#f87171;padding:12px;">Error al leer la carpeta.</p>`;
  }
}

// ─── 2. EXTRAER MINIATURA DE YOUTUBE EN VIVO CUANDO EL USUARIO PEGA LA URL ───
function handleYoutubeUrlInput(url) {
  const previewContainer = document.getElementById('yt-preview-container');
  const previewImg = document.getElementById('yt-preview-img');
  const previewTitle = document.getElementById('yt-preview-title');

  // Expresión regular para capturar la ID del video de YouTube de cualquier enlace común
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);

  if (match && match[2].length === 11) {
    const videoId = match[2];
    // Usamos el servidor de imágenes oficial de YouTube de alta definición (hqdefault)
    previewImg.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    previewTitle.textContent = "Video Listo para Descargar 🎥";
    previewContainer.style.display = 'block'; // Mostrar la caja
  } else {
    // Si borra el input o es inválido, ocultamos la miniatura
    previewContainer.style.display = 'none';
  }
}

// ─── 4. ACTUALIZAR LOS VIDEOS RECIÉN DESCARGADOS EN LA CARPETA LOCAL ───
async function updateDownloadedLocalList() {
  const listContainer = document.getElementById('downloaded-local-list');
  if (!listContainer) return;

  try {
    // Llamamos al canal IPC nativo de tu main.js que lee el directorio
    const data = await window.electronAPI.getLocalMedia();

    if (data && data.videos && data.videos.length > 0) {
      listContainer.innerHTML = ""; // Limpiar indicador de carga

      // Listamos los últimos videos encontrados en la carpeta local
      data.videos.forEach(video => {
        const item = document.createElement('div');
        item.className = "local-download-item";
        item.title = video.name;
        item.innerHTML = `📄 ${video.name}`;
        listContainer.appendChild(item);
      });
    } else {
      listContainer.innerHTML = `<p style="font-size:0.68rem; color:var(--pearl-muted);">No se encontraron videos descargados aún.</p>`;
    }
  } catch (error) {
    console.error("Error cargando videos locales:", error);
    listContainer.innerHTML = `<p style="font-size:0.68rem; color:#f87171;">No se pudo leer la carpeta local.</p>`;
  }
}

// Función auxiliar estética de alertas de estado
function showDownloadStatus(message, type) {
  const statusDiv = document.getElementById('download-status');
  statusDiv.style.display = 'block';
  statusDiv.textContent = message;
  statusDiv.className = "download-status " + type;

  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 6000);
  }
}