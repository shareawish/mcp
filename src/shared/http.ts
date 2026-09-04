import { getAccessToken, AuthError } from './auth.js';

export class ApiError extends Error {
  constructor(public status: number, public url: string, public body: unknown) {
    super(`HTTP ${status} ${url}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'ApiError';
  }
  get code(): string | undefined {
    const b = this.body as { error?: unknown; code?: unknown } | null;
    if (b && typeof b === 'object') { const e = b.error ?? b.code; return typeof e === 'string' ? e : undefined; }
    return undefined;
  }
}

type Auth = 'user' | 'none' | { bearer: string };

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function headersFor(auth: Auth, extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const h: Record<string, string> = { Accept: 'application/json', ...extra };
  if (auth === 'user') h.Authorization = `Bearer ${await getAccessToken()}`;
  else if (typeof auth === 'object') h.Authorization = `Bearer ${auth.bearer}`;
  return h;
}

/** JSON request with one automatic retry on 401 (re-login). */
export async function request<T = unknown>(method: string, url: string, opts: { body?: unknown; auth?: Auth; query?: Record<string, string | number | boolean | undefined>; headers?: Record<string, string> } = {}): Promise<{ data: T; headers: Headers }> {
  const auth = opts.auth ?? 'user';
  const u = new URL(url);
  for (const [k, v] of Object.entries(opts.query || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  const doFetch = async (): Promise<Response> => {
    const headers = await headersFor(auth, opts.headers);
    let body: BodyInit | undefined;
    if (opts.body instanceof FormData) body = opts.body;
    else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
    return fetch(u, { method, headers, body });
  };
  let res = await doFetch();
  if (res.status === 401 && auth === 'user') {
    try { await getAccessToken(true); res = await doFetch(); } catch (e) { if (e instanceof AuthError) throw e; }
  }
  const data = await parse(res);
  if (!res.ok) throw new ApiError(res.status, u.toString(), data);
  return { data: data as T, headers: res.headers };
}

export const get = <T = unknown>(url: string, opts?: Parameters<typeof request>[2]) => request<T>('GET', url, opts).then((r) => r.data);
export const post = <T = unknown>(url: string, body?: unknown, opts?: Parameters<typeof request>[2]) => request<T>('POST', url, { ...opts, body }).then((r) => r.data);
export const put = <T = unknown>(url: string, body?: unknown, opts?: Parameters<typeof request>[2]) => request<T>('PUT', url, { ...opts, body }).then((r) => r.data);
export const patch = <T = unknown>(url: string, body?: unknown, opts?: Parameters<typeof request>[2]) => request<T>('PATCH', url, { ...opts, body }).then((r) => r.data);
export const del = <T = unknown>(url: string, opts?: Parameters<typeof request>[2]) => request<T>('DELETE', url, opts).then((r) => r.data);

/** Raw upload (PUT) to a pre-signed storage URL. */
export async function putBinary(url: string, bytes: Uint8Array, contentType: string, extraHeaders: Record<string, string> = {}): Promise<void> {
  const ab = new ArrayBuffer(bytes.byteLength); new Uint8Array(ab).set(bytes);
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType, ...extraHeaders }, body: ab });
  if (!res.ok) throw new ApiError(res.status, url, await parse(res));
}
