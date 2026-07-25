// @ts-check
'use strict'

const { app, BrowserWindow, Menu, session, shell, screen } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

/**
 * GOW desktop shell.
 *
 * The game is a fully self-contained static bundle, so this window loads it
 * straight off disk with `file://`. There is no local server, no network
 * listener and no backend of any kind — the app works with the machine
 * completely offline.
 */

// The game talks to nothing. Turn off Chromium's background services so the
// app makes no network requests at all unless the player starts a peer-to-peer
// multiplayer session.
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('disable-domain-reliability')
app.commandLine.appendSwitch('metrics-recording-only')
app.commandLine.appendSwitch('no-pings')
app.commandLine.appendSwitch(
  'disable-features',
  'Translate,MediaRouter,OptimizationHints,AutofillServerCommunication'
)

const isDev = !app.isPackaged
const GAME_ENTRY = isDev
  ? path.join(__dirname, '..', 'dist', 'index.html')
  : path.join(process.resourcesPath, 'game', 'index.html')

/** Design resolution; the window keeps this aspect ratio. */
const DESIGN_WIDTH = 1280
const DESIGN_HEIGHT = 720

/** @type {BrowserWindow | null} */
let mainWindow = null

function createWindow() {
  // Open at the largest 16:9 size that comfortably fits the display.
  const work = screen.getPrimaryDisplay().workAreaSize
  const scale = Math.min(1, Math.min(work.width / (DESIGN_WIDTH + 40), work.height / (DESIGN_HEIGHT + 80)))
  const width = Math.round(DESIGN_WIDTH * scale)
  const height = Math.round(DESIGN_HEIGHT * scale)

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 450,
    backgroundColor: '#05070d',
    title: 'GOW — Gears of War Through the Ages',
    icon: path.join(__dirname, 'icons', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      // The page is our own static bundle and needs no Node access.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (!fs.existsSync(GAME_ENTRY)) {
    mainWindow.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="background:#05070d;color:#e9eefb;font:16px sans-serif;padding:40px">' +
            '<h1>Build missing</h1><p>Run <code>npm run build</code> first.</p></body>'
        )
    )
    return
  }

  mainWindow.loadFile(GAME_ENTRY)

  // Anything that is not the game itself opens in the user's real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
}

/**
 * Hard guarantee that the desktop build talks to no server. Everything the
 * game needs is on disk, so any http(s) request is either Chromium background
 * chatter or a mistake, and both are blocked outright.
 *
 * WebRTC is deliberately unaffected: peer-to-peer multiplayer negotiates over
 * ICE, not the URL loader, so blocking here costs nothing.
 */
function enforceOffline() {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    if (isDev) console.warn('[gow] blocked outbound request:', details.url)
    callback({ cancel: true })
  })
}

function buildMenu() {
  const template = [
    {
      label: 'Game',
      submenu: [
        {
          label: 'Toggle Fullscreen',
          accelerator: 'F11',
          click: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen())
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(/** @type {any} */ (template)))
}

// A single instance keeps one save file authoritative.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    enforceOffline()
    buildMenu()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
