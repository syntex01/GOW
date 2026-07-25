'use strict'

const { contextBridge } = require('electron')

/**
 * The game needs nothing from the host beyond knowing it is running as a
 * desktop app, so this exposes exactly one read-only flag and nothing else.
 * No filesystem, no IPC surface, no network.
 */
contextBridge.exposeInMainWorld('gowDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron
})
