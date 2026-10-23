/* Rafiq — Electron main process. */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store } = require('./store');
const { Agent } = require('./agent');
const { PRESETS, listModels } = require('./providers');
const { WorkspaceError } = require('./workspace');

const isDev = !app.isPackaged || process.argv.includes('--dev');
let store;
let agent;
let mainWindow = null;

/* ── window state ─────────────────────────────────────────────── */
function windowStateFile() { return path.join(app.getPath('userData'), 'window.json'); }
function readWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
    return {
      width: Math.max(s.width || 1320, 900),
      height: Math.max(s.height || 860, 620),
      x: s.x, y: s.y, maximized: Boolean(s.maximized)
    };
  } catch { return { width: 1320, height: 860 }; }
}
function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.getNormalBounds();
    fs.writeFileSync(windowStateFile(), JSON.stringify({
      ...bounds,
      maximized: win.isMaximized()
    }));
  } catch { /* best effort */ }
}

/* ── event fan-out to renderer(s) ─────────────────────────────── */
function emit(event) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('rafiq:event', event);
  }
}

/* ── IPC ──────────────────────────────────────────────────────── */
function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, async (_event, payload) => {
    try {
      return await fn(payload);
    } catch (err) {
      return { __error: err instanceof WorkspaceError ? err.message : (err?.message || String(err)) };
    }
  });

  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    node: process.versions.node,
    dataDir: app.getPath('userData'),
    isDev
  }));

  handle('state', () => ({
    state: agent.state,
    settings: store.publicSettings(),
    presets: PRESETS,
    sessions: store.listSessions(),
    recents: store.get('recent') || [],
    home: app.getPath('home'),
    platform: process.platform,
    version: app.getVersion(),
    browser: false
  }));

  handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open a project folder for Rafiq',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Open folder'
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const info = await agent.openWorkspace(result.filePaths[0]);
    return { canceled: false, workspace: info, recents: store.get('recent') };
  });

  handle('workspace:open', async ({ path: folder }) => {
    const info = await agent.openWorkspace(folder);
    return { workspace: info, recents: store.get('recent') };
  });

  handle('workspace:tree', ({ path: rel } = {}) => agent.workspace.tree(rel || '', 8));
  handle('workspace:read', ({ path: rel }) => agent.workspace.read(rel));
  handle('workspace:write', async ({ path: rel, content }) => {
    await agent.recordBackup(rel);
    const res = await agent.workspace.write(rel, content);
    emit({ type: 'workspace:changed' });
    return res;
  });
  handle('workspace:undo', () => agent.undoLastTurn());
  handle('workspace:reveal', ({ path: rel }) => {
    const { abs } = agent.workspace.resolve(rel || '', { allowRoot: true });
    shell.showItemInFolder(abs);
    return true;
  });

  handle('settings:set', (patch) => {
    agent.setSettings(patch || {});
    return store.publicSettings();
  });

  handle('models:list', async ({ baseUrl, apiKey } = {}) => {
    const key = apiKey || agent.settings.apiKey;
    const models = await listModels({ baseUrl: baseUrl || agent.settings.baseUrl, apiKey: key });
    return { models };
  });

  handle('session:new', () => agent.newSession());
  handle('session:list', () => store.listSessions());
  handle('session:load', ({ id }) => {
    const session = store.loadSession(id);
    if (!session) throw new Error('Session not found.');
    agent.loadSession(session);
    return { state: agent.state, session };
  });
  handle('session:delete', ({ id }) => {
    const ok = store.deleteSession(id);
    return { ok, sessions: store.listSessions() };
  });

  handle('chat:send', async ({ text, mode, attachments }) => {
    agent.send({ text, mode, attachments: attachments || [] }).catch((err) => emit({ type: 'error', message: err.message }));
    return true;
  });
  handle('chat:cancel', () => { agent.cancel(); return true; });
  handle('chat:mode', ({ mode }) => agent.setMode(mode));
  handle('chat:approve', ({ id, allow }) => agent.resolveApproval(id, allow));
  handle('chat:plan:approve', ({ plan }) => { agent.approvePlan(plan || ''); return agent.state; });

  handle('shell:external', async ({ url }) => {
    if (!/^https?:\/\//i.test(url || '')) return false;
    await shell.openExternal(url);
    return true;
  });
  handle('shell:open-data', async () => { await shell.openPath(app.getPath('userData')); return true; });
  handle('app:open-log', async () => { await shell.openPath(app.getPath('logs')); return true; });

  handle('window:control', ({ action }) => {
    if (!mainWindow) return false;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    if (action === 'close') mainWindow.close();
    return true;
  });
}

/* ── application menu ─────────────────────────────────────────── */
function buildMenu() {
  const send = (channel) => () => mainWindow?.webContents.send('rafiq:menu', channel);
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New session', accelerator: 'CmdOrCtrl+N', click: send('new-session') },
        { label: 'Open folder…', accelerator: 'CmdOrCtrl+O', click: send('open-folder') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Undo Rafiq’s last changes', accelerator: 'CmdOrCtrl+Z', click: send('undo-changes') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle sidebar', accelerator: 'CmdOrCtrl+B', click: send('toggle-sidebar') },
        { label: 'Toggle theme', accelerator: 'CmdOrCtrl+Shift+L', click: send('toggle-theme') },
        { label: 'Toggle language (AR/EN)', accelerator: 'CmdOrCtrl+Shift+A', click: send('toggle-lang') },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' }, { role: 'reload' }] : [])
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'How to use Rafiq', click: send('help') },
        { label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) },
        { label: 'Rafiq on GitHub', click: () => shell.openExternal('https://github.com/abdokem660-dev/rafiq') },
        { type: 'separator' },
        { label: `Version ${app.getVersion()}`, enabled: false }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ── window ───────────────────────────────────────────────────── */
function createWindow() {
  const state = readWindowState();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#121317',
    title: 'Rafiq',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });

  if (state.maximized) mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });

  // External links open in the real browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F1') { event.preventDefault(); mainWindow.webContents.send('rafiq:menu', 'help'); }
    if (input.key === 'Escape') mainWindow.webContents.send('rafiq:menu', 'escape');
  });
}

/* ── lifecycle ────────────────────────────────────────────────── */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const crypto = (() => {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          return {
            encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
            decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64'))
          };
        }
      } catch { /* fall through to plaintext */ }
      return {};
    })();

    store = new Store({ dataDir: app.getPath('userData'), ...crypto });
    app.setAppUserModelId('com.rafiq.desktop');
    agent = new Agent({ store, emit });
    registerIpc();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (agent) agent.cancel();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
