"use client";
import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import { SOCKET_URL } from "@/lib/config";

const socket = SOCKET_URL ? io(SOCKET_URL) : io();

export default function Chat() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Array<{id:string; ts:number; text:string; ch:string}>>([]);
  const [ch, setCh] = useState('general');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(()=>{
    function onMsg(m:any){ if (m.ch === ch) setMsgs(prev => [...prev, m]); }
    socket.on('chat:message', onMsg);
    return ()=>{ socket.off('chat:message', onMsg); };
  }, [ch]);
  const send = () => {
    const text = inputRef.current?.value || '';
    if (!text) return;
    socket.emit('chat:message', { text, ch });
    if (inputRef.current) inputRef.current.value='';
  };
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 transform">
      {open && (
        <div className="w-80 h-72 bg-white/5 border border-white/10 rounded-xl p-3 mb-2 flex flex-col">
          <div className="flex items-center gap-2 text-sm mb-2">
            <span>Channel:</span>
            <select value={ch} onChange={e=>setCh(e.target.value)} className="bg-black/40 border border-white/10 rounded px-2 py-1">
              <option value="general">General</option>
              <option value="admin">Admin</option>
              <option value="logistics">Logistics</option>
              <option value="yard">Yard</option>
            </select>
          </div>
          <div className="flex-1 overflow-auto text-sm space-y-1">
            {msgs.map(m => (<div key={m.id} className="text-gray-200">[{new Date(m.ts).toLocaleTimeString()}] {m.text}</div>))}
          </div>
          <div className="mt-2 flex gap-2">
            <input ref={inputRef} placeholder="Type message" className="flex-1 rounded-md bg-black/40 border border-white/10 p-2 text-sm" />
            <button onClick={send} className="rounded-md bg-white/10 border border-white/20 px-3">Send</button>
          </div>
        </div>
      )}
      <button onClick={()=>setOpen(v=>!v)} className="rounded-full bg-white/10 border border-white/20 px-4 py-2">Chat</button>
    </div>
  );
}
