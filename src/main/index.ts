import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { openDatabase, type DB } from './store/db'
import { MIGRATIONS } from './store/migrations'
import { listApplications } from './store/applications'
import { createTray, destroyTray, updateTrayTooltip } from './tray'

let mainWindow: BrowserWindow | null = null
let db: DB | null = null
/** Set on the way out so close-to-tray knows this time is the real thing. */
let quitting = false
/**
 * Launched by Windows at login rather than by you, so start quietly in the tray.
 * Consumed by the first window only; opening from the tray later always shows it.
 */
let startHidden = process.argv.includes('--hidden')

/**
 * A second launch must not start a rival syncer against the same database,
 * so the first instance keeps the lock and later ones just surface its window.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  void app.whenReady().then(start)
}

function start(): void {
  const dbPath = join(app.getPath('userData'), 'tracker.db')
  db = openDatabase(dbPath, MIGRATIONS)
  console.log(`[startup] database ready at ${dbPath}`)

  createTray({
    onOpen: showWindow,
    onSyncNow: () => {
      // Wired up in stage 4; the menu entry exists now so the tray is testable.
      console.log('[sync] requested — not implemented until the sync engine lands')
    },
    onQuit: () => {
      quitting = true
      app.quit()
    }
  })
  updateTrayTooltip('Job Tracker — not yet syncing')
  console.log('[startup] tray created')

  registerIpc()
  createWindow()

  // What keeps the app alive across reboots, in place of an external supervisor.
  // `openAsHidden` is macOS-only, so Windows gets an argument the app checks itself.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    title: 'Job Tracker',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const showOnReady = !startHidden
  startHidden = false
  mainWindow.on('ready-to-show', () => {
    if (showOnReady) mainWindow?.show()
  })

  // Closing the window hides it; only the tray's Quit actually exits.
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) void mainWindow.loadURL(devServer)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (!mainWindow.isVisible()) mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function registerIpc(): void {
  ipcMain.handle('applications:list', () => (db ? listApplications(db) : []))
  ipcMain.handle('app:status', () => ({
    lastSyncedAt: null as number | null,
    dbPath: join(app.getPath('userData'), 'tracker.db')
  }))
}

// The tray is the app's real lifetime, so closing every window must not quit
// it — on any platform. This deliberately omits the usual darwin check.
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  quitting = true
})

app.on('will-quit', () => {
  destroyTray()
  db?.close()
})
