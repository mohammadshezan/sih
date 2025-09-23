"use client";
import { useEffect } from "react";
import Assistant from "@/components/Assistant";
// Toast is provided at root layout
import { useToast } from "@/components/Toast";
import BottomNav from "@/components/BottomNav";
import Chat from "@/components/Chat";
import io from "socket.io-client";
import { SOCKET_URL } from "@/lib/config";

const socket = SOCKET_URL ? io(SOCKET_URL) : io();

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const { push } = useToast();
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
    }
    const onAlert = (a:any) => {
      if (a?.type === 'rake_created') {
        const text = a?.message || `New rake ${a?.rakeId} created`;
        push({ text, tone: 'success' });
      }
    };
    socket.on('alert', onAlert);
    return () => { socket.off('alert', onAlert); };
  }, []);
  return (
    <>
      {children}
      <Assistant />
      <Chat />
      <BottomNav />
    </>
  );
}
