"use client";
import { useEffect, useMemo, useState } from "react";
import io from "socket.io-client";
import { withBase, SOCKET_URL } from "@/lib/config";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, BarChart, Bar } from "recharts";
import { useToast } from "@/components/Toast";

const socket = SOCKET_URL ? io(SOCKET_URL) : io();

export default function Dashboard() {
  const { push } = useToast();
  const [kpis, setKpis] = useState<any>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [role, setRole] = useState<string>("guest");
  const [routes, setRoutes] = useState<any | null>(null);
  const [cargo, setCargo] = useState<string>('ore');
  const [loco, setLoco] = useState<string>('diesel');
  const [grade, setGrade] = useState<number>(0);
  const [tonnage, setTonnage] = useState<number>(3000);
  const [routeKey, setRouteKey] = useState<string>('BKSC-DGR');
  const [routeOptions, setRouteOptions] = useState<Array<{ key: string; name: string }>>([
    { key: 'BKSC-DGR', name: 'BKSC → DGR' },
    { key: 'BKSC-ROU', name: 'BKSC → ROU' },
    { key: 'BKSC-BPHB', name: 'BKSC → BPHB' },
  ]);

  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    try {
      const payload = token ? JSON.parse(atob(token.split('.')[1])) : null;
      setRole(payload?.role || 'guest');
      // load saved defaults per role
      const saved = localStorage.getItem(`routeFilters:${payload?.role || 'guest'}`);
      if (saved) {
        const obj = JSON.parse(saved);
        if (obj.cargo) setCargo(obj.cargo);
        if (obj.loco) setLoco(obj.loco);
        if (obj.grade !== undefined) setGrade(Number(obj.grade));
        if (obj.tonnage !== undefined) setTonnage(Number(obj.tonnage));
        if (obj.routeKey) setRouteKey(obj.routeKey);
      }
    } catch {}
  fetch(withBase("/kpis"), { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setKpis).catch(() => setKpis({ pendingRakes: 6, dispatchedRakes: 12, utilization: 0.78, delayProbability: 0.18, fuelConsumption: [10,12,8,9,11,7,10], carbonIntensityPerRake: 0.98, co2Total: 11.76, ecoSavingsPercent: 12, ecoRouteHint: 'Avoid Segment S1 congestion; choose S3 to save ~12% emissions.' }));
    // fetch route options dynamically (fallback to defaults on failure)
  fetch(withBase("/routes"), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then((list)=>{
        if (Array.isArray(list) && list.length) {
          setRouteOptions(list.map((r:any)=>({ key: r.key, name: r.name || r.key })));
        }
      }).catch(()=>{});
    const qs = new URLSearchParams({ cargo, loco, grade: String(grade), tonnage: String(tonnage), routeKey }).toString();
  fetch(withBase(`/map/routes?${qs}`), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then(setRoutes).catch(()=> setRoutes(null));
    // Alerts and Stock
  fetch(withBase('/alerts'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then(d=> setAlerts(d.alerts || []))
      .catch(()=> setAlerts([]));
  fetch(withBase('/stock'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then(d=> setStock(d.yards || []))
      .catch(()=> setStock([]));
    socket.on("positions", (data) => setPositions(data));
    // alert notifications
    const onAlert = (a:any) => {
      const text = a?.message || (a?.type === 'rake_created' ? `New rake ${a?.rakeId} created` : 'Alert');
      push({ text, tone: 'success' });
      // refresh alerts list subtly
  fetch(withBase('/alerts'), { headers: { Authorization: `Bearer ${localStorage.getItem('token')||''}` } })
        .then(r=>r.json()).then(d=> setAlerts(d.alerts || [])).catch(()=>{});
    };
    socket.on('alert', onAlert);
    // listen for filter apply events from Map
    const onApply = (e: any) => {
      const det = e?.detail || {};
      if (det.cargo) setCargo(det.cargo);
      if (det.loco) setLoco(det.loco);
      if (det.grade !== undefined) setGrade(Number(det.grade));
      if (det.tonnage !== undefined) setTonnage(Number(det.tonnage));
      if (det.routeKey) setRouteKey(det.routeKey);
      const qs2 = new URLSearchParams({ cargo: det.cargo || cargo, loco: det.loco || loco, grade: String(det.grade ?? grade), tonnage: String(det.tonnage ?? tonnage), routeKey: det.routeKey || routeKey }).toString();
  fetch(withBase(`/map/routes?${qs2}`), { headers: { Authorization: `Bearer ${localStorage.getItem('token')||''}` } })
        .then(r=>r.json()).then(setRoutes).catch(()=>{});
    };
    window.addEventListener('routeFilters:apply', onApply as any);
    return () => { socket.off("positions"); socket.off('alert', onAlert); };
  }, []);

  const fuelSeries = useMemo(() => (kpis?.fuelConsumption || []).map((v:number, i:number) => ({ name: `D${i+1}`, v })), [kpis]);

  // prepare route emissions data
  const routeSeries = useMemo(() => (routes?.routes || []).map((r:any, idx:number) => ({ name: `R${idx+1}`, co2: r.co2_tons, km: r.km, status: r.status, best: idx === (routes?.eco?.bestIndex ?? -1) })), [routes]);
  // system health section removed
  const [forecast, setForecast] = useState<number[] | null>(null);
  const [alerts, setAlerts] = useState<any[] | null>(null);
  const [stock, setStock] = useState<any[]>([]);

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Dashboard</h2>
        <div className="flex gap-2 text-sm">
          <a href="/planner" className="rounded-md border border-white/10 px-3 py-1">Planner</a>
          <a href="/reports" className="rounded-md bg-white/10 border border-white/10 px-3 py-1">Reports</a>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card title="Pending Rakes" value={kpis?.pendingRakes ?? 0} tone="yellow" />
        <Card title="Dispatched Rakes" value={kpis?.dispatchedRakes ?? 0} tone="green" />
        <Card title="Utilization" value={`${Math.round((kpis?.utilization ?? 0)*100)}%`} tone="green" />
        <Card title="Delay Risk" value={`${Math.round((kpis?.delayProbability ?? 0)*100)}%`} tone="red" />
  <Card title="Carbon per Rake" value={`${(kpis?.carbonIntensityPerRake ?? Math.max(0.5, 2 - (kpis?.utilization||0)*1.5)).toFixed(2)} t`} />
  <Card title="Total CO₂ Today" value={`${(kpis?.co2Total ?? 0).toFixed?.(2) ?? kpis?.co2Total ?? 0} t`} />
      </div>

      {/* Alerts & Stock */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl bg-white/5 p-4 border border-white/10">
          <div className="flex items-center justify-between">
            <h3 className="mb-2">Alerts & Notifications</h3>
            <span className="text-xs text-gray-400">{(alerts?.length ?? 0)} items</span>
          </div>
          <div className="space-y-2 text-sm">
            {(alerts || []).slice(0,5).map((a:any, i:number) => (
              <div key={i} className="flex items-center justify-between bg-white/5 rounded-md p-2">
                <div>
                  <p className="font-medium">{a.message || a.text || 'Alert'}</p>
                  <p className="text-xs text-gray-400">{a.routeKey || a.route || routeKey}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${severityToClass(a.severity || a.level)}`}>{String((a.severity || a.level || 'info')).toUpperCase()}</span>
              </div>
            ))}
            {((alerts || []).length === 0) && <p className="text-gray-400 text-sm">No alerts right now.</p>}
          </div>
        </div>

        <div className="rounded-xl bg-white/5 p-4 border border-white/10">
          <h3 className="mb-2">Stock vs Demand (per yard)</h3>
          <div className="space-y-2 text-sm">
            {(stock || []).slice(0,5).map((y:any, i:number) => {
              const name = y.name || y.yard || `Yard ${i+1}`;
              const s = Number((y.stockTons ?? y.stock ?? y.available) ?? 0);
              const d = Number((y.demandTons ?? y.demand ?? y.required) ?? 0);
              const pct = Math.max(0, Math.min(100, Math.round((s / Math.max(1, d || 1)) * 100)));
              return (
                <div key={i} className="bg-white/5 rounded-md p-2">
                  <div className="flex items-center justify-between">
                    <span>{name}</span>
                    <span className="text-xs">{s} / {d} t</span>
                  </div>
                  <div className="h-2 bg-white/10 rounded mt-1">
                    <div className={`h-2 rounded ${s >= d ? 'bg-brand-green' : 'bg-brand-yellow'}`} style={{ width: `${pct}%` }} />
                  </div>
                  {Array.isArray(y.items) && y.items.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {y.items.map((it:any, idx:number) => (
                        <span key={idx} className="text-xs bg-white/10 border border-white/10 rounded px-2 py-0.5">
                          {it.grade}: {it.stock}/{it.demand}t
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {((stock || []).length === 0) && <p className="text-gray-400 text-sm">No stock data available.</p>}
          </div>
        </div>
      </div>

      {/* Route emissions controls */}
      <div className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="mb-2">Route Emissions Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Route</label>
            <select value={routeKey} onChange={e=>setRouteKey(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2">
              {routeOptions.map(o => (
                <option key={o.key} value={o.key}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Cargo</label>
            <select value={cargo} onChange={e=>setCargo(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2">
              <option value="ore">Ore</option>
              <option value="coal">Coal</option>
              <option value="steel">Steel</option>
              <option value="cement">Cement</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Locomotive</label>
            <select value={loco} onChange={e=>setLoco(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2">
              <option value="diesel">Diesel</option>
              <option value="electric">Electric</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Grade (%)</label>
            <input type="number" min={0} max={6} step={0.5} value={grade} onChange={e=>setGrade(Number(e.target.value))} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Tonnage (t)</label>
            <input type="number" min={1000} max={6000} step={100} value={tonnage} onChange={e=>setTonnage(Number(e.target.value))} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2" />
          </div>
          <div>
            <button onClick={() => {
              const token = localStorage.getItem('token') || '';
              const qs = new URLSearchParams({ cargo, loco, grade: String(grade), tonnage: String(tonnage), routeKey }).toString();
              fetch(withBase(`/map/routes?${qs}`), { headers: { Authorization: `Bearer ${token}` } })
                .then(r=>r.json()).then((d)=>{ setRoutes(d); window.dispatchEvent(new CustomEvent('routeFilters:apply', { detail: { cargo, loco, grade, tonnage, routeKey } })); })
                .catch(()=> setRoutes(null));
            }} className="w-full rounded-md bg-brand-green text-black px-3 py-2">Apply</button>
          </div>
          <div>
            <button onClick={() => {
              const token = localStorage.getItem('token') || '';
              let role = 'guest';
              try { const p = token ? JSON.parse(atob(token.split('.')[1])) : null; role = p?.role || 'guest'; } catch {}
              localStorage.setItem(`routeFilters:${role}`, JSON.stringify({ cargo, loco, grade, tonnage, routeKey }));
            }} className="w-full rounded-md border border-white/10 px-3 py-2">Save Defaults</button>
          </div>
        </div>
        {routes?.meta && (
          <p className="text-xs text-gray-400 mt-2">EF: {routes.meta.efPerKm} tCO₂/km · cargo={routes.meta.cargo}, loco={routes.meta.loco}, grade={routes.meta.grade}%, tonnage={routes.meta.tonnage}t · {routes.meta.routeKey}</p>
        )}
      </div>

      {/* Role-tailored content rows */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {(role !== 'yard') && (
          <div className="rounded-xl bg-white/5 p-4 border border-white/10">
            <h3 className="mb-2">Fuel/Energy Consumption</h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={fuelSeries}>
                <XAxis dataKey="name" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip contentStyle={{ background: '#0b1220', border: '1px solid #374151' }} />
                <Line type="monotone" dataKey="v" stroke="#00B386" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="rounded-xl bg-white/5 p-4 border border-white/10">
          <h3 className="mb-2">Pending vs Dispatched</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={[{ name: 'Rakes', pending: kpis?.pendingRakes ?? 0, dispatched: kpis?.dispatchedRakes ?? 0 }]}>
              <XAxis dataKey="name" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip contentStyle={{ background: '#0b1220', border: '1px solid #374151' }} />
              <Bar dataKey="pending" fill="#F2C94C" />
              <Bar dataKey="dispatched" fill="#00B386" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Manager: quick forecast preview */}
      {role === 'manager' && (
        <div className="rounded-xl bg-white/5 p-4 border border-white/10">
          <div className="flex items-center justify-between">
            <h3 className="mb-2">7-day Demand Forecast (preview)</h3>
            <button className="text-xs underline" onClick={async()=>{
              const token = localStorage.getItem('token') || '';
              const r = await fetch(withBase('/ai/forecast'), { method:'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify({ series: [10,12,11,13,12,14,15], horizon: 7 }) });
              const d = await r.json(); setForecast(d.forecast || []);
            }}>Refresh</button>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={(forecast||[]).map((v,i)=>({ name:`D${i+1}`, v }))}>
              <XAxis dataKey="name" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip contentStyle={{ background: '#0b1220', border: '1px solid #374151' }} />
              <Line type="monotone" dataKey="v" stroke="#60A5FA" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Admin: system health section removed by request */}

      <div className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="mb-2">Route Emissions by Option</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={routeSeries}>
            <XAxis dataKey="name" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" />
            <Tooltip contentStyle={{ background: '#0b1220', border: '1px solid #374151' }} formatter={(v)=>[`${v} tCO₂`, 'Emissions']} />
            <Bar dataKey="co2">
              {routeSeries.map((entry:any, index:number) => (
                <Cell key={`cell-${index}`} fill={entry.best? '#00B386' : (entry.status==='congested'? '#EF4444' : entry.status==='busy'? '#F59E0B' : '#9CA3AF')} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {routes?.eco && (
          <p className="text-xs text-gray-400 mt-2">Eco-route R{(routes.eco.bestIndex??0)+1} saves ~{routes.eco.savingsPercent}% vs worst. {kpis?.ecoRouteHint || ''}</p>
        )}
      </div>

      {/* Simple Suggestion */}
      {routes?.eco && (
        <div className="rounded-xl bg-white/5 p-4 border border-white/10">
          <h3 className="mb-2">Suggestion</h3>
          <p className="text-sm text-gray-300">
            R{(routes.eco.bestIndex ?? 0) + 1} is currently the most eco-friendly option, estimated to save ~{routes.eco.savingsPercent}% CO₂ compared to the worst alternative for
            {' '}<span className="font-medium">{routes?.meta?.routeKey || routeKey}</span> with <span className="font-medium">{cargo}</span> cargo and
            {' '}<span className="font-medium">{loco}</span> locomotive at <span className="font-medium">{tonnage}t</span>.
            {loco === 'diesel' ? ' If overhead electric is available on this corridor, consider switching to electric to reduce emissions further by ~30–60%.' : ''}
          </p>
        </div>
      )}

      {role !== 'guest' && (
      <div className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="mb-2">Live Rake Positions (mock)</h3>
        <div className="text-sm text-gray-300 grid grid-cols-1 md:grid-cols-2 gap-2">
          {positions.map(p => (
            <div key={p.id} className="flex items-center justify-between bg-white/5 rounded-md p-2">
              <span>{p.id}</span>
              <span>{p.lat.toFixed(3)}, {p.lng.toFixed(3)} — {p.speed} km/h</span>
            </div>
          ))}
          {positions.length === 0 && <p>No data yet…</p>}
        </div>
        <p className="text-xs text-gray-400 mt-2">Eco-route: {kpis?.ecoRouteHint || 'Using segments avoiding congestion reduces estimated emissions by ~12% today.'}</p>
      </div>
      )}

      {role === 'yard' && (
        <div className="rounded-xl bg-white/5 p-4 border border-white/10">
          <h3 className="mb-2">Yard Quick Actions</h3>
          <p className="text-sm text-gray-300">Jump to yard actions to confirm loading or dispatch rakes.</p>
          <a href="/yard-actions" className="inline-block mt-3 rounded-md bg-brand-green text-black px-4 py-2">Open Yard Actions</a>
        </div>
      )}
    </main>
  );
}

function Card({ title, value, tone }: { title: string; value: any; tone?: 'green'|'yellow'|'red' }) {
  const color = tone === 'green' ? 'text-brand-green' : tone === 'yellow' ? 'text-brand-yellow' : tone === 'red' ? 'text-brand-red' : 'text-white';
  return (
    <div className="rounded-xl bg-white/5 p-4 border border-white/10">
      <p className="text-xs text-gray-400">{title}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function severityToClass(level?: string) {
  const l = (level || '').toLowerCase();
  if (l === 'critical' || l === 'error' || l === 'high') return 'bg-brand-red text-white';
  if (l === 'warn' || l === 'warning' || l === 'medium') return 'bg-brand-yellow text-black';
  if (l === 'info' || l === 'low') return 'bg-white/20';
  return 'bg-white/20';
}
