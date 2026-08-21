/*
 * JARVIS — главный процесс Electron.
 * Окно-HUD, иконка в трее, глобальная горячая клавиша Alt+J.
 */
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  nativeImage,
  session,
} = require('electron');
const path = require('path');

let win = null;
let tray = null;
app.isQuiting = false;

// ---- одна копия приложения ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    frame: false,
    backgroundColor: '#060a13',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false, // таймеры и прослушка работают в фоне
      webSecurity: false, // локальное приложение: разрешаем fetch модели речи и погоды
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Крестик прячет в трей, а не закрывает
  win.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, 'assets', 'icon.png'))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('JARVIS — Alt+J');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Показать / скрыть (Alt+J)', click: toggleWindow },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => {
          app.isQuiting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', toggleWindow);
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.bleakcatyt.jarvis'); // уведомления Windows

  // разрешаем микрофон без вопросов
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === 'media' || permission === 'notifications');
  });

  createWindow();
  createTray();

  globalShortcut.register('Alt+J', toggleWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  // держим приложение живым в трее (кроме macOS-поведения)
  if (app.isQuiting) app.quit();
});

// ---- IPC от рендера ----
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:hide', () => win && win.hide());
ipcMain.on('app:quit', () => {
  app.isQuiting = true;
  app.quit();
});

// Спрятать окно на время скриншота и показать обратно
ipcMain.handle('win:conceal', async (e, ms) => {
  if (!win) return;
  const wasVisible = win.isVisible();
  if (wasVisible) win.hide();
  await new Promise((r) => setTimeout(r, ms || 400));
  return wasVisible;
});
ipcMain.on('win:reveal', () => win && win.show());

// Пути системных папок
ipcMain.handle('app:paths', () => ({
  userData: app.getPath('userData'),
  home: app.getPath('home'),
  downloads: app.getPath('downloads'),
  documents: app.getPath('documents'),
  desktop: app.getPath('desktop'),
  pictures: app.getPath('pictures'),
  music: app.getPath('music'),
  videos: app.getPath('videos'),
}));
