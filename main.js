const { app, BrowserWindow, ipcMain } = require("electron");
const path    = require("path");
const fs      = require("fs");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");

/* ═══════════════════════════════════════════
   JSONBIN
   ═══════════════════════════════════════════ */
const JSONBIN_API_KEY = "$2a$10$FC02j5gbHIHKA.wnoYQNqegrrC4EBf/gCyx1lR/oBRGi99Bj7aemC";
const BIN_VIDEOS   = "6a4171f1da38895dfe0cb6b8";
const BIN_PLAYLIST = "6a41792df5f4af5e293e5e04";
const BIN_PENDING  = "6a4585f0f5f4af5e2950260e";

async function jsonbinGet(binId) {
  const res = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
    headers: { "X-Master-Key": JSONBIN_API_KEY },
  });
  if (!res.ok) throw new Error(`JSONBin GET ${binId}: HTTP ${res.status}`);
  const data = await res.json();
  return data.record;
}

async function jsonbinPut(binId, body) {
  const res = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`JSONBin PUT ${binId}: HTTP ${res.status}`);
  return res.json();
}

/* ═══════════════════════════════════════════
   RUTAS DE BINARIOS
   ═══════════════════════════════════════════ */
function getBinPath(filename) {
  const prodPath = path.join(process.resourcesPath, "bin", filename);
  if (fs.existsSync(prodPath)) return prodPath;
  const devPath = path.join(app.getAppPath(), "bin", filename);
  if (fs.existsSync(devPath)) return devPath;
  const nmPath = path.join(app.getAppPath(), "node_modules", "youtube-dl-exec", "bin", filename);
  if (fs.existsSync(nmPath)) return nmPath;
  return prodPath;
}
const getYtDlpPath  = () => getBinPath("yt-dlp.exe");
const getFfmpegPath = () => getBinPath("ffmpeg.exe");

/* ═══════════════════════════════════════════
   VENTANA
   ═══════════════════════════════════════════ */
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, "assets", "imresizer-logo.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile("index.html");

  // Cuando la UI termina de cargar, disparar las pendientes directamente
  mainWindow.webContents.on("did-finish-load", () => {
    setTimeout(() => {
      console.log("[Auto-Start] Buscando descargas pendientes en la nube...");
      enqueuePendingDownloads();
    }, 2000);
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* ═══════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════ */
function getConfigPath() {
  return path.join(app.getPath("userData"), "config.json");
}
function loadConfig() {
  const fallbackDir = path.join(app.getPath("videos"), "alabanzas");
  const fallbackConfig = { videosDir: fallbackDir, volume: 0.85, lastVideo: null, lastPosition: 0 };

  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
      const fileContent = fs.readFileSync(p, "utf8");
      if (fileContent.trim()) {
        const saved = JSON.parse(fileContent);
        // Validamos que tenga la propiedad y que la ruta exista o pueda usarse
        if (saved && saved.videosDir) {
          return saved;
        }
      }
    }
  } catch (e) {
    console.error("[Config] Error al leer o parsear config.json, usando valores por defecto:", e.message);
  }

  // Si no existe el archivo de configuración o está corrupto, nos aseguramos de crear el directorio dinámico
  try {
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true });
    }
  } catch (e) {
    console.error("[Config] No se pudo crear la carpeta dinámica por defecto:", e.message);
  }

  return fallbackConfig;
}
function saveConfig(data) {
  try { fs.writeFileSync(getConfigPath(), JSON.stringify(data, null, 2), "utf8"); } catch (e) {}
}

/* ═══════════════════════════════════════════
   THUMBNAILS
   ═══════════════════════════════════════════ */
