"use client";
import { createContext, useContext, useState } from "react";

type Toast = { id: number; text: string; tone?: 'success'|'error'|'info' };
const ToastCtx = createContext<{ push: (t: Omit<Toast,'id'>)=>void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = (t: Omit<Toast,'id'>) => {
    const id = Date.now();
    setItems(prev => [...prev, { id, ...t }]);
    setTimeout(()=> setItems(prev => prev.filter(i=>i.id!==id)), 3000);
  };
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 right-4 space-y-2 z-50">
        {items.map(i=> {
          const bg = i.tone==='error' ? 'bg-red-500' : i.tone==='info' ? 'bg-blue-500' : 'bg-green-500';
          return (
            <div key={i.id} className={`rounded-md px-4 py-2 text-sm shadow ${bg} text-black`}>{i.text}</div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('ToastProvider missing');
  return ctx;
}
