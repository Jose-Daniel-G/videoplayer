/* ═══════════════════════════════════════════════════════════════
   renderer.js — Remanente Desktop
   Mejoras: progreso real · cola · thumbnails · renombrar ·
            badge "Reproduciendo" · atajos · persistir estado ·
            sincronización playlist domingo → Guardados ·
            descargas pendientes desde la nube
   ═══════════════════════════════════════════════════════════════ */

// ─── Estado global ───
let listScope = 'all';
let searchQuery = '';
let masterPlaylist = [];
let savedPlaylist = [];
let localVideos = [];
let currentIndex = -1;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;

// Cola visual de descargas: Map<jobId, { status, percent, ... }>
const downloadJobs = new Map();

const videoPlayer = document.getElementById('video-player');

/* ═══════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  try {
    // ── 1. Cargar videos de la carpeta local ──────────────────────────
    await reloadLocalVideos();
    masterPlaylist = [...localVideos];

    // ── 2. Cargar lista guardada (marcadores ★) del archivo local ─────
    if (window.electronAPI?.loadPlaylistTxt) {
      const txt = await window.electronAPI.loadPlaylistTxt();
      if (txt?.startsWith('REMANENTE_PLAYLIST_EXPORT')) {
        try {
          savedPlaylist = JSON.parse(txt.substring(txt.indexOf('\n') + 1));
        } catch (parseErr) {
          console.warn('No se pudo parsear la lista guardada:', parseErr);
          savedPlaylist = [];
        }
      }
    }

    // ── 3. Sincronizar playlist del domingo desde la nube → Guardados ─
    await syncCloudPlaylistToSaved();

    // ── 4. Restaurar volumen + último video + posición ─────────────────
    if (window.electronAPI?.loadPlayerState) {
      const state = await window.electronAPI.loadPlayerState();

      if (state.volume !== undefined) {
        videoPlayer.volume = state.volume;
        const slider = document.getElementById('volume-slider');
        if (slider) slider.value = state.volume;
      }

      if (state.lastVideo) {
        let idx = masterPlaylist.findIndex(v => v.url === state.lastVideo);
        if (idx === -1) {
          const lastName = state.lastVideo.split(/[/\\]/).pop();
          idx = masterPlaylist.findIndex(v => v.url.split(/[/\\]/).pop() === lastName);
        }

        if (idx > -1) {
          loadTrack(idx, false);
          const posToRestore = state.lastPosition > 2 ? state.lastPosition : 0;
          if (posToRestore > 0) {
            videoPlayer.addEventListener('loadedmetadata', () => {
              videoPlayer.currentTime = posToRestore;
            }, { once: true });
          }
        }
      }
    }

    // ── 5. Escuchar progreso de descargas desde main ───────────────────
    window.electronAPI?.onDownloadProgress(handleDownloadProgress);

    // ── 6. Escuchar cuando una descarga pendiente termina ─────────────
    window.electronAPI?.onPendingDownloadDone(async () => {
      await reloadLocalVideos();
      masterPlaylist = [...localVideos];
      await syncCloudPlaylistToSaved();
      renderPlaylist();
    });

    // ── 7. Procesar descargas pendientes desde la nube ─────────────────
    (async () => {
      try {
        const result = await window.electronAPI.processPendingDownloads();
        if (result?.enqueued > 0) {
          showToast(`⬇️ ${result.enqueued} descarga(s) pendiente(s) iniciada(s) automáticamente`, 'info');
        }
      } catch (e) {
        console.warn('No se pudieron procesar descargas pendientes:', e.message);
      }
    })();

    // ── 8. Sincronizar carpeta con la nube (sin bloquear la UI) ────────
    (async () => {
      try {
        const media = await window.electronAPI.getLocalMedia();
        const rutaActual = media?.currentFolder ?? null;
        if (!rutaActual) return;

        const response = await window.electronAPI.getFolderJson(rutaActual);
        if (!response.success) { console.warn('getFolderJson falló:', response.error); return; }

        const cloudResponse = await window.electronAPI.uploadToCloud(response.data);
        if (cloudResponse.success) {
          console.log('%c Lista sincronizada en la nube ✓', 'color:#00ff00;font-weight:bold');
        } else {
          console.warn('Error al subir a la nube:', cloudResponse.error);
        }
      } catch (cloudErr) {
        console.warn('Sincronización con la nube falló (modo offline?):', cloudErr.message);
      }
    })();

  } catch (e) {
    console.error('Error al inicializar:', e);
  }

  renderPlaylist();
  initKeyboardShortcuts();
});

/* ═══════════════════════════════════════════
   SINCRONIZACIÓN PLAYLIST DOMINGO → GUARDADOS
   ═══════════════════════════════════════════ */
