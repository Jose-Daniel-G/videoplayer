const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Usamos un script de precarga para comunicar Node.js con el HTML de forma segura
      preload: path.join(__dirname, 'preload.js') 
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ─── CANALES DE COMUNICACIÓN (Node.js <-> HTML) ───

// 1. Escanear automáticamente los archivos por defecto en carpetas físicas
ipcMain.handle('get-local-media', async () => {
  // Ruta absoluta de tu carpeta de videos en el Escritorio
  const videosDir = "C:\\Users\\jjdd1\\OneDrive\\Desktop\\Remanente-Desktop\\videos";
  // Carpeta interna del proyecto para la música
  const musicDir = path.join(__dirname, 'musica');

  // Asegurar que las carpetas existan de forma física
  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
  if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir);

  // Escaneo dinámico de Videos en tu Escritorio
  const videos = fs.readdirSync(videosDir)
    .filter(file => /\.(mp4|mkv|avi|webm)$/i.test(file))
    .map(file => {
      const fullPath = path.join(videosDir, file);
      return {
        name: file.replace(/\.[^.]+$/, ''), // Quita la extensión (.mp4) para mostrar un nombre limpio
        author: 'Predicación',
        // 'file://' le permite a la interfaz web de Electron reproducir rutas directas del disco duro
        url: `file://${fullPath.replace(/\\/g, '/')}` 
      };
    });

  // Escaneo dinámico de Música local en el proyecto
  const music = fs.readdirSync(musicDir)
    .filter(file => /\.(mp3|wav|ogg|aac)$/i.test(file))
    .map(file => ({ 
      name: file.replace(/\.[^.]+$/, ''), 
      author: 'Adoración', 
      url: `musica/${file}` 
    }));

  return { videos, music };
});

// 2. Guardar automáticamente la lista de "Guardados para momento" en un archivo de texto
ipcMain.handle('save-playlist-txt', async (event, data) => {
  const filePath = path.join(app.getPath('userData'), 'guardados_momento.txt');
  fs.writeFileSync(filePath, data, 'utf-8');
  return true;
});

// 3. Leer la lista guardada automáticamente al iniciar la app
ipcMain.handle('load-playlist-txt', async () => {
  const filePath = path.join(app.getPath('userData'), 'guardados_momento.txt');
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return null;
});