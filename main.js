const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// 1. Игнорируем ошибки сертификатов (SSL), чтобы звуки и картинки грузились без сбоев
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');

// 2. Отключаем аппаратное ускорение (решает проблемы с прозрачностью и черным фоном на Windows)
app.disableHardwareAcceleration();

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: width,
    height: height,
    transparent: true,       // Прозрачный фон
    frame: false,            // Без рамок
    alwaysOnTop: true,       // Поверх всех окон
    skipTaskbar: false,      // Показывать в панели задач (чтобы можно было найти)
    hasShadow: false,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false, // Чтобы кот не замирал, когда вы в другом окне
      webSecurity: false           // Разрешаем загрузку внешних ресурсов (звуки/картинки)
    }
  });

  // По умолчанию клики проходят сквозь окно (игнорируются)
  win.setIgnoreMouseEvents(true, { forward: true });

  // Слушаем команды от index.html: если мышь на коте или меню — клик ловим, иначе пропускаем
  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        win.setIgnoreMouseEvents(ignore, options);
    } catch (e) {
        // Игнорируем ошибки, если окно уже закрывается
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});