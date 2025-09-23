"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function BottomNav() {
  const [role, setRole] = useState<string>('guest');
  useEffect(()=>{
    const t = localStorage.getItem('token')||'';
    try { const p = t? JSON.parse(atob(t.split('.')[1])): null; setRole(p?.role||'guest'); } catch {}
  },[]);
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden border-t border-white/10 bg-black/40 backdrop-blur">
      <div className="grid grid-cols-5 text-sm text-gray-300">
        <Link href="/" className="py-2 text-center">Home</Link>
        <Link href="/dashboard" className="py-2 text-center">Dash</Link>
        <Link href="/map" className="py-2 text-center">Map</Link>
        <Link href={role==='yard'? '/yard-actions': '/planner'} className="py-2 text-center">{role==='yard'? 'Yard':'Plan'}</Link>
        <Link href="/reports" className="py-2 text-center">Reports</Link>
      </div>
    </nav>
  );
}
