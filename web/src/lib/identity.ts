import { supabase } from './supabase'

/**
 * WS/REST identity. Supabase session first; otherwise the per-tab dev
 * identity from ?dev=<email> (server must run DEV_AUTH=1 to accept it).
 */
export type Identity = { token: string; name: string }

export const devEmail = () => new URLSearchParams(location.search).get('dev')

export async function authIdentity(): Promise<Identity | null> {
  const sb = supabase()
  if (sb) {
    const { data } = await sb.auth.getSession()
    const token = data.session?.access_token
    if (token && data.session) {
      const name = data.session.user.email?.split('@')[0]
      return { token, name: name || 'player' }
    }
  }
  const dev = devEmail()
  if (dev) return { token: `dev:${dev}`, name: dev.split('@')[0] || 'player' }
  return null
}
