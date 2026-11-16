const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  dialog,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  shell,
  utilityProcess,
} = require('electron');

const isSmokeTest = process.argv.includes('--smoke-test');
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const APP_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(APP_ROOT, 'dist');
const SERVER_ENTRY = path.join(APP_ROOT, 'dist-electron', 'server.cjs');
const ICON_PATH = path.join(APP_ROOT, 'build', isWin ? 'icon.ico' : 'icon.png');
const TRAY_ICON_PATH = path.join(APP_ROOT, 'build', 'tray.png');

let mainWindow = null;
let tray = null;
let serverProc = null;
let ownsBackend = false;
let serverPort = 3130;
let isAlwaysOnTop = false;
let isQuitting = false;
let smokeTmpDir = null;

if (isWin) {
  app.setAppUserModelId('com.tspquant.tickstockpanelpro');
}
app.setName('TICK STOCK PANEL Pro');

let hasSingleInstanceLock = true;
if (isSmokeTest) {
  smokeTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-pro-smoke-'));
  const smokeUserData = path.join(smokeTmpDir, 'userData');
  fs.mkdirSync(smokeUserData, { recursive: true });
  app.setPath('userData', smokeUserData);
} else {
  hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    app.quit();
  }
}

function getWritableDataDir() {
  if (isSmokeTest) {
    if (!smokeTmpDir) {
      smokeTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-pro-smoke-'));
    }
    const d = path.join(smokeTmpDir, 'data');
    fs.mkdirSync(d, { recursive: true });
    return d;
  }
  if (process.env.TSP_DATA_DIR) {
    const custom = path.resolve(process.env.TSP_DATA_DIR);
    fs.mkdirSync(custom, { recursive: true });
    return custom;
  }
  // When launched from local project release/win-unpacked (4 levels up) or `electron .` (APP_ROOT/data),
  // reuse workspace data/ if writable so the flagship SQLite database stays unified.
  const candidates = [
    path.resolve(APP_ROOT, 'data'),
    path.resolve(APP_ROOT, '..', '..', '..', '..', 'data'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'tsp_enterprise.sqlite'))) {
        fs.accessSync(dir, fs.constants.W_OK);
        return dir;
      }
    } catch {
      // ignore non-writable candidate
    }
  }
  const d = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function probePort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(0));
    srv.listen(port, '127.0.0.1', () => {
      const addr = srv.address();
      const chosen = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(chosen));
    });
  });
}

async function pickAvailablePort() {
  if (!isSmokeTest) {
    const preferred = await probePort(3130);
    if (preferred > 0) return preferred;
  }
  const ephemeral = await probePort(0);
  if (ephemeral > 0) return ephemeral;
  throw new Error('Unable to allocate an available localhost TCP port');
}

function fetchLocalJson(port, urlPath, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('HTTP timeout'));
    });
  });
}

async function tryReuseHealthyBackend(port) {
  if (isSmokeTest) return null;
  try {
    const diag = await fetchLocalJson(port, '/api/saas/diagnostics', 900);
    if (diag && Array.isArray(diag.tables) && diag.tables.length >= 15) {
      return diag;
    }
  } catch {
    // no running local backend on this port
  }
  return null;
}

