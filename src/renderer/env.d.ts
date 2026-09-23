/// <reference types="svelte" />
/// <reference types="vite/client" />
import type { MockollaApi } from '../shared/api.ts'

declare global {
  interface Window {
    mockolla: MockollaApi
  }
  const __APP_VERSION__: string
}