/**
 * Descarga la playlist del domingo desde la nube y añade a savedPlaylist
 * aquellos videos que ya existen en la carpeta local.
 * Videos que no existen todavía (pendientes de descargar) se ignoran aquí
 * porque se añadirán solos cuando la descarga termine.
 */
async function syncCloudPlaylistToSaved() {
  if (!window.electronAPI?.fetchCloudPlaylist) return;

  try {
    const result = await window.electronAPI.fetchCloudPlaylist();

    // Si la nube devuelve una playlist vacía la ignoramos para no borrar
    // lo que el usuario tenía guardado localmente.
    if (!result.success || !result.playlist.length) return;

    const cloudFilenames = result.playlist; // array de filenames, ej: ["cancion.mp4", ...]

    // Reconstruir savedPlaylist RESPETANDO el orden exacto de la nube.
    // Solo incluimos los videos que ya existen en la carpeta local.
    const nuevaPlaylist = [];
    for (const filename of cloudFilenames) {
      const localVideo = localVideos.find(v => {
        const nameWithExt = v.name + getExtension(v.url);
        return nameWithExt === filename || v.name === filename || filename.startsWith(v.name);
      });
      if (localVideo) nuevaPlaylist.push(localVideo);
    }

    // Solo actualizar si la playlist de la nube difiere de la local
    // (comparamos por nombres para detectar cambios de orden o contenido)
    const localNames = savedPlaylist.map(v => v.name).join('|');
    const cloudNames = nuevaPlaylist.map(v => v.name).join('|');

    if (localNames !== cloudNames) {
      savedPlaylist = nuevaPlaylist;
      await persistSavedList();
      renderPlaylist();
      console.log('[sync] Playlist del domingo actualizada desde la nube ✓', nuevaPlaylist.map(v => v.name));
    }
  } catch (e) {
    console.warn('[syncCloudPlaylistToSaved] error:', e.message);
  }
}

function getExtension(url) {
  try { return '.' + url.split('.').pop().split('?')[0]; } catch { return ''; }
}

/* ═══════════════════════════════════════════
   HELPERS DE DATOS
   ═══════════════════════════════════════════ */
async function reloadLocalVideos() {
  if (!window.electronAPI?.getLocalMedia) return;
  const media = await window.electronAPI.getLocalMedia();
  localVideos = media?.videos ?? [];

  const folderLabel = document.getElementById('folder-label');
  if (folderLabel && media?.currentFolder) folderLabel.textContent = media.currentFolder;
}

function getActivePlaylist() {
  const base = listScope === 'all' ? masterPlaylist : savedPlaylist;
  const q = searchQuery.trim().toLowerCase();
  return q ? base.filter(v => v.name.toLowerCase().includes(q)) : base;
}

async function persistSavedList() {
  if (!window.electronAPI?.savePlaylistTxt) return;
  await window.electronAPI.savePlaylistTxt(
    'REMANENTE_PLAYLIST_EXPORT\n' + JSON.stringify(savedPlaylist, null, 2)
  );
  // Sincronizar también con BIN_PLAYLIST para que la app web lo refleje
  await pushCloudPlaylist();
}

/**
 * Sube savedPlaylist a BIN_PLAYLIST en el mismo formato que usa la app web:
 * array de filenames, ej: ["cancion.mp4", "predicacion.mp4"]
 */
async function pushCloudPlaylist() {
  try {
    const filenames = savedPlaylist.map(v => {
      const ext = getExtension(v.url); // ".mp4", ".mkv", etc.
      return v.name + ext;
    });
    await window.electronAPI.uploadPlaylist(filenames);
    console.log('[cloud] Playlist del domingo subida ✓', filenames);
  } catch (e) {
    console.warn('[cloud] No se pudo subir la playlist:', e.message);
  }
}

/* ═══════════════════════════════════════════
   PERSISTIR ESTADO DEL REPRODUCTOR
   ═══════════════════════════════════════════ */
function savePlayerState() {
  if (!window.electronAPI?.savePlayerState) return;
  window.electronAPI.savePlayerState({
    volume: videoPlayer.volume,
    lastVideo: videoPlayer.src || null,
    lastPosition: videoPlayer.currentTime || 0
  });
}