async function waitForBackendReady(port, maxWaitMs = 20000) {
  const deadline = Date.now() + maxWaitMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (!serverProc) {
      throw new Error(
        `Backend utilityProcess exited prematurely${lastErr ? `: ${lastErr}` : ''}`
      );
    }
    try {
      const diag = await fetchLocalJson(port, '/api/saas/diagnostics', 1200);
      if (diag && Array.isArray(diag.tables)) {
        return diag;
      }
    } catch (err) {
      lastErr = err?.message || String(err);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Backend diagnostics timed out after ${maxWaitMs}ms (${lastErr || 'no response'})`);
}

function startBackendProcess(port, dataDir) {
  if (!fs.existsSync(SERVER_ENTRY)) {
    throw new Error(`Missing bundled server entrypoint: ${SERVER_ENTRY}`);
  }
  const logPath = path.join(dataDir, 'desktop_backend.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n[${new Date().toISOString()}] Forking server on 127.0.0.1:${port}\n`);

  const child = utilityProcess.fork(SERVER_ENTRY, [], {
    serviceName: 'tsp-pro-backend',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      TSP_BIND_HOST: '127.0.0.1',
      TSP_DATA_DIR: dataDir,
      TSP_APP_ROOT: APP_ROOT,
      TSP_DIST_DIR: DIST_DIR,
      TSP_ELECTRON_SHELL: '1',
      TSP_DESKTOP_BIN: process.execPath,
    },
    stdio: 'pipe',
  });

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      try {
        logStream.write(chunk);
      } catch {
        // ignore log write errors
      }
    });
  }
  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      try {
        logStream.write(chunk);
      } catch {
        // ignore log write errors
      }
      if (isSmokeTest) {
        process.stderr.write(chunk);
      }
    });
  }

  child.once('exit', (code) => {
    try {
      logStream.write(`[${new Date().toISOString()}] Backend exited with code ${code}\n`);
      logStream.end();
    } catch {
      // ignore
    }
    if (serverProc === child) {
      serverProc = null;
    }
  });

  serverProc = child;
  return child;
}

function stopBackendProcess() {
  if (ownsBackend && serverProc) {
    try {
      serverProc.kill();
    } catch {
      // ignore
    }
    serverProc = null;
    ownsBackend = false;
  }
  if (smokeTmpDir && fs.existsSync(smokeTmpDir)) {
    try {
      fs.rmSync(smokeTmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    smokeTmpDir = null;
  }
}

function bringWindowToFront(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  if (isWin && !isAlwaysOnTop) {
    win.setAlwaysOnTop(true);
    win.focus();
    win.setAlwaysOnTop(false);
  } else {
    win.focus();
  }
}

function navigateToTab(tab) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  bringWindowToFront(mainWindow);
  const targetUrl = `http://127.0.0.1:${serverPort}/?client=desktop&tab=${encodeURIComponent(tab)}`;
  void mainWindow.loadURL(targetUrl);
}

function isAllowedLocalUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return (
      u.protocol === 'http:' &&
      (u.hostname === '127.0.0.1' || u.hostname === 'localhost') &&
      Number(u.port || 80) === serverPort
    );
  } catch {
    return false;
  }
}

