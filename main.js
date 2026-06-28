const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { create: createYtDlp } = require('youtube-dl-exec');

let mainWindow;

/* ─── RUTAS DE BINARIOS ───
 *
 * En producción (app.isPackaged = true):
 *   Los binarios van en extraResources → resources/bin/
 *   __dirname apunta dentro del ASAR (inútil para ejecutables)
 *   → Usar SIEMPRE process.resourcesPath/bin/
 *
 * En desarrollo (npm start):
 *   → Buscar en node_modules/youtube-dl-exec/bin/ (lo puso npm install)
 *     o en la carpeta local bin/ si existe
 */
function getBinPath(filename) {
  // process.resourcesPath es provisto por Electron en TODOS los entornos:
  // - Producción: C:\...\RemanenteMultimedia\resources
  // - Desarrollo:  C:\...\node_modules\electron\dist\resources
  //
  // En producción, extraResources pone los binarios en resources/bin/
  // En desarrollo, los binarios están en bin/ del proyecto (__dirname)

  // Si hay un bin/ accesible junto a resources/ (producción), usarlo
  const prodPath = path.join(process.resourcesPath, 'bin', filename);
  if (fs.existsSync(prodPath)) {
    return prodPath;
  }

  // Desarrollo: node_modules/youtube-dl-exec/bin/ (npm install lo descargó aquí)
  const fromNodeModules = path.join(__dirname, 'node_modules', 'youtube-dl-exec', 'bin', filename);
  if (fs.existsSync(fromNodeModules)) return fromNodeModules;

  // Fallback: bin/ local
  return path.join(__dirname, 'bin', filename);
}

function getYtDlpPath() { return getBinPath('yt-dlp.exe'); }
function getFfmpegPath() { return getBinPath('ffmpeg.exe'); }

function getYtDlp() {
  const ytDlpPath = getYtDlpPath();
  const exists = fs.existsSync(ytDlpPath);
  console.log('[yt-dlp] resourcesPath:', process.resourcesPath);
  console.log('[yt-dlp] binario:', ytDlpPath, '| existe:', exists);
  return createYtDlp(ytDlpPath);
}

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

    const ytDlp = getYtDlp();
    await ytDlp(youtubeUrl, {
      output: outputTemplate,
      format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      mergeOutputFormat: 'mp4',
      ffmpegLocation: getFfmpegPath()
    });

    return { success: true };
  } catch (error) {
    const ytPath = getYtDlpPath();
    const ffPath = getFfmpegPath();
    const diag = 'yt-dlp [' + (require("fs").existsSync(ytPath) ? 'OK' : 'NO ENCONTRADO') + ']: ' + ytPath + ' | ffmpeg [' + (require("fs").existsSync(ffPath) ? 'OK' : 'NO ENCONTRADO') + ']: ' + ffPath;
    console.error('Error descargando de YouTube:', error.message);
    console.error('Diagnostico:', diag);
    return { success: false, error: error.message + '\n\n' + diag };
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
    const ytDlp = getYtDlp();
    await ytDlp(youtubeUrl, {
      output: outputTemplate,
      format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', // Prioriza mp4 nativo de buena calidad
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      mergeOutputFormat: 'mp4',
      ffmpegLocation: getFfmpegPath()
    });

    return { success: true, message: 'Video descargado con éxito en tu carpeta por defecto.' };
  } catch (error) {
    console.error('Error descargando de YouTube:', error);
    return { success: false, error: error.message || 'Error interno durante el procesamiento del video.' };
  }
});