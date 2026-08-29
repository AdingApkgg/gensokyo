import type { AppType } from '@gensokyo/api'
import { hc } from 'hono/client'

export const createClient = (baseUrl: string) => hc<AppType>(baseUrl)
export type ApiClient = ReturnType<typeof createClient>