function buildAppMenu() {
  const quickJumpSubmenu = [
    { label: 'F1 行情看板', accelerator: 'CmdOrCtrl+1', click: () => navigateToTab('dashboard') },
    { label: 'F10 PandaAI × 期货PM', accelerator: 'CmdOrCtrl+2', click: () => navigateToTab('panda-pm') },
    { label: 'F12 认知定价 / CPO 传导', accelerator: 'CmdOrCtrl+3', click: () => navigateToTab('consensus-cpo') },
    { label: '宏观 | 确定买点 / 付鹏 FICC', accelerator: 'CmdOrCtrl+4', click: () => navigateToTab('fact-fupeng') },
    { label: '实盘 | OMS 实盘交易柜台与 SaaS', accelerator: 'CmdOrCtrl+5', click: () => navigateToTab('saas-desk') },
    { type: 'separator' },
    { label: '拆窗副屏: 确定买点 & 付鹏 FICC', click: () => openPopoutWindow('fact-fupeng', false) },
    { label: '拆窗副屏: OMS 实盘交易柜台', click: () => openPopoutWindow('saas-desk', false) },
    { label: '拆窗副屏: F12 CPO 传导中枢', click: () => openPopoutWindow('consensus-cpo', false) },
  ];

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: '关于 TICK STOCK PANEL Pro' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide', label: '隐藏窗口' },
              { role: 'hideOthers', label: '隐藏其他' },
              { role: 'unhide', label: '全部显示' },
              { type: 'separator' },
              {
                label: '退出终端',
                accelerator: 'Command+Q',
                click: () => {
                  isQuitting = true;
                  app.quit();
                },
              },
            ],
          },
        ]
      : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '工作台导航',
      submenu: quickJumpSubmenu,
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新界面' },
        { role: 'forceReload', label: '强制刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupTray() {
  if (isSmokeTest || tray) return;
  try {
    const chosenPath = isWin
      ? fs.existsSync(ICON_PATH)
        ? ICON_PATH
        : TRAY_ICON_PATH
      : fs.existsSync(TRAY_ICON_PATH)
      ? TRAY_ICON_PATH
      : ICON_PATH;
    let img = nativeImage.createFromPath(chosenPath);
    if (isMac) {
      img = img.resize({ width: 18, height: 18 });
    }
    tray = new Tray(img);
    tray.setToolTip('TICK STOCK PANEL Pro · 万得级A股期货FICC终端');

    const updateTrayMenu = () => {
      const ctx = Menu.buildFromTemplate([
        { label: '显示主工作台', click: () => navigateToTab('dashboard') },
        { label: '直达 确定买点 & 付鹏24h宏观FICC台', click: () => navigateToTab('fact-fupeng') },
        { label: '直达 F12 认知定价 / CPO 传导', click: () => navigateToTab('consensus-cpo') },
        { label: '直达 F10 PandaAI × 期货PM', click: () => navigateToTab('panda-pm') },
        { label: '直达 OMS 实盘交易柜台 / SaaS', click: () => navigateToTab('saas-desk') },
        { type: 'separator' },
        { label: '副屏拆窗: 确定买点 & 付鹏 FICC', click: () => openPopoutWindow('fact-fupeng', false) },
        { label: '副屏拆窗: OMS 实盘交易柜台', click: () => openPopoutWindow('saas-desk', false) },
        { label: '副屏拆窗: F12 CPO 传导中枢', click: () => openPopoutWindow('consensus-cpo', false) },
        { type: 'separator' },
        {
          label: '窗口置顶 (Always on Top)',
          type: 'checkbox',
          checked: isAlwaysOnTop,
          click: () => {
            isAlwaysOnTop = !isAlwaysOnTop;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setAlwaysOnTop(isAlwaysOnTop);
            }
            updateTrayMenu();
          },
        },
        { type: 'separator' },
        {
          label: '退出 TSP Pro',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ]);
      tray.setContextMenu(ctx);
    };

    updateTrayMenu();
    tray.on('double-click', () => {
      bringWindowToFront(mainWindow);
    });
  } catch {
    // Non-fatal if OS desktop environment lacks system tray
  }
}

const popoutWindows = new Set();

function openPopoutWindow(tab = 'fact-fupeng', alwaysOnTop = false) {
  if (!serverPort || isSmokeTest) return null;
  const safeTab = typeof tab === 'string' && tab.trim() ? tab.trim() : 'fact-fupeng';
  const pop = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#090c10',
    title: `TICK STOCK PANEL Pro · 独立副屏 (${safeTab})`,
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    autoHideMenuBar: !isMac,
    alwaysOnTop: Boolean(alwaysOnTop),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  pop.webContents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//i.test(url) && !isAllowedLocalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  pop.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedLocalUrl(url) && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  pop.once('ready-to-show', () => {
    pop.show();
  });

  pop.on('closed', () => {
    popoutWindows.delete(pop);
  });

  popoutWindows.add(pop);
  const popUrl = `http://127.0.0.1:${serverPort}/?client=desktop&popout=1&tab=${encodeURIComponent(safeTab)}`;
  void pop.loadURL(popUrl);
  return pop;
}

function createMainWindow(port, initialTab = 'fact-fupeng', loadImmediately = true) {
  const win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    show: !isSmokeTest,
    backgroundColor: '#090c10',
    title: 'TICK STOCK PANEL Pro (v1.2.0-enterprise)',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    autoHideMenuBar: !isMac,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//i.test(url) && !isAllowedLocalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedLocalUrl(url) && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  mainWindow = win;
  if (!isSmokeTest) {
    bringWindowToFront(win);
  }

  if (loadImmediately) {
    const startUrl = `http://127.0.0.1:${port}/?client=desktop${
      initialTab ? `&tab=${encodeURIComponent(initialTab)}` : ''
    }`;
    void win.loadURL(startUrl);
  } else if (!isSmokeTest) {
    const bootHtml = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#090c10;color:#dfe6f0;font-family:Consolas,monospace;display:flex;align-items:center;justify-content:center}.box{border:1px solid #222832;background:#0e1117;padding:24px 32px;min-width:440px}.tag{background:#ff8800;color:#090c10;font-weight:700;padding:2px 8px;display:inline-block;margin-bottom:12px;font-size:12px}.msg{color:#e5b567;font-size:13px}.sub{color:#7d8796;font-size:11px;margin-top:8px}</style></head><body><div class="box"><div class="tag">W·TSP 终端 v1.2.0-enterprise</div><div class="msg">正在挂载本地 SQLite WAL 实盘引擎与五路抓取守护...</div><div class="sub">127.0.0.1 · 机构量化决策与 OMS 实盘执行中枢</div></div></body></html>`;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(bootHtml)}`);
  }
  return win;
}

