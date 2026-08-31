import { supabase } from "./supabase";

/**
 * WS/REST identity. Supabase session first; then the per-tab dev identity
 * from ?dev=<email> (server must run DEV_AUTH=1); otherwise a guest token
 * minted by the server (POST /api/auth/guest) so anyone with a share link
 * can join. Guest display name is chosen in the join modal.
 */
export type Identity = { token: string; name: string; isGuest: boolean };

const GUEST_TOKEN_KEY = "riverrats.guest.token";
const GUEST_NAME_KEY = "riverrats.guest.name";

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export const devEmail = () => new URLSearchParams(location.search).get("dev");

export const guestName = () => localStorage.getItem(GUEST_NAME_KEY) ?? "";

export function rememberGuestName(name: string) {
  localStorage.setItem(GUEST_NAME_KEY, name);
}

async function guestToken(): Promise<string | null> {
  if (!API_URL) return null;
  const saved = localStorage.getItem(GUEST_TOKEN_KEY);
  if (saved) return saved;
  const res = await fetch(`${API_URL}/api/auth/guest`, { method: "POST" });
  if (!res.ok) return null;
  const { token } = (await res.json()) as { token: string };
  localStorage.setItem(GUEST_TOKEN_KEY, token);
  return token;
}

export async function authIdentity(): Promise<Identity | null> {
  const sb = supabase();
  if (sb) {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (token && data.session) {
      const name = data.session.user.email?.split("@")[0];
      return { token, name: name || "player", isGuest: false };
    }
  }
  const dev = devEmail();
  if (dev) return { token: `dev:${dev}`, name: dev.split("@")[0] || "player", isGuest: true };
  const token = await guestToken();
  return token ? { token, name: guestName(), isGuest: true } : null;
}
