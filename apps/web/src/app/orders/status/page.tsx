"use client";
import { useEffect, useMemo, useState } from "react";
import Guard from "@/components/Guard";
import { withBase } from "@/lib/config";

export default function OrdersStatusPage(){
  return (
    <Guard allow={["admin","manager","yard","cmo"] as any}>
      <OrdersStatusInner />
    </Guard>
  );
}

function OrdersStatusInner(){
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [filters, setFilters] = useState<{status:string; plant:string; q:string}>({ status: "", plant: "", q: "" });
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSug, setShowSug] = useState(false);

  useEffect(()=>{
    const token = localStorage.getItem('token')||'';
    const qs = new URLSearchParams({
      ...(filters.status? { status: filters.status } : {}),
      ...(filters.plant? { sourcePlant: filters.plant } : {}),
      ...(filters.q? { destination: filters.q } : {}),
    }).toString();
    setLoading(true);
    fetch(withBase(`/orders/status${qs?`?${qs}`:''}`), { headers: { Authorization: `Bearer ${token}` }})
      .then(r=> r.ok? r.json(): Promise.reject(r.statusText))
      .then(d=> { setOrders(d.orders||[]); setError(""); })
      .catch(e=> setError(String(e)))
      .finally(()=> setLoading(false));
  }, [filters]);

  useEffect(()=>{
    const token = localStorage.getItem('token')||'';
    fetch(withBase('/manager/orders/suggestions'), { headers: { Authorization: `Bearer ${token}` }})
      .then(r=> r.ok? r.json(): Promise.reject())
      .then(d=> setSuggestions(d.suggestions||[]))
      .catch(()=> setSuggestions([]));
  },[]);

  const grouped = useMemo(()=>{
    const g: Record<string, any[]> = {};
    orders.forEach(o=> { const k = o.status||'Unknown'; (g[k] = g[k]||[]).push(o); });
    return g;
  }, [orders]);

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Orders Status</h2>
        <div className="flex gap-2 text-sm">
          <select value={filters.status} onChange={e=> setFilters(f=> ({...f, status: e.target.value}))} className="bg-transparent border border-white/10 rounded px-2 py-1">
            <option value="">All Status</option>
            {['Pending','Approved','Loading','En Route','Rejected'].map(s=> <option key={s} value={s.toLowerCase()}>{s}</option>)}
          </select>
          <select value={filters.plant} onChange={e=> setFilters(f=> ({...f, plant: e.target.value}))} className="bg-transparent border border-white/10 rounded px-2 py-1">
            <option value="">All Plants</option>
            {['BKSC','DGR','ROU','BPHB'].map(p=> <option key={p} value={p}>{p}</option>)}
          </select>
          <input value={filters.q} onChange={e=> setFilters(f=> ({...f, q: e.target.value}))} placeholder="Filter by destination city" className="bg-transparent border border-white/10 rounded px-2 py-1" />
          <button onClick={()=> setShowSug(s=> !s)} className="px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200">Merge Suggestions ({suggestions.length})</button>
        </div>
      </div>

      {showSug && suggestions.length>0 && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 text-sm">
          <div className="font-medium mb-2">Suggested Couplings/Merges</div>
          <ul className="space-y-2">
            {suggestions.map((s:any,i:number)=> (
              <li key={i} className="flex items-center justify-between gap-2">
                <div>Route {s.route} · Qty {s.totalQty}t · <span className="font-mono">{s.orders.join(', ')}</span></div>
                <div>
                  <button className="px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-200" onClick={async ()=>{
                    const token = localStorage.getItem('token')||'';
                    const r = await fetch(withBase('/manager/orders/merge'), { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ orderIds: s.orders }) });
                    if (!r.ok) return alert('Merge failed');
                    alert('Merged. Refreshing list…');
                    setFilters(f => ({ ...f }));
                  }}>Couple/Merge</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && <div>Loading…</div>}
      {error && <div className="text-red-400">{error}</div>}

      {!loading && !error && (
        <div className="grid md:grid-cols-2 gap-4">
          {Object.entries(grouped).map(([st, list])=> (
            <div key={st} className="rounded-xl bg-white/5 border border-white/10 p-4">
              <div className="font-medium mb-2">{st} ({(list as any[]).length})</div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400">
                      <th className="text-left p-2">Order</th>
                      <th className="text-left p-2">Cargo</th>
                      <th className="text-left p-2">Qty (T)</th>
                      <th className="text-left p-2">Source</th>
                      <th className="text-left p-2">Destination</th>
                      <th className="text-left p-2">Rake</th>
                      <th className="text-left p-2">Committed</th>
                      <th className="text-left p-2">Actions</th>
                      <th className="text-left p-2">Project</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(list as any[]).map((o:any)=> (
                      <tr key={o.id} className="border-t border-white/10 hover:bg-white/5">
                        <td className="p-2 font-mono">{o.id.slice(0,8)}</td>
                        <td className="p-2">{o.cargo}</td>
                        <td className="p-2">{o.quantityTons}</td>
                        <td className="p-2">{o.sourcePlant}</td>
                        <td className="p-2">{o.destination}</td>
                        <td className="p-2">{o.rakeId || '—'}</td>
                        <td className="p-2">
                          {o.committedRoute ? (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/40 text-emerald-200">
                                {o.committedRoute.id || 'Committed'}
                              </span>
                              <a
                                className="underline text-indigo-300"
                                href={`/map?plant=${encodeURIComponent(o.committedRoute.plant)}&cmo=${encodeURIComponent(o.committedRoute.cmo)}${o.committedRoute.id?`&alt=${encodeURIComponent(o.committedRoute.id)}`:''}`}
                                title="View on map"
                              >View</a>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="p-2 text-xs">
                          <a
                            className="underline text-cyan-300"
                            href={`/optimizer?source=${encodeURIComponent(o.sourcePlant || '')}&target=${encodeURIComponent((o.destination||'').split(',')[0])}&autorun=1`}
                            title="Re-compare routes in Optimizer"
                          >Re-compare</a>
                        </td>
                        <td className="p-2">{o.project? `${o.project.city} (${o.project.nearestCMO})`: '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
