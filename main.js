const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
// Importamos el descargador profesional
const ytDlp = require('youtube-dl-exec');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'assets', 'imresizer-logo.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ─── RUTA DE CONFIG ─── */
function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { }

  // Ruta por defecto si el usuario nunca ha configurado una
  const defaultDir = path.join(app.getPath('videos'), 'alabanzas');

  // Nos aseguramos de que la carpeta exista para que no rompa las descargas ni lecturas
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }

  return { videosDir: defaultDir };
}

function saveConfig(data) {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) { }
}

/* ─── IPC ─── */

// 1. El usuario elige carpeta de videos
// Asegúrate de que se llame exactamente 'download-youtube'
ipcMain.handle('download-youtube', async (event, youtubeUrl) => {
  const config = loadConfig();
  const targetFolder = config.videosDir;

  if (!youtubeUrl) return { success: false, error: 'La URL está vacía' };
  if (!targetFolder || !fs.existsSync(targetFolder)) {
    return { success: false, error: 'La carpeta de destino no es válida o no existe.' };
  }

  try {
    const outputTemplate = path.join(targetFolder, '%(title)s.%(ext)s');

    await ytDlp(youtubeUrl, {
      output: outputTemplate,
      format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      mergeOutputFormat: 'mp4',
      ffmpegLocation: path.join(__dirname, 'bin', 'ffmpeg.exe')
    });

    return { success: true };
  } catch (error) {
    console.error('Error descargando de YouTube:', error);
    return { success: false, error: error.message };
  }
});

// 2. Leer videos de la carpeta guardada
ipcMain.handle('get-local-media', async () => {
  const config = loadConfig();
  const videosDir = config.videosDir || null;
  const result = { videos: [], currentFolder: videosDir };

  if (!videosDir) return result;

  try {
    if (fs.existsSync(videosDir) && fs.statSync(videosDir).isDirectory()) {
      // En main.js, dentro del forEach de get-local-media
      fs.readdirSync(videosDir).forEach(file => {
        const filePath = path.join(videosDir, file);

        try {
          const stats = fs.statSync(filePath);
          if (!stats.isFile()) return;

          const ext = path.extname(file).toLowerCase();
          if (['.mp4', '.mkv', '.avi', '.webm', '.mov'].includes(ext)) {
            result.videos.push({
              name: path.parse(file).name,
              author: 'Predicación',
              url: pathToFileURL(filePath).href,
              addedAt: stats.mtime.toISOString()
            });
          }
        } catch (statErr) {
          console.warn('Archivo omitido:', file, statErr.message);
        }
      });
    }
  } catch (err) {
    console.error('Error leyendo videos:', err);
  }

  return result;
});

// 3. Guardar playlist
ipcMain.handle('save-playlist-txt', async (event, content) => {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'playlist_saved.txt'), content, 'utf8');
    return true;
  } catch (err) { return false; }
});

// 4. Cargar playlist
ipcMain.handle('load-playlist-txt', async () => {
  try {
    const p = path.join(app.getPath('userData'), 'playlist_saved.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    return '';
  } catch (err) { return ''; }
});

// 5. NUEVO: Descargar videos de YouTube a la carpeta activa
ipcMain.handle('download-youtube-video', async (event, youtubeUrl) => {
  const config = loadConfig();
  const targetFolder = config.videosDir;

  if (!youtubeUrl) return { success: false, error: 'La URL está vacía' };
  if (!targetFolder || !fs.existsSync(targetFolder)) {
    return { success: false, error: 'La carpeta de destino no es válida o no existe.' };
  }

  try {
    // Configuración del formato de salida: Nombre del video de YT + extensión mp4
    const outputTemplate = path.join(targetFolder, '%(title)s.%(ext)s');

    // Ejecuta la descarga de forma asíncrona mediante yt-dlp
    await ytDlp(youtubeUrl, {
      output: outputTemplate,
      format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', // Prioriza mp4 nativo de buena calidad
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      mergeOutputFormat: 'mp4',
      ffmpegLocation: path.join(__dirname, 'bin', 'ffmpeg.exe')
    });

    return { success: true, message: 'Video descargado con éxito en tu carpeta por defecto.' };
  } catch (error) {
    console.error('Error descargando de YouTube:', error);
    return { success: false, error: error.message || 'Error interno durante el procesamiento del video.' };
  }
});