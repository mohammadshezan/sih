"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function ReportsPage() {
  const [plants, setPlants] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [stock, setStock] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [dispatches, setDispatches] = useState<any[]>([]);
  const [filters, setFilters] = useState({ cargo: 'steel', loco: 'diesel', grade: 0, tonnage: 3000, routeKey: 'BKSC-DGR' });

  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    const headers = { Authorization: `Bearer ${token}` } as any;
    Promise.all([
      fetch(withBase('/plants'), { headers }).then(r=>r.json()).catch(()=>[]),
      fetch(withBase('/routes'), { headers }).then(r=>r.json()).catch(()=>[]),
      fetch(withBase('/stock'), { headers }).then(r=>r.json()).then(d=> d.yards || []).catch(()=>[]),
      fetch(withBase('/alerts'), { headers }).then(r=>r.json()).then(d=> d.alerts || []).catch(()=>[]),
      fetch(withBase('/dispatches'), { headers }).then(r=>r.json()).catch(()=>[]),
    ]).then(([p, ro, st, al, di]) => { setPlants(p||[]); setRoutes(ro||[]); setStock(st||[]); setAlerts(al||[]); setDispatches(di||[]); });
  }, []);

  const qs = new URLSearchParams({ cargo: filters.cargo, loco: filters.loco, grade: String(filters.grade), tonnage: String(filters.tonnage), routeKey: filters.routeKey }).toString();
  const csvUrl = withBase(`/export/kpis.csv?${qs}`);
  const pdfUrl = withBase(`/export/kpis.pdf?${qs}`);

  return (
    <main className="p-6 space-y-6">
      <h2 className="text-2xl font-semibold">Reports</h2>
      <div className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="mb-2">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Route</label>
            <select value={filters.routeKey} onChange={e=>setFilters({ ...filters, routeKey: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2">
              {(routes||[]).map((o:any) => (<option key={o.key} value={o.key}>{o.name || o.key}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Cargo</label>
            <select value={filters.cargo} onChange={e=>setFilters({ ...filters, cargo: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2">
              <option value="ore">Ore</option>
              <option value="coal">Coal</option>
              <option value="steel">Steel</option>
              <option value="cement">Cement</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Locomotive</label>
            <select value={filters.loco} onChange={e=>setFilters({ ...filters, loco: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2">
              <option value="diesel">Diesel</option>
              <option value="electric">Electric</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Grade (%)</label>
            <input type="number" min={0} max={6} step={0.5} value={filters.grade} onChange={e=>setFilters({ ...filters, grade: Number(e.target.value) })} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Tonnage (t)</label>
            <input type="number" min={1000} max={6000} step={100} value={filters.tonnage} onChange={e=>setFilters({ ...filters, tonnage: Number(e.target.value) })} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2" />
          </div>
          <div className="flex gap-2">
            <a href={csvUrl} className="w-full rounded-md border border-white/10 px-3 py-2 text-center">Export CSV</a>
            <a href={pdfUrl} className="w-full rounded-md bg-brand-green text-black px-3 py-2 text-center">Export PDF</a>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="rounded-xl bg-white/5 p-4 border border-white/10">
          <h3 className="mb-2">Stock vs Demand</h3>
          <div className="space-y-2 text-sm">
            {stock.slice(0,8).map((y:any, i:number) => (
              <div key={i} className="bg-white/5 rounded-md p-2">
                <div className="flex items-center justify-between">
                  <span>{y.yard}</span>
                  <span className="text-xs">{y.stockTons}/{y.demandTons}t</span>
                </div>
                <div className="h-2 bg-white/10 rounded mt-1">
                  <div className={`h-2 rounded ${y.stockTons >= y.demandTons ? 'bg-brand-green' : 'bg-brand-yellow'}`} style={{ width: `${Math.min(100, Math.round((y.stockTons/Math.max(1,y.demandTons))*100))}%` }} />
                </div>
                {Array.isArray(y.items) && (
                  <div className="mt-1 text-xs text-gray-400 flex flex-wrap gap-1">
                    {y.items.map((it:any, idx:number) => (<span key={idx} className="bg-white/10 rounded px-2 py-0.5">{it.grade}: {it.stock}/{it.demand}t</span>))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl bg-white/5 p-4 border border-white/10">
          <h3 className="mb-2">Alerts</h3>
          <div className="space-y-2 text-sm">
            {alerts.map((a:any) => (
              <div key={a.id} className="flex items-center justify-between bg-white/5 rounded-md p-2">
                <div>
                  <p className="font-medium">{a.message || a.text}</p>
                  <p className="text-xs text-gray-400">{a.type} · {a.timestamp || a.ts}</p>
                </div>
                <span className="text-xs bg-white/10 rounded px-2 py-0.5">{(a.level || a.severity || '').toUpperCase()}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="mb-2">Dispatches</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
          {dispatches.map((d:any) => (
            <div key={d.id || d.hash} className="bg-white/5 rounded-md p-2">
              <div className="flex items-center justify-between"><span className="font-medium">{d.id || d.hash?.slice(0,8)}</span><span className="text-xs">{d.status}</span></div>
              <div className="text-xs text-gray-400">Rake: {d.rake} · Yard: {d.yard}</div>
              <div className="text-xs text-gray-400">{d.ts || d.timestamp}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
