const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// Игнорируем ошибки SSL (для загрузки внешних ресурсов)
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');

// Отключаем аппаратное ускорение — решает проблемы с прозрачностью на Windows
app.disableHardwareAcceleration();

function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    const win = new BrowserWindow({
        width,
        height,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: false,
        hasShadow: false,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false,
            webSecurity: false,
        },
    });

    // По умолчанию клики проходят сквозь окно
    win.setIgnoreMouseEvents(true, { forward: true });

    // Управление кликами из renderer-процесса
    ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
        try {
            const senderWin = BrowserWindow.fromWebContents(event.sender);
            if (senderWin) senderWin.setIgnoreMouseEvents(ignore, options);
        } catch {
            // Окно уже закрывается — игнорируем
        }
    });

    win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
