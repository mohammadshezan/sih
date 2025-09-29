"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function ConstraintRulesPage() {
  const [constraints, setConstraints] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    fetch(withBase('/optimizer/constraints'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then(setConstraints).catch(()=> setConstraints(null));
  }, []);

  async function save() {
    setError(""); setLoading(true);
    try {
      const token = localStorage.getItem('token') || '';
      const r = await fetch(withBase('/optimizer/constraints'), {
        method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}`},
        body: JSON.stringify({ constraints: undefined, // hint to avoid sending full
          minRakeSize: constraints?.constraints?.minRakeSize,
          maxRakeSize: constraints?.constraints?.maxRakeSize,
          loadingPoints: constraints?.constraints?.loadingPoints,
          wagonTypes: constraints?.constraints?.wagonTypes,
        })
      });
      if (!r.ok) throw new Error(`Save failed (${r.status})`);
      alert('Saved');
    } catch (e: any) {
      setError(e?.message || 'Failed to save');
    } finally { setLoading(false); }
  }

  if (!constraints) return <main className="p-6">Loading…</main>;
  const c = constraints.constraints || {};

  return (
    <main className="p-6 space-y-6">
      <h2 className="text-2xl font-semibold">Constraint Rules</h2>
      <p className="text-sm text-gray-400">Admin-only. Adjust optimizer business rules.</p>

      <section className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="mb-2">Rake Size</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Min Tons</label>
            <input type="number" value={c.minRakeSize?.tons||0} onChange={e=>setConstraints((x:any)=>({ ...x, constraints: { ...x.constraints, minRakeSize: { ...x.constraints.minRakeSize, tons: Number(e.target.value) }}}))} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Min Wagons</label>
            <input type="number" value={c.minRakeSize?.wagons||0} onChange={e=>setConstraints((x:any)=>({ ...x, constraints: { ...x.constraints, minRakeSize: { ...x.constraints.minRakeSize, wagons: Number(e.target.value) }}}))} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Max Tons</label>
            <input type="number" value={c.maxRakeSize?.tons||0} onChange={e=>setConstraints((x:any)=>({ ...x, constraints: { ...x.constraints, maxRakeSize: { ...x.constraints.maxRakeSize, tons: Number(e.target.value) }}}))} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Max Wagons</label>
            <input type="number" value={c.maxRakeSize?.wagons||0} onChange={e=>setConstraints((x:any)=>({ ...x, constraints: { ...x.constraints, maxRakeSize: { ...x.constraints.maxRakeSize, wagons: Number(e.target.value) }}}))} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2" />
          </div>
        </div>
      </section>

      <section className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="mb-2">Loading Points</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.keys(c.loadingPoints||{}).map((plant) => (
            <div key={plant} className="bg-white/5 rounded-md p-3 border border-white/10">
              <div className="font-medium mb-2">{plant}</div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Capacity</label>
                  <input type="number" value={c.loadingPoints[plant].capacity||0} onChange={e=>setConstraints((x:any)=>({ ...x, constraints: { ...x.constraints, loadingPoints: { ...x.constraints.loadingPoints, [plant]: { ...x.constraints.loadingPoints[plant], capacity: Number(e.target.value) }}}}))} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Sidings</label>
                  <input type="number" value={c.loadingPoints[plant].sidings||0} onChange={e=>setConstraints((x:any)=>({ ...x, constraints: { ...x.constraints, loadingPoints: { ...x.constraints.loadingPoints, [plant]: { ...x.constraints.loadingPoints[plant], sidings: Number(e.target.value) }}}}))} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Hourly</label>
                  <input type="number" value={c.loadingPoints[plant].hourly||0} onChange={e=>setConstraints((x:any)=>({ ...x, constraints: { ...x.constraints, loadingPoints: { ...x.constraints.loadingPoints, [plant]: { ...x.constraints.loadingPoints[plant], hourly: Number(e.target.value) }}}}))} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="mb-2">Wagon Compatibility</h3>
        <div className="space-y-2 text-sm">
          {Object.keys(c.wagonTypes||{}).map((type) => (
            <div key={type} className="bg-white/5 rounded-md p-3 border border-white/10">
              <div className="flex items-center justify-between">
                <div className="font-medium">{type}</div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Cap</span>
                  <input type="number" value={c.wagonTypes[type].capacity||0} onChange={e=>setConstraints((x:any)=>({ ...x, constraints: { ...x.constraints, wagonTypes: { ...x.constraints.wagonTypes, [type]: { ...x.constraints.wagonTypes[type], capacity: Number(e.target.value) }}}}))} className="w-24 bg-black/40 border border-white/10 rounded-md px-2 py-1" />
                </div>
              </div>
              <div className="text-xs text-gray-400 mt-1">Compatible: {(c.wagonTypes[type].compatible||[]).join(', ')}</div>
            </div>
          ))}
        </div>
      </section>

      {error && <p className="text-sm text-brand-red">{error}</p>}
      <button onClick={save} disabled={loading} className="rounded-md bg-brand-green text-black px-4 py-2">{loading ? 'Saving…':'Save Changes'}</button>
    </main>
  );
}
