"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
// Toast is provided at root layout
import { useToast } from "@/components/Toast";
import BottomNav from "@/components/BottomNav";
import io from "socket.io-client";
import { SOCKET_URL } from "@/lib/config";
import { trackPageView } from "@/lib/analytics";

const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
const socket = SOCKET_URL ? io(SOCKET_URL, { auth: { token } }) : io(undefined as any, { auth: { token } });

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const { push } = useToast();
  const pathname = usePathname();
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
    }
    // Track initial page view and subsequent route changes (client-side navigations)
    try { trackPageView(); } catch {}
    const onNav = () => { try { trackPageView(); } catch {} };
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);
    const onAlert = (a:any) => {
      if (a?.type === 'rake_created') {
        const text = a?.message || `New rake ${a?.rakeId} created`;
        push({ text, tone: 'success' });
      }
    };
    socket.on('alert', onAlert);
    return () => {
      socket.off('alert', onAlert);
      window.removeEventListener('popstate', onNav);
      window.removeEventListener('hashchange', onNav);
    };
  }, []);

  // Track client-side route changes via Next.js pathname
  useEffect(() => {
    try { trackPageView(); } catch {}
  }, [pathname]);
  return (
    <>
      {children}
  {/* AI Assistant & Chat removed from landing page per request */}
      <BottomNav />
    </>
  );
}
