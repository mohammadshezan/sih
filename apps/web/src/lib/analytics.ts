// Lightweight client analytics: send page views and actions to /events
import { withBase } from './config';

export async function trackEvent(type: string, payload: { page?: string; action?: string; meta?: any } = {}) {
  try {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
    await fetch(withBase('/events'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ type, ...payload, ts: Date.now() }),
      keepalive: true,
    });
  } catch {}
}

export function trackPageView() {
  if (typeof window === 'undefined') return;
  const page = window.location.pathname;
  trackEvent('page_view', { page });
}

export function trackAction(action: string, meta?: any) {
  if (typeof window === 'undefined') return;
  const page = window.location.pathname;
  trackEvent('action_click', { page, action, meta });
}
