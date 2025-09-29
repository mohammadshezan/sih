// Centralized client-side configuration for API and Socket URLs
// Use NEXT_PUBLIC_ env vars so they are available in the browser at build/runtime.

// Default to local API in development if not explicitly provided
const configuredApi = process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL.trim() !== ''
  ? process.env.NEXT_PUBLIC_API_URL.trim()
  : (process.env.NODE_ENV !== 'production' ? 'http://localhost:4000' : '');

// At runtime (browser), if API_URL is empty (e.g., production preview without env),
// infer a sensible local fallback based on current origin (e.g., :3000 -> :4000)
function inferRuntimeApi(): string | '' {
  if (configuredApi) return configuredApi;
  if (typeof window === 'undefined') return '';
  try {
    const loc = window.location;
    // If running on 3000, try 4000; else try same host with +1 port; fallback to same origin
    const currentPort = loc.port ? Number(loc.port) : (loc.protocol === 'https:' ? 443 : 80);
    const apiPort = currentPort === 3000 ? 4000 : (currentPort ? currentPort + 1 : 4000);
    return `${loc.protocol}//${loc.hostname}:${apiPort}`;
  } catch { return ''; }
}

export const API_URL = (configuredApi || inferRuntimeApi() || '').replace(/\/$/, '');
export const SOCKET_URL = (process.env.NEXT_PUBLIC_SOCKET_URL || API_URL || '').replace(/\/$/, '');

// Build a full URL from a path, ensuring a single leading slash
export function withBase(path: string): string {
  const base = API_URL || inferRuntimeApi();
  if (!base) return path; // Fallback to raw path if base not set; expect Next proxy if configured
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}
