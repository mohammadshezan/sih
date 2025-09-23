"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function AdminRoutes() {
  const [routes, setRoutes] = useState<any[]>([]);
  const [err, setErr] = useState<string>("");
  useEffect(() => {
    const token = localStorage.getItem('token') || '';
  fetch(withBase('/routes'), { headers: { Authorization: `Bearer ${token}` }})
      .then(r=>r.json()).then(setRoutes).catch(()=>setErr('Failed to load routes'));
  }, []);
  return (
    <main className="p-6 space-y-4">
      <h2 className="text-2xl font-semibold">Routes</h2>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="rounded-xl bg-white/5 p-4 border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400">
              <th className="py-2">Key</th>
              <th className="py-2">Name</th>
              <th className="py-2">Plant</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r:any)=> (
              <tr key={r.key} className="border-t border-white/10">
                <td className="py-2">{r.key}</td>
                <td className="py-2">{r.name || r.key}</td>
                <td className="py-2">{r.plant || '-'}</td>
              </tr>
            ))}
            {routes.length === 0 && (
              <tr><td colSpan={3} className="py-4 text-gray-400">No routes available</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