function getThumbsDir() {
  const dir = path.join(app.getPath("userData"), "thumbs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function extractThumbnail(videoPath) {
  return new Promise((resolve) => {
    const name     = path.parse(videoPath).name;
    const thumbOut = path.join(getThumbsDir(), name + ".jpg");
    if (fs.existsSync(thumbOut)) return resolve(thumbOut);
    const ffmpeg = getFfmpegPath();
    if (!fs.existsSync(ffmpeg)) return resolve(null);
    execFile(ffmpeg, ["-ss","3","-i",videoPath,"-frames:v","1","-q:v","5","-vf","scale=160:-1",thumbOut,"-y"],
      { timeout: 15000 }, (err) => resolve(err ? null : thumbOut));
  });
}

/* ═══════════════════════════════════════════
   COLA DE DESCARGAS — CORREGIDA
   ═══════════════════════════════════════════ */
const downloadQueue = [];
let isDownloading = false;

async function processQueue() {
  // Guardia: si ya hay una descarga activa o la cola está vacía, salir
  if (isDownloading || downloadQueue.length === 0) return;
  isDownloading = true;

  const { url, jobId, isPending } = downloadQueue.shift();
  const config       = loadConfig();
  const targetFolder = config.videosDir;

  function send(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("download-progress", { jobId, isPending, url, ...payload });
    }
  }

  // ── FIX: todo dentro de un único try/finally para garantizar el reset ──
  try {
    if (!targetFolder || !fs.existsSync(targetFolder)) {
      send({ status: "error", error: "La carpeta de destino no existe." });
      return; // el finally se encarga del reset
    }

    send({ status: "starting", queue: downloadQueue.length });

    const outputTemplate = path.join(targetFolder, "%(title)s.%(ext)s");
    const ytDlpPath      = getYtDlpPath();
    let   lastFile       = null;

    await new Promise((resolve, reject) => {
      const proc = execFile(ytDlpPath, [
        url,
        "--output", outputTemplate,
        "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--no-check-certificates",
        "--no-warnings",
        "--no-playlist",
        "--merge-output-format", "mp4",
        "--ffmpeg-location", getFfmpegPath(),
        "--newline",
        "--progress",
      ], { timeout: 0 });

      proc.stdout.on("data", (chunk) => {
        for (const line of chunk.toString().split("\n")) {
          const destMatch = line.match(/\[download\] Destination:\s*(.+)/);
          if (destMatch) lastFile = destMatch[1].trim();

          const pctMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+([\d.~]+\w+)\s+at\s+([\d.~]+\w+\/s)\s+ETA\s+(\S+)/);
          if (pctMatch) send({ status:"progress", percent:parseFloat(pctMatch[1]), size:pctMatch[2], speed:pctMatch[3], eta:pctMatch[4] });

          if (line.includes("[Merger]") || line.includes("Merging formats")) {
            send({ status:"progress", percent:99, speed:"—", eta:"—", size:"—" });
          }
        }
      });
      proc.stderr.on("data", (chunk) => console.error("[yt-dlp stderr]", chunk.toString()));
      proc.on("close", (code) => code === 0 ? resolve(lastFile) : reject(new Error(`yt-dlp salió con código ${code}`)));
      proc.on("error", reject);
    });

    // Descarga OK — thumbnail
    let thumbUrl = null;
    if (lastFile && fs.existsSync(lastFile)) {
      const thumbPath = await extractThumbnail(lastFile).catch(() => null);
      if (thumbPath) thumbUrl = pathToFileURL(thumbPath).href;
    }
    send({ status: "done", thumbUrl });

    // Si era pendiente, borrarlo del Bin y notificar al renderer
    if (isPending) {
      await removePendingFromCloud(url).catch(e =>
        console.warn("[pending] No se pudo actualizar BIN_PENDING:", e.message)
      );
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("pending-download-done", { url, jobId });
      }
    }

  } catch (error) {
    console.error("[processQueue] Error:", error.message);
    send({ status: "error", error: error.message });
  } finally {
    // ── FIX CLAVE: el reset SIEMPRE ocurre, pase lo que pase ──
    isDownloading = false;
    // Llamar al siguiente en la cola (en el próximo tick para evitar stack overflow)
    setImmediate(processQueue);
  }
}