setInterval(savePlayerState, 5000);
window.addEventListener('beforeunload', savePlayerState);

/* ═══════════════════════════════════════════
   TABS
   ═══════════════════════════════════════════ */
function switchMainTab(tab) {
  const isDownload = tab === 'download';

  document.getElementById('tab-video').classList.toggle('active', !isDownload);
  document.getElementById('tab-download').classList.toggle('active', isDownload);
  document.getElementById('screen-video').classList.toggle('hidden', isDownload);
  document.getElementById('screen-download').classList.toggle('hidden', !isDownload);

  const playlistCard = document.querySelector('.playlist-card');
  if (playlistCard) playlistCard.style.display = isDownload ? 'none' : '';

  if (isDownload) {
    showRecentDownloadsPanel();
    updateDownloadedLocalList();
  } else {
    document.getElementById('recent-downloads-panel')?.remove();
  }
}

/* ═══════════════════════════════════════════
   FILTROS Y BUSQUEDA
   ═══════════════════════════════════════════ */
function setListScope(scope) {
  listScope = scope;
  document.getElementById('btn-filter-all').classList.toggle('active', scope === 'all');
  document.getElementById('btn-filter-saved').classList.toggle('active', scope === 'saved');
  currentIndex = -1;
  renderPlaylist();
}

function handleSearch(val) {
  searchQuery = val;
  renderPlaylist();
}

/* ═══════════════════════════════════════════
   LISTA GUARDADA
   ═══════════════════════════════════════════ */
async function clearSavedList() {
  if (!confirm('Borrar la lista guardada permanentemente?')) return;
  savedPlaylist = [];
  await persistSavedList();
  renderPlaylist();
}

async function toggleSaveTrack(index, event) {
  event.stopPropagation();
  const track = getActivePlaylist()[index];
  if (!track) return;

  const i = savedPlaylist.findIndex(s => s.name === track.name);
  if (i > -1) savedPlaylist.splice(i, 1);
  else savedPlaylist.push(track);

  await persistSavedList();
  renderPlaylist();
}

/* ═══════════════════════════════════════════
   RENOMBRAR VIDEO (doble clic)
   ═══════════════════════════════════════════ */
async function startRename(index, event) {
  event.stopPropagation();
  const items = getActivePlaylist();
  const track = items[index];
  if (!track) return;

  const listEl = document.getElementById('playlist-list');
  const itemEls = listEl.querySelectorAll('.playlist-item');
  const itemEl = itemEls[index];
  if (!itemEl) return;

  const strongEl = itemEl.querySelector('.item-info strong');
  if (!strongEl) return;

  const originalName = track.name;
  strongEl.contentEditable = 'true';
  strongEl.classList.add('renaming');
  strongEl.focus();

  const range = document.createRange();
  range.selectNodeContents(strongEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  async function commitRename() {
    strongEl.contentEditable = 'false';
    strongEl.classList.remove('renaming');
    const newName = strongEl.textContent.trim();

    if (!newName || newName === originalName) {
      strongEl.textContent = originalName;
      return;
    }

    const result = await window.electronAPI.renameVideo({ oldUrl: track.url, newName });
    if (result.success) {
      const oldUrl = track.url;
      track.name = newName;
      track.url = result.newUrl;

      const li = localVideos.find(v => v.url === oldUrl);
      if (li) { li.name = newName; li.url = result.newUrl; }

      masterPlaylist = [...localVideos];
      renderPlaylist();
    } else {
      alert('No se pudo renombrar: ' + result.error);
      strongEl.textContent = originalName;
    }
  }

  strongEl.addEventListener('blur', commitRename, { once: true });
  strongEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); strongEl.blur(); }
    if (e.key === 'Escape') { strongEl.textContent = originalName; strongEl.blur(); }
  });
}

/* ═══════════════════════════════════════════
   RENDER PLAYLIST
   ═══════════════════════════════════════════ */
