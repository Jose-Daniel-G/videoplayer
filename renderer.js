
let currentTab = 'video';
let listScope = 'all'; 
let searchQuery = '';

// Almacenes dinámicos
let masterPlaylist = [];
let savedPlaylist = [];
let localVideos = [];
let localMusic = [];

let currentIndex = -1;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;
let vizInterval = null;

const videoPlayer = document.getElementById('video-player');
const audioPlayer = document.getElementById('audio-player');

// Al iniciar la aplicación de escritorio
window.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Cargar archivos físicos reales leídos desde el proceso principal (main.js)
    const media = await window.electronAPI.getLocalMedia();
    localVideos = media.videos;
    localMusic = media.music;
    
    // 2. Cargar automáticamente la lista persistente desde el archivo .txt
    const txtContent = await window.electronAPI.loadPlaylistTxt();
    if (txtContent && txtContent.startsWith("REMANENTE_PLAYLIST_EXPORT")) {
      const jsonStr = txtContent.substring(txtContent.indexOf("\n") + 1);
      savedPlaylist = JSON.parse(jsonStr);
    }
    
    initDefaults();
    renderPlaylist();
  } catch (error) {
    console.error("Error inicializando la app:", error);
  }
});

function initDefaults() {
  masterPlaylist = currentTab === 'video' ? [...localVideos] : [...localMusic];
}

function getActivePlayer() {
  return currentTab === 'video' ? videoPlayer : audioPlayer;
}

function getActivePlaylist() {
  let baseList = (listScope === 'all') ? masterPlaylist : savedPlaylist;
  if (searchQuery.trim() !== '') {
    return baseList.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }
  return baseList;
}

/* ─── Cambio de Pestaña Principal ─── */
function switchTab(tab) {
  currentTab = tab;
  currentIndex = -1;
  isPlaying = false;
  searchQuery = '';
  document.getElementById('search-input').value = '';
  updatePlayPauseUI();

  document.getElementById('tab-video').classList.toggle('active', tab === 'video');
  document.getElementById('tab-music').classList.toggle('active', tab === 'music');
  document.getElementById('screen-video').classList.toggle('hidden', tab !== 'video');
  document.getElementById('screen-music').classList.toggle('hidden', tab !== 'music');
  document.getElementById('playlist-label').textContent = tab === 'video' ? 'Lista de Videos' : 'Lista de Música';

  const badge = document.getElementById('sermon-badge');
  badge.innerHTML = tab === 'video'
    ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> Predicación en Video'
    : '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> Alabanza y Música';

  videoPlayer.pause();
  audioPlayer.pause();
  stopVisualizer();
  
  initDefaults();
  renderPlaylist();

  document.getElementById('track-title').textContent = 'Selecciona un archivo';
  document.getElementById('track-author').textContent = '—';
  document.getElementById('progress-fill').style.width = '0%';
  document.getElementById('time-current').textContent = '0:00';
  document.getElementById('time-total').textContent = '0:00';

  if (tab === 'music') {
    document.getElementById('music-title').textContent = 'Selecciona una canción';
    document.getElementById('music-sub').textContent = '—';
    document.getElementById('album-art').classList.remove('spinning');
  }
}

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

// Guarda la lista en el .txt de fondo automáticamente cada vez que cambia
async function autoSaveSavedList() {
  let content = "REMANENTE_PLAYLIST_EXPORT\n";
  content += JSON.stringify(savedPlaylist, null, 2);
  await window.electronAPI.savePlaylistTxt(content);
}

async function clearSavedList() {
  if(confirm("¿Estás seguro de que deseas limpiar la lista de guardados? Esto borrará el archivo de registro permanente.")) {
    savedPlaylist = [];
    await autoSaveSavedList();
    renderPlaylist();
  }
}

async function toggleSaveTrack(index, event) {
  event.stopPropagation();
  let currentDisplayList = getActivePlaylist();
  let selectedTrack = currentDisplayList[index];

  let existIndex = savedPlaylist.findIndex(item => item.name === selectedTrack.name);
  if (existIndex > -1) {
    savedPlaylist.splice(existIndex, 1);
  } else {
    savedPlaylist.push(selectedTrack);
  }
  
  await autoSaveSavedList(); // Guardado automático en .txt sin molestar al usuario
  renderPlaylist();
}

/* ─── Pintar la Lista en Pantalla ─── */
function renderPlaylist() {
  const list = document.getElementById('playlist-list');
  const count = document.getElementById('playlist-count');
  let currentDisplayList = getActivePlaylist();
  
  count.textContent = currentDisplayList.length + (currentDisplayList.length === 1 ? ' elemento' : ' elementos');

  if (currentDisplayList.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <p>No se encontraron elementos en este segmento.<br>Asegúrate de añadir archivos multimedia en las carpetas nativas de la aplicación.</p>
    </div>`;
    return;
  }

  list.innerHTML = '';
  currentDisplayList.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'playlist-item' + (i === currentIndex ? ' active' : '');
    div.onclick = () => { loadTrack(i); };

    const isVideo = currentTab === 'video';
    const icon = isVideo
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(32,51,160,0.7)"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(32,51,160,0.8)" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;

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
        <span>${item.author}</span>
      </div>
      <span class="item-dur" style="margin-right: 0.5rem;">${dur}</span>
      <div class="action-icon" onclick="toggleSaveTrack(${i}, event)" title="Guardar/Remover de momentos">
         <svg width="15" height="15" viewBox="0 0 24 24" fill="${isInSaved ? 'var(--gold)' : 'none'}" stroke="${saveIconColor}" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      </div>
    `;
    list.appendChild(div);
  });
}

