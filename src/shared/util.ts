import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { ApiError } from './http.js';
import { AuthError } from './auth.js';

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

export function ok(data: unknown, note?: string): ToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text: note ? `${note}\n\n${text}` : text }] };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Wrap a tool handler: uniform error reporting (auth, API, network). */
export function guard<A>(fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try { return await fn(args); }
    catch (e) {
      if (e instanceof AuthError) return fail(`Authentication problem: ${e.message}`);
      if (e instanceof ApiError) {
        const hint = HINTS[e.code || ''] || '';
        return fail(`API error ${e.status}${e.code ? ` (${e.code})` : ''} for ${e.url}\n${typeof e.body === 'string' ? e.body : JSON.stringify(e.body, null, 2)}${hint ? `\n\nHint: ${hint}` : ''}`);
      }
      return fail(`Unexpected error: ${(e as Error).message}`);
    }
  };
}

const HINTS: Record<string, string> = {
  unauthorized: 'The session token was rejected. Check SHAREAWISH_EMAIL/SHAREAWISH_PASSWORD or refresh SHAREAWISH_ACCESS_TOKEN.',
  plan_limit_reached: 'The current plan allows only a limited number of ready videos per shop (Creator Free: 5). Hide an existing video or upgrade to Creator Pro.',
  file_too_large: 'Videos are limited to 200 MB (video/mp4 or video/quicktime).',
  object_not_found: 'The file was not found in storage – the upload must complete before the media row is created.',
  origin_not_allowed: 'The origin is not in the key\'s allowlist. Add it with keys_domains_set (or use a pk_test_ key on localhost).',
  allowlist_required: 'Live keys created after 2026-09-01 need at least one allowed domain. Use keys_domains_set.',
  subscription_required: 'The partner\'s trial/subscription has ended – choose a plan in the Partner Portal.',
  unknown_key: 'No API key with that value exists (or it was revoked).',
  no_webhook: 'This basket configuration has no webhookUrl – set one with baskets_update first.',
  cannot_delete_active_used_key: 'Revoke the key first; keys that were used cannot be deleted while active.',
  handle_taken: 'Choose another handle – check availability with shops_check_handle.',
};

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
};

/** Load a file from a local path or an http(s) URL. */
export async function loadBytes(source: string): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShareAWishMCP/0.1)' } });
    if (!res.ok) throw new Error(`Could not download ${source}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
    const name = basename(new URL(source).pathname) || 'file';
    return { bytes, mime: ct || MIME_BY_EXT[extname(name).toLowerCase()] || 'application/octet-stream', name };
  }
  const bytes = new Uint8Array(await readFile(source));
  const name = basename(source);
  return { bytes, mime: MIME_BY_EXT[extname(name).toLowerCase()] || 'application/octet-stream', name };
}

export function slugify(input: string): string {
  return input.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** Copy a Uint8Array into a standalone ArrayBuffer (typed correctly for Blob/fetch). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength); new Uint8Array(ab).set(bytes); return ab;
}

/** Remove undefined values so PUT bodies only carry intended fields. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
