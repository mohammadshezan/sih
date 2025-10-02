"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

type RouteRow = { path: string; count: number; avgMs: number; byRole: { role: string; count: number }[] };

export default function AdminAnalytics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|undefined>();
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [roles, setRoles] = useState<Record<string, number>>({});
  const [ws, setWs] = useState<any>(null);
  const [events, setEvents] = useState<Record<string, number>>({});

  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    fetch(withBase('/admin/analytics/usage'), { headers: { Authorization: `Bearer ${token}` }})
      .then(r => r.ok ? r.json() : r.json().then(j=>Promise.reject(j)))
      .then(data => {
        setRoutes(data.routes||[]);
        setRoles(data.roles||{});
        setWs(data.ws||{});
        setEvents((data.events?.last24h)||{});
      })
      .catch(e => setError(e?.error || e?.message || 'Failed to load'))
      .finally(()=> setLoading(false));
  }, []);

  if (loading) return <div className="p-6">Loading analytics…</div>;
  if (error) return <div className="p-6 text-red-400">{error}</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Usage Analytics</h1>
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800/40 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Top Roles (24h)</div>
          <ul className="mt-2 space-y-1">
            {Object.entries(roles).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([role,c])=> (
              <li key={role} className="flex justify-between"><span>{role}</span><span>{c}</span></li>
            ))}
          </ul>
        </div>
        <div className="bg-gray-800/40 rounded-lg p-4">
          <div className="text-gray-400 text-sm">WebSocket</div>
          <div className="mt-2 text-sm">Total: {ws?.totalConnections||0}, Current: {ws?.currentConnections||0}</div>
          <div className="text-sm">Avg Session: {ws?.avgSessionSec||0}s</div>
        </div>
        <div className="bg-gray-800/40 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Events (24h)</div>
          <ul className="mt-2 space-y-1">
            {Object.entries(events).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([t,c])=> (
              <li key={t} className="flex justify-between"><span>{t}</span><span>{c}</span></li>
            ))}
          </ul>
        </div>
      </section>
      <section>
        <div className="text-lg font-medium mb-2">Top Routes</div>
        <div className="overflow-auto rounded-lg border border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/60">
              <tr>
                <th className="text-left p-2">Path</th>
                <th className="text-left p-2">Count</th>
                <th className="text-left p-2">Avg ms</th>
                <th className="text-left p-2">Roles</th>
              </tr>
            </thead>
            <tbody>
              {routes.map(r=> (
                <tr key={r.path} className="odd:bg-gray-800/20">
                  <td className="p-2">{r.path}</td>
                  <td className="p-2">{r.count}</td>
                  <td className="p-2">{r.avgMs}</td>
                  <td className="p-2">
                    {r.byRole.map(br => <span key={br.role} className="mr-3 inline-block">{br.role}:{br.count}</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-right">
          <a href={withBase('/admin/analytics/events.csv')} className="underline">Download Events CSV</a>
        </div>
      </section>
    </div>
  );
}
