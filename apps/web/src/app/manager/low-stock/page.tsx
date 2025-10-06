"use client";
import Guard from "@/components/Guard";
import { withBase } from "@/lib/config";
import { useEffect, useState } from "react";

type Report = { id: number; stockyardCity: string; product: string; currentTons?: number|null; thresholdTons?: number|null; requiredTons?: number|null; reporter: string; status?: string; ackBy?: string|null; ackAt?: string|null; clearedBy?: string|null; clearedAt?: string|null; ts: string };

export default function ManagerLowStock(){
  const [reports,setReports] = useState<Report[]>([]);
  const [loading,setLoading] = useState(true);
  const [err,setErr] = useState<string | null>(null);
  const [actionMsg,setActionMsg] = useState<string>("");
  const [lastPlan,setLastPlan] = useState<any>(null);

  const load = async ()=>{
    setLoading(true); setErr(null);
    try {
      const token = localStorage.getItem('token')||'';
      const r = await fetch(withBase('/stock/low-stock/reports'), { headers: { Authorization: `Bearer ${token}` } });
      if(!r.ok){ setErr(`Failed to load (${r.status})`); setLoading(false); return; }
      const j = await r.json();
      setReports(Array.isArray(j.reports)? j.reports: []);
    } catch(e:any){ setErr(e?.message||'Network error'); }
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  const issue = async (rep: Report)=>{
    setActionMsg(""); setErr(null);
    try{
      const token = localStorage.getItem('token')||'';
      const quantityTons = rep.requiredTons || rep.thresholdTons || 600;
      const r = await fetch(withBase('/manager/orders/issue'), {
        method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
        body: JSON.stringify({ stockyardCity: rep.stockyardCity, product: rep.product, quantityTons, priority:'Urgent', sourcePlant: 'Bokaro Steel Plant' })
      });
      if(!r.ok){ const t = await r.text(); setErr(`Issue failed (${r.status}). ${t}`); return; }
      const j = await r.json();
      setActionMsg(`Order issued for ${rep.product} to ${rep.stockyardCity}.`);
      setLastPlan(j.plan || null);
    }catch(e:any){ setErr(e?.message||'Network error'); }
  };

  const ack = async (rep: Report) => {
    setErr(null); setActionMsg("");
    try {
      const token = localStorage.getItem('token')||'';
      const r = await fetch(withBase(`/stock/low-stock/${rep.id}/ack`), { method:'POST', headers:{ Authorization:`Bearer ${token}` } });
      if(!r.ok){ setErr(`Ack failed (${r.status})`); return; }
      setActionMsg('Report acknowledged');
      await load();
    } catch(e:any){ setErr(e?.message||'Network error'); }
  };
  const clearRep = async (rep: Report) => {
    setErr(null); setActionMsg("");
    try {
      const token = localStorage.getItem('token')||'';
      const r = await fetch(withBase(`/stock/low-stock/${rep.id}/clear`), { method:'POST', headers:{ Authorization:`Bearer ${token}` } });
      if(!r.ok){ setErr(`Clear failed (${r.status})`); return; }
      setActionMsg('Report cleared');
      await load();
    } catch(e:any){ setErr(e?.message||'Network error'); }
  };

  return (
    <Guard allow={["manager","admin"]}>
      <main className="p-6 space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Low Stock Reports</h1>
          <button onClick={load} className="text-sm rounded border border-white/10 px-3 py-1">Refresh</button>
        </div>
        {loading? <p className="opacity-80">Loading…</p> : err? <div className="text-red-400">{err}</div> : (
          <div className="rounded-xl border border-white/10 p-3 bg-white/5">
            {reports.length? (
              <div className="overflow-x-auto">
                <table className="min-w-[720px] text-sm">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="text-left px-3 py-2">Time</th>
                      <th className="text-left px-3 py-2">Stockyard</th>
                      <th className="text-left px-3 py-2">Product</th>
                      <th className="text-right px-3 py-2">Current</th>
                      <th className="text-right px-3 py-2">Threshold</th>
                      <th className="text-right px-3 py-2">Required</th>
                      <th className="text-left px-3 py-2">Reporter</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="text-left px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map(rep => (
                      <tr key={rep.id} className="border-t border-white/10">
                        <td className="px-3 py-2">{new Date(rep.ts).toLocaleString()}</td>
                        <td className="px-3 py-2">{rep.stockyardCity}</td>
                        <td className="px-3 py-2">{rep.product}</td>
                        <td className="px-3 py-2 text-right">{rep.currentTons ?? '—'}</td>
                        <td className="px-3 py-2 text-right">{rep.thresholdTons ?? '—'}</td>
                        <td className="px-3 py-2 text-right">{rep.requiredTons ?? '—'}</td>
                        <td className="px-3 py-2">{rep.reporter}</td>
                        <td className="px-3 py-2">{rep.status || 'OPEN'}</td>
                        <td className="px-3 py-2">
                          <button onClick={()=>issue(rep)} className="text-xs rounded bg-brand-green text-black px-2 py-1">Issue Order (Bokaro → Yard)</button>
                          <button onClick={()=>ack(rep)} className="ml-2 text-xs rounded border border-white/20 px-2 py-1">Ack</button>
                          <button onClick={()=>clearRep(rep)} className="ml-2 text-xs rounded border border-white/20 px-2 py-1">Clear</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="opacity-80 text-sm">No reports yet.</p>}
            {actionMsg && <div className="mt-2 text-green-400 text-sm">{actionMsg}</div>}
            {lastPlan && (
              <div className="mt-4 rounded-lg border border-white/10 p-3 bg-black/30">
                <h3 className="font-medium mb-2">Proposed Rake Plan</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <div><span className="text-gray-400">Origin</span><br/>{lastPlan.origin}</div>
                  <div><span className="text-gray-400">Destination</span><br/>{lastPlan.destination}</div>
                  <div><span className="text-gray-400">Distance</span><br/>{lastPlan.distanceKm} km</div>
                  <div><span className="text-gray-400">Wagons</span><br/>{lastPlan.wagonsUsed} × {lastPlan.capacityPerWagon}t</div>
                  <div><span className="text-gray-400">Utilization</span><br/>{lastPlan.utilizationPct}%</div>
                  <div><span className="text-gray-400">Depart</span><br/>{new Date(lastPlan.departAt).toLocaleString()}</div>
                  <div><span className="text-gray-400">ETA</span><br/>{new Date(lastPlan.eta).toLocaleString()} ({lastPlan.transitHours}h)</div>
                  <div><span className="text-gray-400">Cost</span><br/>₹{(lastPlan.cost?.total||0).toLocaleString()}</div>
                  <div><span className="text-gray-400">Emissions</span><br/>{lastPlan.emissionsTons} tCO₂</div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </Guard>
  );
}
