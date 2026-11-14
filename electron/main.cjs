const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {
  app,
  BrowserWindow,
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
let serverPort = 3130;
let isAlwaysOnTop = false;
let isQuitting = false;
let smokeTmpDir = null;

if (isWin) {
  app.setAppUserModelId('com.tspquant.tickstockpanelpro');
}
app.setName('TICK STOCK PANEL Pro');

if (!isSmokeTest) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    process.exit(0);
  }
}

function getWritableDataDir() {
  if (isSmokeTest) {
    smokeTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-pro-smoke-'));
    const d = path.join(smokeTmpDir, 'data');
    fs.mkdirSync(d, { recursive: true });
    return d;
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
  if (serverProc) {
    try {
      serverProc.kill();
    } catch {
      // ignore
    }
    serverProc = null;
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

function navigateToTab(tab) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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
    { label: '实盘 | 模拟舱 / SaaS 控制台', accelerator: 'CmdOrCtrl+5', click: () => navigateToTab('saas-desk') },
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
    let img = nativeImage.createFromPath(
      fs.existsSync(TRAY_ICON_PATH) ? TRAY_ICON_PATH : ICON_PATH
    );
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
        { label: '直达 多租户 SaaS / 模拟实盘舱', click: () => navigateToTab('saas-desk') },
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
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
  } catch {
    // Non-fatal if OS desktop environment lacks system tray
  }
}

function createMainWindow(port, initialTab = 'dashboard') {
  const win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    backgroundColor: '#090c10',
    title: 'TICK STOCK PANEL Pro (v1.1.0-enterprise)',
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

  if (!isSmokeTest) {
    win.once('ready-to-show', () => {
      win.show();
    });
  }

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  mainWindow = win;
  const startUrl = `http://127.0.0.1:${port}/?client=desktop${
    initialTab ? `&tab=${encodeURIComponent(initialTab)}` : ''
  }`;
  void win.loadURL(startUrl);
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

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
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
    const dataDir = getWritableDataDir();
    serverPort = await pickAvailablePort();
    startBackendProcess(serverPort, dataDir);

    const diag = await waitForBackendReady(serverPort, 20000);
    buildAppMenu();
    setupTray();

    const win = createMainWindow(serverPort, 'fact-fupeng');

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

      win.webContents.once('did-finish-load', () => {
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
  } catch (err) {
    console.error(`TSP_ELECTRON_BOOT_ERROR: ${err?.stack || err}`);
    stopBackendProcess();
    app.exit(1);
  }
}

void app.whenReady().then(bootstrap);
