/**
 * Partner authentication for the MCP servers.
 *
 * The Share a Wish backend (make-server + public-api "/me/*") authenticates with a Supabase user JWT.
 * Four ways to provide it, checked in this order:
 *   1. SHAREAWISH_TOKEN          – a personal access token (saw_pat_…) created in the Partner Portal. Recommended.
 *   2. SHAREAWISH_ACCESS_TOKEN   – a ready session access token (expires after ~1h; no refresh possible)
 *   3. SHAREAWISH_EMAIL + SHAREAWISH_PASSWORD – password sign-in via Supabase Auth (GoTrue), auto-refreshed
 *   4. SHAREAWISH_REFRESH_TOKEN  – refresh-token grant (paired with the anon key), auto-refreshed
 * Nothing is persisted to disk.
 */

export const SUPABASE_URL = process.env.SHAREAWISH_SUPABASE_URL || 'https://nqwfhjycwrtukfszuofi.supabase.co';
export const SUPABASE_ANON_KEY =
  process.env.SHAREAWISH_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xd2Zoanljd3J0dWtmc3p1b2ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc2NTgwMjAsImV4cCI6MjA3MzIzNDAyMH0.l61k6jJG6OSA_2TzZCCH_n2B9ezt70oJO1ujhK98T48';

export const PARTNER_API_BASE = (process.env.SHAREAWISH_PARTNER_API_BASE || `${SUPABASE_URL}/functions/v1/make-server-a95d4185`).replace(/\/$/, '');
export const PUBLIC_API_BASE = (process.env.SHAREAWISH_API_BASE || `${SUPABASE_URL}/functions/v1/public-api`).replace(/\/$/, '');

type Session = { accessToken: string; refreshToken?: string; expiresAt: number; email?: string; userId?: string };

let session: Session | null = null;

export class AuthError extends Error {
  constructor(message: string) { super(message); this.name = 'AuthError'; }
}

function decodeJwtExp(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : Date.now() + 55 * 60 * 1000;
  } catch { return Date.now() + 55 * 60 * 1000; }
}

async function gotrue(grant: 'password' | 'refresh_token', body: Record<string, string>): Promise<Session> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !json.access_token) {
    const msg = (json.error_description || json.msg || json.error || res.statusText) as string;
    throw new AuthError(`Supabase sign-in failed (${res.status}): ${msg}`);
  }
  const user = (json.user || {}) as Record<string, unknown>;
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: decodeJwtExp(String(json.access_token)),
    email: user.email ? String(user.email) : undefined,
    userId: user.id ? String(user.id) : undefined,
  };
}

export const PAT_PREFIX = 'saw_pat_';

export function authConfigured(): boolean {
  return Boolean(process.env.SHAREAWISH_TOKEN || process.env.SHAREAWISH_ACCESS_TOKEN || (process.env.SHAREAWISH_EMAIL && process.env.SHAREAWISH_PASSWORD) || process.env.SHAREAWISH_REFRESH_TOKEN);
}

export function authHelp(): string {
  return [
    'No partner credentials configured. Set one of:',
    '  SHAREAWISH_TOKEN                         (recommended – personal access token from Partner Portal → Account Settings → Access tokens & AI agents)',
    '  SHAREAWISH_EMAIL + SHAREAWISH_PASSWORD   (your Partner Portal login; local use only)',
    '  SHAREAWISH_ACCESS_TOKEN                  (a Supabase session access token, valid ~1 hour)',
    '  SHAREAWISH_REFRESH_TOKEN                 (refresh token from a Partner Portal session)',
    'in the MCP server environment (e.g. the "env" block of your MCP client config), then restart the server.',
  ].join('\n');
}

/** Returns a valid access token, signing in / refreshing as needed. */
export async function getAccessToken(force = false): Promise<string> {
  const pat = process.env.SHAREAWISH_TOKEN?.trim();
  if (pat) {
    if (!pat.startsWith(PAT_PREFIX)) throw new AuthError(`SHAREAWISH_TOKEN must start with ${PAT_PREFIX} (create one in the Partner Portal under Account Settings → Access tokens & AI agents).`);
    session = { accessToken: pat, expiresAt: Number.MAX_SAFE_INTEGER, userId: undefined };
    return pat;
  }
  if (!force && session && session.expiresAt - Date.now() > 60_000) return session.accessToken;

  if (process.env.SHAREAWISH_ACCESS_TOKEN && !session?.refreshToken) {
    const token = process.env.SHAREAWISH_ACCESS_TOKEN;
    session = { accessToken: token, expiresAt: decodeJwtExp(token) };
    if (session.expiresAt < Date.now()) throw new AuthError('SHAREAWISH_ACCESS_TOKEN has expired. Provide a fresh token or use SHAREAWISH_EMAIL/SHAREAWISH_PASSWORD.');
    return token;
  }
  if (session?.refreshToken) {
    try { session = await gotrue('refresh_token', { refresh_token: session.refreshToken }); return session.accessToken; } catch { /* fall through to password */ }
  }
  if (process.env.SHAREAWISH_EMAIL && process.env.SHAREAWISH_PASSWORD) {
    session = await gotrue('password', { email: process.env.SHAREAWISH_EMAIL, password: process.env.SHAREAWISH_PASSWORD });
    return session.accessToken;
  }
  if (process.env.SHAREAWISH_REFRESH_TOKEN) {
    session = await gotrue('refresh_token', { refresh_token: process.env.SHAREAWISH_REFRESH_TOKEN });
    return session.accessToken;
  }
  throw new AuthError(authHelp());
}

export function currentSessionInfo(): { email?: string; userId?: string; expiresAt?: string } {
  if (!session) return {};
  if (process.env.SHAREAWISH_TOKEN) return { email: undefined, userId: undefined, expiresAt: undefined };
  return { email: session.email, userId: session.userId, expiresAt: new Date(session.expiresAt).toISOString() };
}
