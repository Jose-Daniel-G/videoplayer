/* ═══════════════════════════════════════════════════════════════
   projector-renderer.js — Salida "en vivo" en la pantalla externa
   El audio permanece en la ventana de control (equipo/computador);
   esta ventana solo reproduce imagen, por eso el <video> va muted.
   ═══════════════════════════════════════════════════════════════ */

const projVideo = document.getElementById('proj-video');
const projIdle = document.getElementById('proj-idle');

function showVideo() {
  projIdle.style.display = 'none';
  projVideo.style.display = 'block';
}

function showIdle() {
  projVideo.style.display = 'none';
  projIdle.style.display = 'flex';
}

function handleSyncMessage(data) {
  if (!data || !data.action) return;

  switch (data.action) {
    case 'load': {
      if (!data.src) { showIdle(); break; }
      showVideo();
      if (projVideo.src !== data.src) {
        projVideo.src = data.src;
      }
      const applyTime = () => {
        if (typeof data.currentTime === 'number') {
          projVideo.currentTime = data.currentTime;
        }
        if (data.playing) projVideo.play().catch(() => {});
      };
      if (projVideo.readyState >= 1) applyTime();
      else projVideo.addEventListener('loadedmetadata', applyTime, { once: true });
      break;
    }

    case 'play':
      showVideo();
      projVideo.play().catch(() => {});
      break;

    case 'pause':
      projVideo.pause();
      break;

    case 'seek':
      if (typeof data.currentTime === 'number') projVideo.currentTime = data.currentTime;
      break;

    case 'sync-time':
      // Corrección suave de deriva entre la ventana de control y la proyección
      if (typeof data.currentTime === 'number' && Math.abs(projVideo.currentTime - data.currentTime) > 0.75) {
        projVideo.currentTime = data.currentTime;
      }
      break;

    case 'clear':
      projVideo.pause();
      projVideo.removeAttribute('src');
      projVideo.load();
      showIdle();
      break;
  }
}

// Al arrancar, pedimos activamente el estado actual por si el comando
// "load" enviado por la ventana de control llegó antes de que este script
// terminara de cargar (esto evita quedarnos pegados en la pantalla de espera).
window.electronAPI?.getProjectorState?.().then((data) => {
  if (data && data.src) {
    handleSyncMessage({ action: 'load', src: data.src, currentTime: data.currentTime, playing: data.playing });
  }
}).catch(() => {});

// Recibe comandos en vivo (play/pause/seek/cargar video/etc.) mientras
// la ventana de proyección permanece abierta.
window.electronAPI?.onProjectorSync?.(handleSyncMessage);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
});