ipcMain.handle('tsp:toggle-always-on-top', () => {
  isAlwaysOnTop = !isAlwaysOnTop;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(isAlwaysOnTop);
  }
  return isAlwaysOnTop;
});

ipcMain.handle('tsp:open-external', async (_evt, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.on('tsp:navigate-tab', (_evt, tab) => {
  if (typeof tab === 'string' && tab.trim()) {
    navigateToTab(tab.trim());
  }
});

ipcMain.handle('tsp:open-popout', (_evt, arg) => {
  const tab = typeof arg === 'string' ? arg : arg?.tab || 'fact-fupeng';
  const alwaysOnTop = typeof arg === 'object' ? Boolean(arg?.alwaysOnTop) : false;
  const win = openPopoutWindow(tab, alwaysOnTop);
  return Boolean(win);
});

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    bringWindowToFront(mainWindow);
  } else if (serverPort && !isSmokeTest) {
    createMainWindow(serverPort, 'fact-fupeng', true);
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopBackendProcess();
});

app.on('window-all-closed', () => {
  if (!isMac || isSmokeTest || isQuitting) {
    stopBackendProcess();
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow && !isSmokeTest) {
    createMainWindow(serverPort);
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
});

async function bootstrap() {
  try {
    const win = createMainWindow(3130, 'fact-fupeng', false);
    let diag = await tryReuseHealthyBackend(3130);
    if (diag) {
      serverPort = 3130;
      ownsBackend = false;
    } else {
      const dataDir = getWritableDataDir();
      serverPort = await pickAvailablePort();
      ownsBackend = true;
      startBackendProcess(serverPort, dataDir);
      diag = await waitForBackendReady(serverPort, 20000);
    }

    buildAppMenu();
    setupTray();

    if (isSmokeTest) {
      let finished = false;
      const smokeTimeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        console.error('ELECTRON_SMOKE_TEST=FAIL reason=did-finish-load-timeout');
        stopBackendProcess();
        app.exit(1);
      }, 15000);

      win.webContents.once('did-fail-load', (_e, code, desc) => {
        if (finished) return;
        finished = true;
        clearTimeout(smokeTimeout);
        console.error(`ELECTRON_SMOKE_TEST=FAIL reason=did-fail-load:${code}:${desc}`);
        stopBackendProcess();
        app.exit(1);
      });

      win.webContents.on('did-finish-load', () => {
        if (finished) return;
        const currentUrl = win.webContents.getURL();
        if (!currentUrl.startsWith(`http://127.0.0.1:${serverPort}`)) return;
        setTimeout(() => {
          if (finished) return;
          finished = true;
          clearTimeout(smokeTimeout);
          const tableCount = Array.isArray(diag.tables) ? diag.tables.length : 0;
          console.log(
            `ELECTRON_SMOKE_TEST=PASS port=${serverPort} tables=${tableCount} wal=${diag.journalMode} version=${diag.version} platform=${process.platform}`
          );
          stopBackendProcess();
          app.exit(0);
        }, 400);
      });
    }

    const startUrl = `http://127.0.0.1:${serverPort}/?client=desktop&tab=fact-fupeng`;
    void win.loadURL(startUrl);
  } catch (err) {
    console.error(`TSP_ELECTRON_BOOT_ERROR: ${err?.stack || err}`);
    if (!isSmokeTest) {
      try {
        dialog.showErrorBox('TICK STOCK PANEL Pro 启动异常', String(err?.stack || err));
      } catch {
        // ignore dialog failure
      }
    }
    stopBackendProcess();
    app.exit(1);
  }
}

if (hasSingleInstanceLock) {
  void app.whenReady().then(bootstrap);
}
