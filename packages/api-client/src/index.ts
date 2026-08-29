import type { AppType } from '@gensokyo/api'
import { hc } from 'hono/client'

export const createClient = (
  baseUrl: string,
  options?: { headers?: Record<string, string> },
) => hc<AppType>(baseUrl, options?.headers ? { headers: options.headers } : {})

export type ApiClient = ReturnType<typeof createClient>