/* ─── Eliminar URL del Bin de pendientes ─── */
async function removePendingFromCloud(url) {
  const record  = await jsonbinGet(BIN_PENDING);
  const pending = Array.isArray(record?.pending) ? record.pending : [];
  const updated = pending.filter(item => (typeof item === "string" ? item : item.url) !== url);
  await jsonbinPut(BIN_PENDING, { pending: updated, updatedAt: new Date().toISOString() });
  console.log("[pending] Eliminado del Bin:", url);
}

/* ─── Leer pendientes de la nube y encolarlos (llamado directo, no via IPC) ─── */
async function enqueuePendingDownloads() {
  try {
    const record  = await jsonbinGet(BIN_PENDING);
    const pending = Array.isArray(record?.pending) ? record.pending : [];

    if (pending.length === 0) {
      console.log("[pending] No hay descargas pendientes.");
      return;
    }
    console.log(`[pending] ${pending.length} pendiente(s). Encolando...`);

    let enqueued = 0;
    for (const item of pending) {
      const url = typeof item === "string" ? item : item.url;
      if (!url) continue;
      // No duplicar si ya está en la cola
      if (downloadQueue.some(q => q.url === url)) continue;
      const jobId = "pending_" + Date.now() + "_" + Math.random().toString(36).slice(2,6);
      downloadQueue.push({ url, jobId, isPending: true });
      enqueued++;
    }

    if (enqueued > 0) {
      // Notificar al renderer cuántas se encolaron
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("download-progress", {
          jobId: "init", isPending: true, url: "",
          status: "pending-init", count: enqueued
        });
      }
      processQueue(); // Arrancar la cola
    }
  } catch (e) {
    console.warn("[enqueuePendingDownloads] error:", e.message);
  }
}

/* ═══════════════════════════════════════════
   IPC HANDLERS
   ═══════════════════════════════════════════ */

// Encolar descarga manual desde la UI
ipcMain.handle("download-youtube", async (event, url) => {
  if (!url) return { success: false, error: "URL vacía" };
  const jobId = Date.now().toString();
  downloadQueue.push({ url, jobId, isPending: false });
  processQueue();
  return { success: true, jobId, queuePosition: downloadQueue.length };
});

// Llamado desde renderer al arrancar (como fallback además del did-finish-load)
ipcMain.handle("process-pending-downloads", async () => {
  await enqueuePendingDownloads();
  return { success: true };
});

// Leer playlist del domingo
ipcMain.handle("fetch-cloud-playlist", async () => {
  try {
    const record   = await jsonbinGet(BIN_PLAYLIST);
    const playlist = Array.isArray(record?.playlist) ? record.playlist : [];
    return { success: true, playlist };
  } catch (error) {
    return { success: false, playlist: [], error: error.message };
  }
});