function renderPlaylist() {
  const list = document.getElementById('playlist-list');
  const count = document.getElementById('playlist-count');
  if (!list) return;

  const items = getActivePlaylist();
  if (count) count.textContent = `${items.length} ${items.length === 1 ? 'video' : 'videos'}`;

  if (!items.length) {
    list.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <p>No se encontraron videos. Verifica la carpeta configurada.</p>
    </div>`;
    return;
  }

  const defaultThumb = `<svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(32,51,160,0.7)">
    <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
  </svg>`;

  list.innerHTML = '';
  items.forEach((item, i) => {
    const saved = savedPlaylist.some(s => s.name === item.name);
    const dur = item.duration ? formatTime(item.duration) : '';
    const thumbHtml = item.thumbUrl
      ? `<img src="${item.thumbUrl}" style="width:40px;height:28px;object-fit:cover;border-radius:3px;" onerror="this.style.display='none'">`
      : defaultThumb;

    const div = document.createElement('div');
    div.className = 'playlist-item' + (i === currentIndex ? ' active' : '');
    div.onclick = () => loadTrack(i);
    div.ondblclick = (e) => startRename(i, e);
    div.title = 'Clic: reproducir  |  Doble clic: renombrar';

    div.innerHTML = `
      <div class="item-num">
        <span class="idx-num">${i + 1}</span>
        <span class="playing-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="#C9A84C"><polygon points="5 3 19 12 5 21 5 3"/></svg></span>
      </div>
      <div class="item-thumb">${thumbHtml}</div>
      <div class="item-info">
        <strong title="${item.name}">${item.name}</strong>
        <span>${item.author || 'Predicacion'}</span>
      </div>
      <span class="item-dur" style="margin-right:.5rem">${dur}</span>
      <div class="action-icon" onclick="toggleSaveTrack(${i},event)" title="Guardar/Remover">
        <svg width="15" height="15" viewBox="0 0 24 24"
          fill="${saved ? 'var(--gold)' : 'none'}"
          stroke="${saved ? 'var(--gold)' : 'currentColor'}"
          stroke-width="2">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
      </div>`;
    list.appendChild(div);
  });

  if (currentIndex >= 0) {
    setTimeout(() => {
      const activeEl = list.querySelector('.playlist-item.active');
      if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }
}

/* ═══════════════════════════════════════════
   REPRODUCCION
   ═══════════════════════════════════════════ */
function loadTrack(index, autoplay = true) {
  const items = getActivePlaylist();
  if (index < 0 || index >= items.length) return;

  currentIndex = index;
  const item = items[index];

  videoPlayer.pause();
  videoPlayer.src = item.url;
  videoPlayer.volume = parseFloat(document.getElementById('volume-slider')?.value ?? 0.85);

  updateHeaderBadge(item.name);

  const titleEl = document.getElementById('track-title-vid');
  if (titleEl) titleEl.textContent = item.name;

  videoPlayer.addEventListener('loadedmetadata', () => {
    const el = document.getElementById('video-time-current');
    if (el) el.textContent = `0:00 / ${formatTime(videoPlayer.duration)}`;
    item.duration = videoPlayer.duration;
    renderPlaylist();
  }, { once: true });

  document.querySelectorAll('.playlist-item')
    .forEach((li, i) => li.classList.toggle('active', i === currentIndex));

  if (autoplay) setTimeout(() => videoPlayer.play().catch(() => { }), 150);

  savePlayerState();
}

function togglePlay() {
  if (!videoPlayer?.src) return;
  isPlaying ? videoPlayer.pause() : videoPlayer.play().catch(() => { });
}

function prevTrack() {
  const len = getActivePlaylist().length;
  if (!len) return;
  loadTrack(currentIndex > 0 ? currentIndex - 1 : len - 1);
}

function nextTrack() {
  const len = getActivePlaylist().length;
  if (!len) return;
  const next = isShuffle
    ? Math.floor(Math.random() * len)
    : (currentIndex + 1) % len;
  loadTrack(next);
}

function forward10() {
  if (videoPlayer?.duration) videoPlayer.currentTime = Math.min(videoPlayer.duration, videoPlayer.currentTime + 10);
}

function rewind10() {
  if (videoPlayer) videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 10);
}

function setVolume(val) { if (videoPlayer) videoPlayer.volume = val; }
function toggleMute() { if (videoPlayer) { videoPlayer.muted = !videoPlayer.muted; updateMuteUI(); } }
function toggleShuffle() { isShuffle = !isShuffle; document.getElementById('btn-shuffle')?.classList.toggle('active', isShuffle); }
function toggleRepeat() { isRepeat = !isRepeat; document.getElementById('btn-repeat')?.classList.toggle('active', isRepeat); }

function toggleFullscreen() {
  const wrapper = document.getElementById('screen-video');
  if (!wrapper) return;
  document.fullscreenElement ? document.exitFullscreen() : wrapper.requestFullscreen().catch(() => { });
}

/* ═══════════════════════════════════════════
   BADGE "REPRODUCIENDO AHORA"
   ═══════════════════════════════════════════ */
function updateHeaderBadge(name) {
  const dot = document.querySelector('#header-badge .dot');
  const text = document.getElementById('header-badge-text');
  if (!text) return;

  if (name) {
    text.textContent = name.length > 38 ? name.substring(0, 38) + '...' : name;
    if (dot) dot.style.background = '#4ade80';
  } else {
    text.textContent = 'En espera';
    if (dot) dot.style.background = '';
  }
}

/* ═══════════════════════════════════════════
   EVENTOS DEL PLAYER
   ═══════════════════════════════════════════ */
if (videoPlayer) {
  videoPlayer.addEventListener('play', () => {
    isPlaying = true;
    updatePlayPauseUI();
    const name = getActivePlaylist()[currentIndex]?.name;
    if (name) updateHeaderBadge(name);
  });

  videoPlayer.addEventListener('pause', () => {
    isPlaying = false;
    updatePlayPauseUI();
  });

  videoPlayer.addEventListener('ended', () => {
    if (isRepeat) { videoPlayer.currentTime = 0; videoPlayer.play().catch(() => { }); }
    else nextTrack();
  });

  videoPlayer.addEventListener('timeupdate', () => {
    if (!videoPlayer.duration) return;
    const pct = (videoPlayer.currentTime / videoPlayer.duration) * 100;
    const fill = document.getElementById('video-progress-fill');
    const time = document.getElementById('video-time-current');
    if (fill) fill.style.width = pct + '%';
    if (time) time.textContent = `${formatTime(videoPlayer.currentTime)} / ${formatTime(videoPlayer.duration)}`;
  });
}

/* ═══════════════════════════════════════════
   UI HELPERS
   ═══════════════════════════════════════════ */
function updatePlayPauseUI() {
  document.getElementById('vid-icon-play')?.classList.toggle('hidden', isPlaying);
  document.getElementById('vid-icon-pause')?.classList.toggle('hidden', !isPlaying);
}

function updateMuteUI() {
  const muted = videoPlayer?.muted;
  document.getElementById('icon-volume')?.classList.toggle('hidden', muted);
  document.getElementById('icon-mute')?.classList.toggle('hidden', !muted);
}

document.addEventListener('fullscreenchange', () => {
  const inFs = !!document.fullscreenElement;
  document.getElementById('icon-fs-expand')?.classList.toggle('hidden', inFs);
  document.getElementById('icon-fs-shrink')?.classList.toggle('hidden', !inFs);
});

/* ═══════════════════════════════════════════
   BARRA DE PROGRESO (drag)
   ═══════════════════════════════════════════ */
(function initProgressDrag() {
  const bar = document.getElementById('video-progress-bg');
  const fill = document.getElementById('video-progress-fill');
  let dragging = false;

  function seek(e) {
    if (!videoPlayer?.duration || !bar) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    videoPlayer.currentTime = pct * videoPlayer.duration;
    if (fill) fill.style.width = (pct * 100) + '%';
  }

  bar?.addEventListener('mousedown', e => { dragging = true; seek(e); });
  window.addEventListener('mousemove', e => { if (dragging) seek(e); });
  window.addEventListener('mouseup', () => { dragging = false; });
})();

function seekTo(e) {
  if (!videoPlayer?.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  videoPlayer.currentTime = ((e.clientX - rect.left) / rect.width) * videoPlayer.duration;
}

/* ═══════════════════════════════════════════
   ATAJOS DE TECLADO
   ═══════════════════════════════════════════ */
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA'].includes(tag)) return;
    if (document.activeElement?.contentEditable === 'true') return;

    switch (e.key) {
      case ' ':
        e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft':
        e.preventDefault(); rewind10(); break;
      case 'ArrowRight':
        e.preventDefault(); forward10(); break;
      case 'ArrowUp':
        e.preventDefault();
        if (videoPlayer) {
          videoPlayer.volume = Math.min(1, videoPlayer.volume + 0.05);
          const s = document.getElementById('volume-slider');
          if (s) s.value = videoPlayer.volume;
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (videoPlayer) {
          videoPlayer.volume = Math.max(0, videoPlayer.volume - 0.05);
          const s = document.getElementById('volume-slider');
          if (s) s.value = videoPlayer.volume;
        }
        break;
      case 'n': case 'N': nextTrack(); break;
      case 'p': case 'P': prevTrack(); break;
      case 'm': case 'M': toggleMute(); break;
    }
  });
}

/* ═══════════════════════════════════════════
   COLA DE DESCARGAS — PROGRESO REAL
   ═══════════════════════════════════════════ */
function handleDownloadProgress(data) {
  const { jobId, status, percent, speed, eta, size, error, thumbUrl, isPending } = data;

  if (!downloadJobs.has(jobId)) downloadJobs.set(jobId, { isPending });
  Object.assign(downloadJobs.get(jobId), { status, percent, speed, eta, size, error, thumbUrl });

  renderDownloadQueue();

  if (status === 'done') {
    setTimeout(async () => {
      downloadJobs.delete(jobId);
      renderDownloadQueue();
      await reloadLocalVideos();
      masterPlaylist = [...localVideos];
      renderPlaylist();
      updateDownloadedLocalList();
      await refreshRecentPanel();
    }, 3000);
  }

  if (status === 'done' || status === 'error') {
    const btn = document.getElementById('btn-download-yt');
    if (btn) btn.disabled = false;
    if (status === 'done') showDownloadStatus('Video descargado con exito', 'success');
    if (status === 'error') showDownloadStatus('Error: ' + (error ?? ''), 'error');
  }
}

function renderDownloadQueue() {
  const container = document.getElementById('download-queue-container');
  if (!container) return;

  if (downloadJobs.size === 0) { container.innerHTML = ''; return; }

  container.innerHTML = '';
  downloadJobs.forEach((job, jobId) => {
    const div = document.createElement('div');
    div.className = 'dq-item';

    // Badge extra si viene de la cola pendiente (nube)
    const pendingBadge = job.isPending
      ? `<span class="dq-pending-badge">☁️ Pendiente nube</span>`
      : '';

    if (job.status === 'starting') {
      div.innerHTML = `${pendingBadge}<span class="dq-label">Iniciando descarga...</span>`;
    } else if (job.status === 'progress') {
      const pct = job.percent ?? 0;
      div.innerHTML = `
        ${pendingBadge}
        <div class="dq-info">
          <span class="dq-label">${pct.toFixed(1)}%&nbsp;&nbsp;${job.speed ?? ''}&nbsp;&nbsp;ETA ${job.eta ?? ''}</span>
          <span class="dq-size">${job.size ?? ''}</span>
        </div>
        <div class="dq-bar-bg">
          <div class="dq-bar-fill" style="width:${pct}%"></div>
        </div>`;
    } else if (job.status === 'done') {
      div.innerHTML = `${pendingBadge}<span class="dq-label dq-done">Descarga completada ✓</span>`;
    } else if (job.status === 'error') {
      div.innerHTML = `${pendingBadge}<span class="dq-label dq-error">Error: ${job.error ?? ''}</span>`;
    }

    container.appendChild(div);
  });
}

/* ═══════════════════════════════════════════
   DESCARGA YOUTUBE (manual)
   ═══════════════════════════════════════════ */
async function actionDownloadYoutube() {
  const input = document.getElementById('youtube-url-input');
  const btnDl = document.getElementById('btn-download-yt');
  const url = input.value.trim();

  if (!url) { showDownloadStatus('Introduce un enlace de YouTube valido.', 'error'); return; }

  btnDl.disabled = true;

  try {
    const result = await window.electronAPI.downloadYoutube(url);
    if (result.success) {
      input.value = '';
      showDownloadStatus(`En cola — el progreso aparecera abajo`, 'loading');
    } else {
      showDownloadStatus('Error: ' + result.error, 'error');
      btnDl.disabled = false;
    }
  } catch (e) {
    showDownloadStatus('Error de comunicacion.', 'error');
    btnDl.disabled = false;
  }

  setTimeout(() => { btnDl.disabled = false; }, 1000);
}

function showDownloadStatus(msg, type) {
  const el = document.getElementById('download-status');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = msg;
  el.className = 'download-status ' + type;
  if (type !== 'loading') setTimeout(() => { el.style.display = 'none'; }, 5000);
}

/* ═══════════════════════════════════════════
   PREVIEW MINIATURA YOUTUBE
   ═══════════════════════════════════════════ */
function handleYoutubeUrlInput(url) {
  const container = document.getElementById('yt-preview-container');
  const img = document.getElementById('yt-preview-img');
  const title = document.getElementById('yt-preview-title');

  const match = url.match(/(?:youtu\.be\/|[?&]v=)([^#&?]{11})/);
  if (match) {
    img.src = `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`;
    title.textContent = 'Video Listo para Descargar';
    container.style.display = 'block';
  } else {
    container.style.display = 'none';
  }
}

/* ═══════════════════════════════════════════
   PANEL DESCARGAS RECIENTES
   ═══════════════════════════════════════════ */
async function showRecentDownloadsPanel() {
  if (document.getElementById('recent-downloads-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'recent-downloads-panel';
  panel.className = 'playlist-card';
  panel.innerHTML = `
    <div class="playlist-header">
      <h2>Descargas Recientes</h2>
      <span class="playlist-count" id="recent-count">—</span>
    </div>
    <div class="playlist-list" id="recent-list">
      <p style="font-size:.72rem;color:var(--pearl-muted);padding:12px">Cargando...</p>
    </div>`;
  document.querySelector('.main-layout')?.appendChild(panel);
  await refreshRecentPanel();
}

async function refreshRecentPanel() {
  const listEl = document.getElementById('recent-list');
  const countEl = document.getElementById('recent-count');
  if (!listEl) return;

  try {
    const data = await window.electronAPI.getLocalMedia();
    const today = new Date().toDateString();
    const videos = (data?.videos ?? [])
      .filter(v => v.addedAt && new Date(v.addedAt).toDateString() === today)
      .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

    if (countEl) countEl.textContent = `${videos.length} ${videos.length === 1 ? 'video hoy' : 'videos hoy'}`;

    if (!videos.length) {
      listEl.innerHTML = `<div class="empty-state"><p>No hay videos descargados hoy.</p></div>`;
      return;
    }

    const videoIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(32,51,160,0.8)">
      <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
    </svg>`;

    listEl.innerHTML = '';
    videos.forEach((v, i) => {
      const hora = new Date(v.addedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
      const div = document.createElement('div');
      div.className = 'playlist-item';

      const thumbHtml = v.thumbUrl
        ? `<img src="${v.thumbUrl}" style="width:40px;height:28px;object-fit:cover;border-radius:3px;">`
        : videoIcon;

      div.innerHTML = `
        <div class="item-num"><span class="idx-num">${i + 1}</span></div>
        <div class="item-thumb">${thumbHtml}</div>
        <div class="item-info">
          <strong title="${v.name}">${v.name}</strong>
          <span style="font-size:.65rem;color:var(--pearl-muted)">Hoy &middot; ${hora}</span>
        </div>`;
      listEl.appendChild(div);
    });
  } catch (err) {
    listEl.innerHTML = `<p style="font-size:.72rem;color:#f87171;padding:12px">Error al leer la carpeta.</p>`;
  }
}

async function updateDownloadedLocalList() {
  const container = document.getElementById('downloaded-local-list');
  if (!container) return;

  try {
    const data = await window.electronAPI.getLocalMedia();
    const videos = data?.videos ?? [];

    if (!videos.length) {
      container.innerHTML = `<p style="font-size:.68rem;color:var(--pearl-muted)">No hay videos aun.</p>`;
      return;
    }

    container.innerHTML = '';
    videos.forEach(v => {
      const item = document.createElement('div');
      item.className = 'local-download-item';
      item.title = v.name;
      item.textContent = 'Video: ' + v.name;
      container.appendChild(item);
    });
  } catch (e) {
    container.innerHTML = `<p style="font-size:.68rem;color:#f87171">No se pudo leer la carpeta.</p>`;
  }
}

/* ═══════════════════════════════════════════
   TOAST (notificaciones flotantes)
   ═══════════════════════════════════════════ */
function showToast(msg, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position:fixed; bottom:24px; right:24px; z-index:9999;
      display:flex; flex-direction:column; gap:8px;`;
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const colors = { info: '#3A4DC4', success: '#16a34a', error: '#dc2626' };
  toast.style.cssText = `
    background:${colors[type] ?? colors.info};
    color:#fff; padding:10px 16px; border-radius:8px;
    font-size:.8rem; font-family:'Lato',sans-serif;
    box-shadow:0 4px 12px rgba(0,0,0,.4);
    animation: fadeInUp .25s ease;`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

/* ═══════════════════════════════════════════
   UTIL
   ═══════════════════════════════════════════ */
function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}