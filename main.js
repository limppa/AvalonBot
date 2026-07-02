const { app, BrowserWindow, ipcMain } = require('electron')
const fs   = require('fs')
const path = require('path')

// this is to collect information about crashes
function writeLog(msg) {
  const logPath = path.join(app.getPath('userData'), 'crash.log')
  const line    = `[${new Date().toISOString()}] ${msg}\n`
  try { fs.appendFileSync(logPath, line) } catch (_) {}
}

process.on('uncaughtException', err => {
  writeLog(`MAIN uncaughtException: ${err.stack || err}`)
})

ipcMain.on('renderer-error', (_, msg) => {
  writeLog(`RENDERER: ${msg}`)
})

app.whenReady().then(() => {
  const win = new BrowserWindow({
    fullscreen: true,
    backgroundColor: '#080502',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })
  win.loadFile('index.html')
  win.setMenuBarVisibility(false)
})

app.on('window-all-closed', () => app.quit())