// Subir lista de videos a la nube
ipcMain.handle("upload-to-cloud", async (event, jsonData) => {
  try {
    await jsonbinPut(BIN_VIDEOS, { updatedAt: new Date().toISOString(), videos: jsonData });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Leer videos locales
ipcMain.handle("get-local-media", async () => {
  const config = loadConfig() || {}; // <-- Si por alguna razón es undefined, usa un objeto vacío
  const videosDir = config.videosDir || null;
  const result = { videos: [], currentFolder: videosDir };
  
  if (!videosDir || !fs.existsSync(videosDir)) {
    console.warn("[get-local-media] La ruta de videos configurada no existe físicamente:", videosDir);
    return result; 
  }
  
  const thumbsDir = getThumbsDir();
  try {
    fs.readdirSync(videosDir).forEach(file => {
      const filePath = path.join(videosDir, file);
      try {
        const stats = fs.statSync(filePath);
        if (!stats.isFile()) return;
        const ext = path.extname(file).toLowerCase();
        if (![".mp4",".mkv",".avi",".webm",".mov"].includes(ext)) return;
        const name      = path.parse(file).name;
        const thumbFile = path.join(thumbsDir, name + ".jpg");
        result.videos.push({
          name, author: "Predicación",
          url: pathToFileURL(filePath).href,
          addedAt: stats.mtime.toISOString(),
          thumbUrl: fs.existsSync(thumbFile) ? pathToFileURL(thumbFile).href : null,
        });
      } catch (e) { console.warn("Archivo omitido:", file, e.message); }
    });
  } catch (err) {
    console.error("[get-local-media] Falló la lectura del directorio:", err.message);
  }
  return result;
});

// Extraer thumbnail
ipcMain.handle("extract-thumb", async (event, fileUrl) => {
  try {
    const filePath  = new URL(fileUrl).pathname.replace(/^\/([A-Z]:)/, "$1");
    const thumbPath = await extractThumbnail(filePath);
    return thumbPath ? pathToFileURL(thumbPath).href : null;
  } catch (e) { return null; }
});

// Renombrar video
ipcMain.handle("rename-video", async (event, { oldUrl, newName }) => {
  try {
    const safeName = newName.replace(/[\\/:*?"<>|]/g, "_").trim();
    if (!safeName) return { success: false, error: "Nombre inválido" };
    const oldPath = new URL(oldUrl).pathname.replace(/^\/([A-Z]:)/, "$1");
    const ext     = path.extname(oldPath);
    const newPath = path.join(path.dirname(oldPath), safeName + ext);
    if (fs.existsSync(newPath)) return { success: false, error: "Ya existe un archivo con ese nombre" };
    fs.renameSync(oldPath, newPath);
    const oldThumb = path.join(getThumbsDir(), path.parse(oldPath).name + ".jpg");
    const newThumb = path.join(getThumbsDir(), safeName + ".jpg");
    if (fs.existsSync(oldThumb)) fs.renameSync(oldThumb, newThumb);
    return { success: true, newUrl: pathToFileURL(newPath).href };
  } catch (e) { return { success: false, error: e.message }; }
});

// Playlist local (txt)
ipcMain.handle("save-playlist-txt", async (event, content) => {
  try { fs.writeFileSync(path.join(app.getPath("userData"), "playlist_saved.txt"), content, "utf8"); return true; }
  catch { return false; }
});
ipcMain.handle("load-playlist-txt", async () => {
  try {
    const p = path.join(app.getPath("userData"), "playlist_saved.txt");
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  } catch { return ""; }
});

// Estado del reproductor
ipcMain.handle("save-player-state", async (event, state) => {
  saveConfig({ ...loadConfig(), ...state }); return true;
});
ipcMain.handle("load-player-state", async () => {
  const { volume = 0.85, lastVideo = null, lastPosition = 0 } = loadConfig();
  return { volume, lastVideo, lastPosition };
});

// Carpeta → JSON
/* ═══════════════════════════════════════════
   Manejador Seguro: Carpeta → JSON
   ═══════════════════════════════════════════ */
ipcMain.handle("get-folder-json", async (event, folderPath) => {
  try {
    // Si la ruta no viene especificada, abortar de inmediato
    if (!folderPath) {
      return { success: false, error: "La ruta proporcionada está vacía." };
    }

    // AUTORREPARACIÓN: Si la ruta no existe físicamente, intentamos crearla
    if (!fs.existsSync(folderPath)) {
      try {
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`[Sistema] Carpeta inexistente regenerada con éxito de forma automática: ${folderPath}`);
      } catch (mkdirError) {
        // Si no se puede crear (ej: problemas de permisos), devolvemos el error limpio
        return { success: false, error: `La ruta no existe y no pudo ser creada: ${mkdirError.message}` };
      }
    }

    // Leer el directorio una vez garantizada su existencia
    const filesData = fs.readdirSync(folderPath).map(file => {
      const fp    = path.join(folderPath, file);
      const stats = fs.statSync(fp);
      return { 
        name: path.parse(file).name, 
        filename: file, 
        extension: path.extname(file),
        size: stats.size, 
        isFolder: stats.isDirectory(),
        createdAt: stats.birthtime.toISOString(), 
        updatedAt: stats.mtime.toISOString() 
      };
    });
    
    return { success: true, data: filesData };
  } catch (error) { 
    return { success: false, error: error.message }; 
  }
});