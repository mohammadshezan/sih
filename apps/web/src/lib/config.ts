// Centralized client-side configuration for API and Socket URLs
// Use NEXT_PUBLIC_ env vars so they are available in the browser at build/runtime.

// Default to local API in development if not explicitly provided
const inferredApi = process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL.trim() !== ''
  ? process.env.NEXT_PUBLIC_API_URL
  : (process.env.NODE_ENV !== 'production' ? 'http://localhost:4000' : '');

export const API_URL = inferredApi.replace(/\/$/, '');
export const SOCKET_URL = (process.env.NEXT_PUBLIC_SOCKET_URL || API_URL || '').replace(/\/$/, '');

// Build a full URL from a path, ensuring a single leading slash
export function withBase(path: string): string {
  const base = API_URL;
  if (!base) return path; // Fallback to raw path if base not set
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}
