import { contextBridge, ipcRenderer } from 'electron'
import type { ApplicationRow, DerivedStage } from '../shared/types'

export interface ApplicationWithStage extends ApplicationRow {
  stage: DerivedStage | null
}

export interface AppStatus {
  lastSyncedAt: number | null
  dbPath: string
}

/**
 * The renderer's entire surface area. It gets named, typed calls — never raw
 * ipcRenderer — so a compromised page cannot reach arbitrary main-process channels.
 */
const api = {
  listApplications: (): Promise<ApplicationWithStage[]> => ipcRenderer.invoke('applications:list'),
  getStatus: (): Promise<AppStatus> => ipcRenderer.invoke('app:status')
}

export type TrackerApi = typeof api

contextBridge.exposeInMainWorld('tracker', api)
