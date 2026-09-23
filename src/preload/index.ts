import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron'
import type { MockollaApi } from '../shared/api.ts'
import { CH } from '../shared/channels.ts'

const invoke =
  (ch: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(ch, ...args)

function listen<T>(ch: string) {
  return (cb: (v: T) => void) => {
    const fn = (_e: IpcRendererEvent, v: T) => cb(v)
    ipcRenderer.on(ch, fn)
    return () => {
      ipcRenderer.off(ch, fn)
    }
  }
}

const api: MockollaApi = {
  getState: invoke(CH.getState),
  start: invoke(CH.start),
  stop: invoke(CH.stop),
  restart: invoke(CH.restart),
  saveConfig: invoke(CH.saveConfig),
  applyPreset: invoke(CH.applyPreset),
  saveRules: invoke(CH.saveRules),
  defaultRules: invoke(CH.defaultRules),
  deleteRecordings: invoke(CH.deleteRecordings),
  testRules: invoke(CH.testRules),
  injectFault: invoke(CH.injectFault),
  clearFaults: invoke(CH.clearFaults),
  resetStats: invoke(CH.resetStats),
  exportRequests: invoke(CH.exportRequests),
  playground: invoke(CH.playground),
  cancelPlayground: invoke(CH.cancelPlayground),
  loadGen: invoke(CH.loadGen),
  stopLoadGen: invoke(CH.stopLoadGen),
  openFolder: invoke(CH.openFolder),
  copy: invoke(CH.copy),
  setTheme: invoke(CH.setTheme),
  onSnapshot: listen(CH.snapshot),
  onStatus: listen(CH.status),
  onPlayground: listen(CH.playgroundEvent),
  onLoadGen: listen(CH.loadGenStatus),
  onRecordings: listen(CH.recordings),
  onConfig: listen(CH.config),
  onRules: listen(CH.rules),
} as MockollaApi

contextBridge.exposeInMainWorld('mockolla', api)
