/// <reference types="vite/client" />

import type { TofeApi } from '@shared/types/ipc'

declare global {
  interface Window {
    toefl: TofeApi
  }
}

export {}
