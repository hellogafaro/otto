import { mock } from 'bun:test'
import type { HandlerDeps } from '@otto/server-core/handlers'
import type { GuiDeps } from '../handler-deps'

/** Importing this file stubs the `electron` module, so the handlers can be loaded under bun test. */
mock.module('electron', () => ({
  ipcMain: {
    handle: () => {},
    on: () => {},
  },
  app: {
    isPackaged: false,
    getAppPath: () => '/',
    quit: () => {},
    dock: { setIcon: () => {}, setBadge: () => {} },
  },
  nativeTheme: { shouldUseDarkColors: false },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromDataURL: () => ({}),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 0 }),
  },
  shell: {
    openExternal: async () => {},
    openPath: async () => '',
    showItemInFolder: () => {},
  },
  BrowserWindow: {
    fromWebContents: () => null,
    getFocusedWindow: () => null,
    getAllWindows: () => [],
  },
  Menu: {
    buildFromTemplate: () => ({ popup: () => {} }),
  },
  session: {},
  powerSaveBlocker: { start: () => 0, stop: () => {}, isStarted: () => false },
}))

/** Main's handler dependencies that do nothing: enough to register every GUI handler. */
export function createMockGuiDeps(): GuiDeps {
  return {
    windowManager: {} as GuiDeps['windowManager'],
  }
}

/** The server's handler dependencies that do nothing: enough to register every core handler. */
export function createMockServerDeps(): HandlerDeps {
  return {
    sessionManager: {} as HandlerDeps['sessionManager'],
    platform: {
      appRootPath: '',
      resourcesPath: '',
      isPackaged: false,
      appVersion: '0.0.0-test',
      isDebugMode: true,
      logger: console,
      imageProcessor: {
        getMetadata: async () => null,
        process: async () => Buffer.from(''),
      },
    },
    oauthFlowStore: {
      store: () => {},
      getByState: () => null,
      remove: () => {},
      cleanup: () => {},
      dispose: () => {},
      size: 0,
    } as unknown as HandlerDeps['oauthFlowStore'],
  }
}
