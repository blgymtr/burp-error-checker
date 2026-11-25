'use strict';
// Electron main process: window, settings, scans, exports.

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const { diagnose } = require('./engine/diagnose');
const report = require('./engine/report');
const locate = require('./engine/locate');
const pkg = require('../package.json');

const args = process.argv.slice(app.isPackaged ? 1 : 2);
const DEMO = args.includes('--demo');
const shotIdx = args.indexOf('--screenshots');
const SHOTS_DIR = shotIdx >= 0 ? path.resolve(args[shotIdx + 1] || 'screenshots') : null;

let win = null;
let lastResult = null;
let scanning = false;

// ------------------------------------------------------------ settings
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { configPath: '', jythonPath: '', javaPath: '', burpDir: '', includeLoaded: false, skipJython: false };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  const clean = {};
  for (const k of Object.keys(DEFAULTS)) clean[k] = s[k] === undefined ? DEFAULTS[k] : s[k];
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(clean, null, 2));
  return clean;
}

// ------------------------------------------------------------ window
function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: SHOTS_DIR ? 1440 : 1320,
    height: SHOTS_DIR ? 900 : 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0b0f17',
    title: 'Burp Error Checker',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0f17', symbolColor: '#aab4c8', height: 44 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!SHOTS_DIR) win.show(); else win.showInactive(); });
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); openExternalSafe(url); } });
}

function openExternalSafe(url) {
  if (/^https:\/\//i.test(url)) shell.openExternal(url);
}

// ------------------------------------------------------------ IPC
ipcMain.handle('app:info', () => ({
  version: pkg.version,
  demo: DEMO,
  screenshots: !!SHOTS_DIR,
  platform: process.platform,
  defaultConfigDir: locate.burpConfigDir(),
  settings: loadSettings(),
}));

ipcMain.handle('settings:save', (_e, s) => saveSettings(s || {}));

ipcMain.handle('scan:run', async (e) => {
  if (scanning) return { busy: true };
  scanning = true;
  try {
    const s = loadSettings();
    const demoOpts = DEMO ? require('./demo').demoOptions() : {};
    const result = await diagnose({
      configPath: s.configPath || undefined,
      jythonPath: s.jythonPath || undefined,
      javaPath: s.javaPath || undefined,
      burpDir: s.burpDir || undefined,
      includeLoaded: !!s.includeLoaded,
      skipJython: !!s.skipJython,
      ...demoOpts,
      appVersion: pkg.version,
      onProgress: (p) => { if (!e.sender.isDestroyed()) e.sender.send('scan:progress', p); },
    });
    lastResult = result;
    return { result };
  } catch (err) {
    return { error: String(err && err.stack || err) };
  } finally {
    scanning = false;
  }
});

ipcMain.handle('report:export', async (_e, format) => {
  if (!lastResult) return { error: 'Run a scan first.' };
  const ext = { md: 'md', html: 'html', json: 'json' }[format] || 'md';
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export report',
    defaultPath: path.join(app.getPath('documents'), `burp-extension-report-${stamp}.${ext}`),
    filters: [
      { name: { md: 'Markdown', html: 'HTML page', json: 'JSON' }[ext], extensions: [ext] },
    ],
  });
  if (canceled || !filePath) return { canceled: true };
  const body = ext === 'html' ? report.toHTML(lastResult) : ext === 'json' ? report.toJSON(lastResult) : report.toMarkdown(lastResult);
  fs.writeFileSync(filePath, body);
  return { path: filePath, name: path.basename(filePath) };
});

ipcMain.handle('report:copy', () => {
  if (!lastResult) return false;
  clipboard.writeText(report.toMarkdown(lastResult));
  return true;
});

ipcMain.handle('ext:copy', (_e, id) => {
  if (!lastResult) return false;
  const ext = lastResult.extensions.find(x => x.id === id);
  if (!ext) return false;
  const one = { ...lastResult, extensions: [{ ...ext, analyzed: true }] };
  const md = report.toMarkdown(one).split('## Extensions')[1] || '';
  clipboard.writeText(('## ' + ext.name + md.replace(/^\s*###[^\n]*\n/, '\n')).trim() + '\n');
  return true;
});

ipcMain.handle('clip:write', (_e, text) => { clipboard.writeText(String(text || '')); return true; });

function knownPath(id, kind) {
  if (!lastResult) return null;
  if (kind === 'config') return lastResult.config.file;
  const ext = lastResult.extensions.find(x => x.id === id);
  if (!ext) return null;
  if (kind === 'file') return ext.file;
  if (kind === 'folder') return ext.bapp && ext.bapp.present ? ext.bapp.dir : ext.folder;
  return null;
}

ipcMain.handle('path:show', (_e, id, kind) => {
  const p = knownPath(id, kind);
  if (!p) return false;
  if (fs.existsSync(p) && fs.statSync(p).isFile()) { shell.showItemInFolder(p); return true; }
  let dir = p;
  while (dir && !fs.existsSync(dir)) {
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
  shell.openPath(dir);
  return true;
});

ipcMain.handle('dialog:pick', async (_e, kind) => {
  const s = loadSettings();
  const opts = {
    config: { title: 'Select Burp user settings (UserConfig.json)', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }], defaultPath: s.configPath || locate.burpConfigDir() },
    jython: { title: 'Select jython-standalone JAR', properties: ['openFile'], filters: [{ name: 'JAR', extensions: ['jar'] }] },
    java: { title: 'Select the java executable', properties: ['openFile'], filters: process.platform === 'win32' ? [{ name: 'java.exe', extensions: ['exe'] }] : [] },
    burp: { title: 'Select the Burp Suite install folder', properties: ['openDirectory'] },
  }[kind];
  if (!opts) return null;
  const r = await dialog.showOpenDialog(win, opts);
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('open:external', (_e, url) => { openExternalSafe(url); return true; });

// ------------------------------------------------------------ screenshots (README images)
ipcMain.handle('shot:capture', async (_e, name) => {
  if (!SHOTS_DIR) return false;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await new Promise(r => setTimeout(r, 350));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(SHOTS_DIR, name + '.png'), img.toPNG());
  return true;
});
ipcMain.handle('shot:done', () => { if (SHOTS_DIR) setTimeout(() => app.quit(), 200); return true; });

// ------------------------------------------------------------ lifecycle
app.setAppUserModelId('io.github.blgymtr.burp-error-checker');
const single = SHOTS_DIR ? true : app.requestSingleInstanceLock();
if (!single) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
