const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

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
  } catch (e) {}
  // Ruta por defecto si el usuario nunca ha configurado una
  return { videosDir: path.join(app.getPath('videos'), 'alabanzas') };
}

function saveConfig(data) {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

/* ─── IPC ─── */

// 1. El usuario elige carpeta de videos
ipcMain.handle('select-videos-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona la carpeta de videos',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return null;

  const folderPath = result.filePaths[0];
  const config = loadConfig();
  config.videosDir = folderPath;
  saveConfig(config);
  return folderPath;
});

// 2. Leer videos de la carpeta guardada
ipcMain.handle('get-local-media', async () => {
  const config = loadConfig();
  const videosDir = config.videosDir || null;
  const result = { videos: [], currentFolder: videosDir };

  if (!videosDir) return result; // nunca se ha configurado

  try {
    if (fs.existsSync(videosDir) && fs.statSync(videosDir).isDirectory()) {
      fs.readdirSync(videosDir).forEach(file => {
        const filePath = path.join(videosDir, file);
        if (fs.statSync(filePath).isFile()) {
          const ext = path.extname(file).toLowerCase();
          if (['.mp4', '.mkv', '.avi', '.webm', '.mov'].includes(ext)) {
            result.videos.push({
              name:   path.parse(file).name,
              author: 'Predicación',
              url:    'file://' + filePath
            });
          }
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