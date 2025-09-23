"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export default function Nav() {
  // Defer auth-dependent UI to client after mount to avoid hydration mismatches
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [role, setRole] = useState<string>('guest');
  const pathname = usePathname();
  const isLanding = pathname === '/';
  useEffect(() => {
    try {
      const token = localStorage.getItem('token') || '';
      setAuthed(!!token);
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1] || '')) || {};
        setRole(payload?.role || 'guest');
      } else {
        setRole('guest');
      }
    } catch {
      setAuthed(false);
      setRole('guest');
    }
  }, []);
  return (
    <header className="sticky top-0 z-40 backdrop-blur bg-black/30 border-b border-white/10">
      <nav className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <img
            src="/brand/logo.svg"
            alt="QSTEEL"
            className="h-7 w-7"
            onError={(e)=>{
              const img = e.currentTarget as HTMLImageElement;
              const tried = img.getAttribute('data-fallback') || 'svg';
              if (tried === 'svg') {
                img.setAttribute('data-fallback','png');
                img.src = '/brand/logo.png';
              } else if (tried === 'png') {
                img.setAttribute('data-fallback','default');
                img.src = '/logo.svg';
              }
            }}
          />
          <span className="font-semibold">QSTEEL</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {authed && !isLanding ? (
            <>
              {role==='customer' && (
                <>
                  <Link href="/customer/dashboard">Dashboard</Link>
                  <Link href="/customer/orders">Orders</Link>
                  <Link href="/customer/invoices">Invoices</Link>
                  <Link href="/customer/notifications">Notifications</Link>
                </>
              )}
              {role==='manager' && (
                <>
                  <Link href="/manager/approvals">Approvals</Link>
                  <Link href="/optimizer">Optimizer</Link>
                  <Link href="/manager/simulator">Simulator</Link>
                  <Link href="/reports">Reports</Link>
                </>
              )}
              {role==='yard' && (
                <>
                  <Link href="/yard-actions">Yard</Link>
                  <Link href="/yard/wagon-health">Wagon Health</Link>
                  <Link href="/yard/safety">Safety</Link>
                </>
              )}
              {role==='admin' && (
                <>
                  <Link href="/ledger">Ledger</Link>
                  <Link href="/admin/rbac">RBAC</Link>
                  <Link href="/admin/integrations">Integrations</Link>
                  <Link href="/admin/audit-reports">Audit</Link>
                </>
              )}
              <button onClick={()=>{ localStorage.removeItem('token'); location.href='/'; }} className="rounded-md border border-white/10 px-3 py-1">Sign out</button>
            </>
          ) : (
            <>
              <Link href="/customer-auth">Customer Portal</Link>
              <Link href="/signin" className="rounded-md bg-brand-green text-black px-3 py-1">Sign in</Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
