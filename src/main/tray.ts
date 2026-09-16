import { Menu, Tray, app, nativeImage } from 'electron'
import { join } from 'node:path'

export interface TrayHandlers {
  onOpen: () => void
  onSyncNow: () => void
  onQuit: () => void
}

/** Held at module scope: a Tray that gets garbage-collected vanishes from the taskbar. */
let tray: Tray | null = null
let paused = false

function iconPath(): string {
  // Packaged builds ship resources beside the app; dev reads them from the repo.
  return app.isPackaged
    ? join(process.resourcesPath, 'tray.png')
    : join(__dirname, '../../resources/tray.png')
}

export function createTray(handlers: TrayHandlers): Tray {
  const icon = nativeImage.createFromPath(iconPath())
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }))

  const rebuildMenu = (): void => {
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Job Tracker', click: handlers.onOpen },
        { type: 'separator' },
        { label: 'Sync now', click: handlers.onSyncNow, enabled: !paused },
        {
          label: paused ? 'Resume syncing' : 'Pause syncing',
          click: () => {
            paused = !paused
            rebuildMenu()
          }
        },
        { type: 'separator' },
        { label: 'Quit', click: handlers.onQuit }
      ])
    )
  }

  rebuildMenu()
  // Single click is the Windows convention for bringing a tray app forward.
  tray.on('click', handlers.onOpen)
  return tray
}

export function isSyncPaused(): boolean {
  return paused
}

export function updateTrayTooltip(text: string): void {
  tray?.setToolTip(text)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