/* ─── Carga de Pista Activa ─── */
function loadTrack(index) {
  let currentDisplayList = getActivePlaylist();
  if (index < 0 || index >= currentDisplayList.length) return;
  
  currentIndex = index;
  const item = currentDisplayList[index];
  const player = getActivePlayer();

  videoPlayer.pause();
  audioPlayer.pause();
  stopVisualizer();

  player.src = item.url;
  player.volume = parseFloat(document.getElementById('volume-slider').value);

  document.getElementById('track-title').textContent = item.name;
  document.getElementById('track-author').textContent = item.author;

  if (currentTab === 'music') {
    document.getElementById('music-title').textContent = item.name;
    document.getElementById('music-sub').textContent = item.author;
  }

  player.addEventListener('loadedmetadata', () => {
    document.getElementById('time-total').textContent = formatTime(player.duration);
    item.duration = player.duration;
  }, { once: true });

  const listItems = document.querySelectorAll('.playlist-item');
  listItems.forEach((li, idx) => { li.classList.toggle('active', idx === currentIndex); });

  setTimeout(() => player.play(), 150);
}

function togglePlay() {
  const player = getActivePlayer();
  if (!player.src) return;
  if (isPlaying) player.pause();
  else player.play();
}

function forward10() {
  const player = getActivePlayer();
  if (player.src && player.duration) player.currentTime = Math.min(player.duration, player.currentTime + 10);
}

function rewind10() {
  const player = getActivePlayer();
  if (player.src) player.currentTime = Math.max(0, player.currentTime - 10);
}

videoPlayer.addEventListener('play', () => { isPlaying = true; updatePlayPauseUI(); document.getElementById('video-overlay').classList.add('playing'); });
videoPlayer.addEventListener('pause', () => { isPlaying = false; updatePlayPauseUI(); document.getElementById('video-overlay').classList.remove('playing'); });
audioPlayer.addEventListener('play', () => { isPlaying = true; updatePlayPauseUI(); startVisualizer(); document.getElementById('album-art').classList.add('spinning'); });
audioPlayer.addEventListener('pause', () => { isPlaying = false; updatePlayPauseUI(); stopVisualizer(); document.getElementById('album-art').classList.remove('spinning'); });

function updatePlayPauseUI() {
  document.getElementById('icon-play').classList.toggle('hidden', isPlaying);
  document.getElementById('icon-pause').classList.toggle('hidden', !isPlaying);
}

[videoPlayer, audioPlayer].forEach(p => {
  p.addEventListener('timeupdate', () => {
    if (!p.duration) return;
    const pct = (p.currentTime / p.duration) * 100;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('time-current').textContent = formatTime(p.currentTime);
  });
  p.addEventListener('ended', () => {
    if (isRepeat) { p.currentTime = 0; p.play(); }
    else nextTrack();
  });
});

function seekTo(e) {
  const player = getActivePlayer();
  if (!player.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  player.currentTime = pct * player.duration;
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

function toggleShuffle() { isShuffle = !isShuffle; document.getElementById('btn-shuffle').classList.toggle('active', isShuffle); }
function toggleRepeat() { isRepeat = !isRepeat; document.getElementById('btn-repeat').classList.toggle('active', isRepeat); }
function setVolume(val) { videoPlayer.volume = val; audioPlayer.volume = val; }

function toggleFullscreen() {
  const wrapper = document.getElementById('screen-video');
  if (!document.fullscreenElement) wrapper.requestFullscreen().catch(() => {});
  else document.exitFullscreen();
}

document.addEventListener('fullscreenchange', () => {
  const inFs = !!document.fullscreenElement;
  document.getElementById('icon-fs-expand').classList.toggle('hidden', inFs);
  document.getElementById('icon-fs-shrink').classList.toggle('hidden', !inFs);
});

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

let vizPhases = Array.from({length: 12}, () => Math.random() * Math.PI * 2);
let vizSpeeds = Array.from({length: 12}, () => 0.05 + Math.random() * 0.08);
function startVisualizer() {
  if (vizInterval) return;
  vizInterval = setInterval(() => {
    for (let i = 1; i <= 12; i++) {
      vizPhases[i-1] += vizSpeeds[i-1];
      const h = 8 + Math.abs(Math.sin(vizPhases[i-1])) * 34;
      const bar = document.getElementById('b' + i);
      if (bar) bar.style.height = Math.round(h) + 'px';
    }
  }, 80);
}
function stopVisualizer() {
  if (vizInterval) { clearInterval(vizInterval); vizInterval = null; }
  for (let i = 1; i <= 12; i++) {
    const bar = document.getElementById('b' + i);
    if (bar) bar.style.height = '4px';
  }
}