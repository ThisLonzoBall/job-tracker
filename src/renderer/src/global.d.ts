import type { TrackerApi } from '../../preload'

declare global {
  interface Window {
    tracker: TrackerApi
  }
}

export {}
