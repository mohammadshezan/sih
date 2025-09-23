"use client";
import { useEffect, useMemo, useState } from "react";
import { withBase } from "@/lib/config";

type Rake = { id: string; name: string; route: string; status: string; cargoType: string; locomotive: string; grade: string; tonnage: number };
type Wagon = { id: string; rake: string; type: string; cargo: string; capacityTons: number; loadedTons: number };

export default function PlannerPage() {
  const [rakes, setRakes] = useState<Rake[]>([]);
  const [wagons, setWagons] = useState<Wagon[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    setLoading(true);
    Promise.all([
      fetch(withBase('/rakes'), { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json()),
      fetch(withBase('/wagons'), { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json()),
    ]).then(([r, w]) => { setRakes(Array.isArray(r)? r: []); setWagons(Array.isArray(w)? w: []); }).finally(()=> setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const map: Record<string, { rake: Rake; wagons: Wagon[]; capacity: number; loaded: number }> = {};
    rakes.forEach(r => { map[r.id] = { rake: r, wagons: [], capacity: 0, loaded: 0 }; });
    wagons.forEach(w => {
      if (!map[w.rake]) return;
      map[w.rake].wagons.push(w);
      map[w.rake].capacity += w.capacityTons;
      map[w.rake].loaded += w.loadedTons;
    });
    return Object.values(map);
  }, [rakes, wagons]);

  function simulateLoad(rakeId: string, delta: number) {
    setWagons(prev => prev.map(w => w.rake === rakeId ? { ...w, loadedTons: Math.max(0, Math.min(w.capacityTons, w.loadedTons + Math.round(delta/ (grouped.find(g=>g.rake.id===rakeId)?.wagons.length || 1)))) } : w));
  }

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Planner</h2>
        <div className="flex items-center gap-3">
          <a href="/rakes/new" className="text-sm rounded-md bg-white/10 border border-white/10 px-3 py-1">Create Rake</a>
          {loading && <span className="text-xs text-gray-400">Loading…</span>}
        </div>
      </div>
      <p className="text-sm text-gray-300">Plan loads per rake and validate capacity before dispatch. This demo uses mock data.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {grouped.map(({ rake, wagons, capacity, loaded }) => {
          const pct = Math.round((loaded / Math.max(1, capacity)) * 100);
          return (
            <div key={rake.id} className="rounded-xl bg-white/5 p-4 border border-white/10">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-medium">{rake.name} <span className="text-xs text-gray-400">({rake.id})</span></h3>
                  <p className="text-xs text-gray-400">Route: {rake.route} · Cargo: {rake.cargoType} · Loco: {rake.locomotive} · Grade: {rake.grade}</p>
                  <p className="text-xs text-gray-400">Status: {rake.status} · Planned Tonnage: {rake.tonnage}t</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold">{loaded} / {capacity}t</p>
                  <p className="text-xs text-gray-400">{pct}% loaded</p>
                </div>
              </div>
              <div className="h-2 bg-white/10 rounded mt-2">
                <div className={`h-2 rounded ${pct>=100? 'bg-brand-green': pct>=80? 'bg-brand-yellow': 'bg-white/30'}`} style={{ width: `${Math.min(100,pct)}%` }} />
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                {wagons.map(w => (
                  <div key={w.id} className="bg-white/5 rounded-md p-2 border border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{w.id}</span>
                      <span className="text-xs text-gray-400">{w.type}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-1">
                      <span>{w.cargo}</span>
                      <span>{w.loadedTons}/{w.capacityTons}t</span>
                    </div>
                    <div className="h-1 bg-white/10 rounded mt-1"><div className="h-1 bg-brand-green rounded" style={{ width: `${Math.round((w.loadedTons/Math.max(1,w.capacityTons))*100)}%`}} /></div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={()=> simulateLoad(rake.id, +20)} className="rounded-md bg-brand-green text-black px-3 py-1 text-sm">Load +20t</button>
                <button onClick={()=> simulateLoad(rake.id, -20)} className="rounded-md border border-white/10 px-3 py-1 text-sm">Unload -20t</button>
                <a href={`/rakes/${encodeURIComponent(rake.id)}`} className="rounded-md bg-white/10 border border-white/10 px-3 py-1 text-sm">Open Detail</a>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
