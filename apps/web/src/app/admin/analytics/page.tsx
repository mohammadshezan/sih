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
  const [recent, setRecent] = useState<any[]>([]);
  const [range, setRange] = useState<'24h'|'7d'|'30d'>('24h');
  const [etaFilter, setEtaFilter] = useState<{ user?: string; from?: string; to?: string }>({});
  const [detail, setDetail] = useState<any|null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    fetch(withBase(`/admin/analytics/usage?range=${range}`), { headers: { Authorization: `Bearer ${token}` }})
      .then(r => r.ok ? r.json() : r.json().then(j=>Promise.reject(j)))
      .then(data => {
        setRoutes(data.routes||[]);
        setRoles(data.roles||{});
        setWs(data.ws||{});
        setEvents((data.events?.counts)||{});
        setRecent(data.events?.recent||[]);
      })
      .catch(e => setError(e?.error || e?.message || 'Failed to load'))
      .finally(()=> setLoading(false));
  }, [range]);

  if (loading) return <div className="p-6">Loading analytics…</div>;
  if (error) return <div className="p-6 text-red-400">{error}</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Usage Analytics</h1>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-400">Range:</span>
        <select value={range} onChange={e=> setRange(e.target.value as any)} className="bg-gray-900 border border-gray-700 rounded px-2 py-1">
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7d</option>
          <option value="30d">Last 30d</option>
        </select>
      </div>
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card: Top Roles */}
        <div className="bg-gray-800/40 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Top Roles ({range})</div>
          <ul className="mt-2 space-y-1">
            {Object.entries(roles)
              .sort((a,b)=> Number(b[1]) - Number(a[1]))
              .slice(0,5)
              .map(([role, c]) => (
                <li key={role} className="flex justify-between"><span>{role}</span><span>{c}</span></li>
              ))}
          </ul>
        </div>

        {/* Card: WebSocket */}
        <div className="bg-gray-800/40 rounded-lg p-4">
          <div className="text-gray-400 text-sm">WebSocket</div>
          <div className="mt-2 text-sm">Total: {ws?.totalConnections||0}, Current: {ws?.currentConnections||0}</div>
          <div className="text-sm">Avg Session: {ws?.avgSessionSec||0}s</div>
        </div>

        {/* Card: Events Bar Chart */}
        <div className="bg-gray-800/40 rounded-lg p-4">
          <div className="text-gray-400 text-sm flex items-center justify-between">
            <span>Events ({range})</span>
            <span className="text-[10px] text-gray-500">Bar width = count / max(top-6)</span>
          </div>
          <div className="mt-2 space-y-1">
            {(() => {
              const top = Object.entries(events).sort((a,b)=> Number(b[1]) - Number(a[1])).slice(0,6);
              const max = Math.max(1, ...top.map(([,c])=> Number(c)));
              return (
                <>
                  {top.map(([t,c]) => (
                    <div key={t} className="flex items-center gap-2" title={`${t}: ${c}`}>
                      <div className="w-28 text-xs truncate" title={t}>{t}</div>
                      <div className="flex-1 bg-gray-900 rounded h-3 overflow-hidden">
                        <div className="h-3 bg-blue-500" style={{ width: `${(Number(c)/max)*100}%` }} />
                      </div>
                      <div className="w-10 text-right text-xs">{c}</div>
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        </div>
      </section>

      {/* Quick sparkbars for top routes */}
      <section>
        <div className="text-lg font-medium mb-2">Top Routes (sparkbars)</div>
        <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
          <span>Bar width = route count / max(top-6)</span>
          <span>Hover rows for values</span>
        </div>
        <div className="grid md:grid-cols-2 gap-3 mb-3">
          {(() => {
            const topRoutes = routes.slice(0, 6);
            const maxCount = Math.max(1, ...topRoutes.map(r => Number(r.count)));
            return topRoutes.map(r => (
              <div key={r.path} className="bg-gray-800/30 rounded p-3" title={`${r.path}: ${r.count} hits, avg ${r.avgMs} ms`}>
                <div className="text-xs text-gray-400">{r.path}</div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 bg-gray-900 h-2 rounded overflow-hidden">
                    <div className="h-2 bg-green-500" style={{ width: `${(Number(r.count)/maxCount)*100}%` }} />
                  </div>
                  <div className="text-xs">{r.count}</div>
                </div>
                <div className="text-[10px] text-gray-500 mt-1">avg {r.avgMs} ms</div>
              </div>
            ));
          })()}
        </div>
      </section>
      {/* Recent ETA Recalcs */}
      <section>
        <div className="text-lg font-medium mb-2 flex items-center justify-between">
          <span>Recent ETA Recalcs</span>
          <EtaCsvLink />
        </div>
        <EtaFilters onChange={(user, from, to)=> setEtaFilter({ user, from, to })} />
        <div className="overflow-auto rounded-lg border border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/60">
              <tr>
                <th className="text-left p-2">When</th>
                <th className="text-left p-2">User</th>
                <th className="text-left p-2">Role</th>
                <th className="text-left p-2">Speed/Dwell</th>
                <th className="text-left p-2">From → To</th>
                <th className="text-left p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recent
                .filter(e=> e.type==='customer_eta_recalc')
                .filter(e=> !etaFilter.user || (e.user||'').toLowerCase().includes(etaFilter.user!.toLowerCase()))
                .filter(e=> {
                  const t = e.ts;
                  const fromOk = !etaFilter.from || (t >= Date.parse(etaFilter.from));
                  const toOk = !etaFilter.to || (t <= Date.parse(etaFilter.to));
                  return fromOk && toOk;
                })
                .slice(0,10)
                .map((e,idx)=> (
                <tr key={idx} className="odd:bg-gray-800/20">
                  <td className="p-2">{new Date(e.ts).toLocaleString()}</td>
                  <td className="p-2">{e.user||'-'}</td>
                  <td className="p-2">{e.role||'-'}</td>
                  <td className="p-2">{e.meta?.speedKph||'-'} kph / {e.meta?.dwellHours||'-'} h</td>
                  <td className="p-2">{e.meta?.result?.route?.from || e.meta?.source || e.meta?.currentLocation || '-'} → {e.meta?.result?.route?.to || e.meta?.destination || '-'}</td>
                  <td className="p-2">
                    <button className="px-2 py-1 border border-gray-700 rounded text-xs" onClick={()=> setDetail(e)}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-[520px] max-w-full">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">ETA Recalc Details</div>
                <button className="text-sm text-gray-400" onClick={()=> setDetail(null)}>Close</button>
              </div>
              <div className="text-xs space-y-1">
                <div><span className="text-gray-400">When:</span> {new Date(detail.ts).toLocaleString()}</div>
                <div><span className="text-gray-400">User:</span> {detail.user||'-'} ({detail.role||'-'})</div>
                <div><span className="text-gray-400">Route:</span> {(detail.meta?.result?.route?.from || detail.meta?.currentLocation || detail.meta?.source || '-') + ' → ' + (detail.meta?.result?.route?.to || detail.meta?.destination || '-')} · {detail.meta?.result?.route?.distanceKm ? `${detail.meta.result.route.distanceKm} km` : ''}</div>
                <div><span className="text-gray-400">Inputs:</span> {detail.meta?.speedKph||'-'} kph, {detail.meta?.dwellHours||'-'} h</div>
                <div><span className="text-gray-400">Multipliers:</span> cong ×{detail.meta?.result?.multipliers?.congestion ?? '-'}, weather ×{detail.meta?.result?.multipliers?.weather ?? '-'}</div>
                <div><span className="text-gray-400">Output:</span> ETA {detail.meta?.result?.eta ? new Date(detail.meta.result.eta).toLocaleString() : '-'} · {detail.meta?.result?.transitHours ?? '-'} h · conf {detail.meta?.result?.confidence ? Math.round(detail.meta.result.confidence*100) : '-'}%</div>
              </div>
            </div>
          </div>
        )}
      </section>
  {/* Local helper components */}
  <EtaHelperScripts />
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

function EtaCsvLink() {
  const [user, setUser] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const buildQuery = (q: Record<string,string>) => {
    const p = new URLSearchParams();
    Object.entries(q).forEach(([k,v])=> { if (v) p.set(k,v); });
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  const url = withBase(`/admin/analytics/eta-recalcs.csv${buildQuery({ user, from, to })}`);
  return (
    <div className="flex items-center gap-2 text-xs">
      <input placeholder="user@email" className="bg-transparent border border-gray-700 rounded px-2 py-1" value={user} onChange={e=> setUser(e.target.value)} />
      <input type="datetime-local" className="bg-transparent border border-gray-700 rounded px-2 py-1" value={from} onChange={e=> setFrom(e.target.value)} />
      <input type="datetime-local" className="bg-transparent border border-gray-700 rounded px-2 py-1" value={to} onChange={e=> setTo(e.target.value)} />
      <a className="underline" href={url} title="Download filtered CSV">Download CSV</a>
    </div>
  );
}

function EtaFilters({ onChange }: { onChange?: (user: string, from: string, to: string)=>void }) {
  const [user, setUser] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // This demo keeps client-only filters as hints; server CSV link performs authoritative filtering
  return (
    <div className="mb-2 flex items-center gap-2 text-xs">
      <input placeholder="filter by user (client-only)" className="bg-transparent border border-gray-700 rounded px-2 py-1" value={user} onChange={e=> setUser(e.target.value)} />
      <input type="datetime-local" className="bg-transparent border border-gray-700 rounded px-2 py-1" value={from} onChange={e=> setFrom(e.target.value)} />
      <input type="datetime-local" className="bg-transparent border border-gray-700 rounded px-2 py-1" value={to} onChange={e=> setTo(e.target.value)} />
      <button className="px-2 py-1 border border-gray-700 rounded" onClick={()=> onChange?.(user, from, to)}>Search</button>
    </div>
  );
}

function EtaHelperScripts() {
  return null;
}
