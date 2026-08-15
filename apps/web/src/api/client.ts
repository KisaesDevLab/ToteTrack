export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
/** Fired whenever any API call returns 401 so the auth gate can redirect to login. */
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** FormData bodies are sent as-is (multipart). */
  formData?: FormData;
  signal?: AbortSignal;
  /** Suppress the global 401 → login redirect (used by auth endpoints themselves). */
  silent401?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.formData) body = opts.formData;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, {
    method: opts.method ?? (body ? 'POST' : 'GET'),
    headers,
    body,
    credentials: 'same-origin',
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const payload = ct.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text();
  if (!res.ok) {
    const err =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error: { code: string; message: string; details?: unknown } }).error
        : null;
    if (res.status === 401 && !opts.silent401) unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(
      res.status,
      err?.code ?? 'http_error',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  return payload as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T = void>(path: string) => api<T>(path, { method: 'DELETE' });

/** Downloads a file (PDF/CSV) via POST/GET and triggers the browser save. */
export async function download(
  path: string,
  opts: { method?: string; body?: unknown; filename?: string } = {},
): Promise<void> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    if (res.status === 401) unauthorizedListeners.forEach((fn) => fn());
    let message = `Download failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) message = j.error.message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, 'download_failed', message);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename="?([^";]+)"?/.exec(cd);
  const filename = opts.filename ?? m?.[1] ?? 'download';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
