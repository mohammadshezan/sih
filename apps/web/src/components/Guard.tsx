"use client";
import { useEffect, useState } from "react";

export default function Guard({ allow, children }: { allow: Array<'admin'|'manager'|'yard'|'customer'>; children: React.ReactNode }) {
  const [ok, setOk] = useState<boolean>(false);
  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    try {
      const payload = token ? JSON.parse(atob(token.split('.')[1])) : null;
      const role = payload?.role as string | undefined;
      setOk(!!role && (allow.includes(role as any) || role === 'admin'));
    } catch { setOk(false); }
  }, [allow]);
  if (!ok) return <div className="p-6">Access denied. Please sign in with proper role.</div>;
  return <>{children}</>;
}
