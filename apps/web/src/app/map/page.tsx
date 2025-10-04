"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ALT_ROUTES, keyFor } from "@/lib/altRoutes";
import { withBase } from "@/lib/config";
const MapLive = dynamic(() => import("@/components/MapLive"), { ssr: false });

export default function MapPage() {
  const search = useSearchParams();
  const [plant, setPlant] = useState("Bokaro");
  const [cmo, setCmo] = useState("Delhi");
  const key = useMemo(()=> keyFor(plant, cmo), [plant,cmo]);
  const options = ALT_ROUTES[key] || [];
  const [selected, setSelected] = useState<string>(options[0]?.id || "");
  const [compare, setCompare] = useState<{ routes: { id: string; distanceKm: number; etaHours: number; co2Tons: number; cost: number }[]; bestBy: { cost: string; eta: string; co2: string } }|null>(null);
  const [overlayPath, setOverlayPath] = useState<{ name: string; lat: number; lng: number }[] | null>(null);
  const [overlayExpired, setOverlayExpired] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  useEffect(()=>{ setSelected(options[0]?.id || ""); setCompare(null); }, [key]);
  // On first load, honor query params plant, cmo, alt, overlay
  useEffect(()=>{
    const qpPlant = search?.get('plant');
    const qpCmo = search?.get('cmo');
    const qpAlt = search?.get('alt');
    const qpOverlay = search?.get('overlay');
    if (qpPlant) setPlant(qpPlant);
    if (qpCmo) setCmo(qpCmo);
    if (qpAlt) setSelected(qpAlt);
    // If overlay token is present, fetch path
    if (qpOverlay) {
      const token = localStorage.getItem('token')||'';
      fetch(withBase(`/planner/plan/overlay/${qpOverlay}`), { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(j => {
          const raw = Array.isArray(j.waypoints) ? j.waypoints.filter((p:any)=> typeof p.lat==='number' && typeof p.lng==='number') : [];
          const pts = raw.map((p:any, i:number) => ({ name: p.name || `WP ${i+1}` , lat: p.lat, lng: p.lng }));
          if (pts.length>=2) setOverlayPath(pts);
        }).catch((code)=>{ if (code === 410) setOverlayExpired(true); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const coords: Record<string,[number,number]> = {
    Bokaro:[23.64,86.16], Patna:[25.594,85.137], Varanasi:[25.317,82.973], Kanpur:[26.4499,80.3319], Delhi:[28.6139,77.2090],
    Asansol:[23.688,86.966], Dhanbad:[23.795,86.428], Ranchi:[23.344,85.309], Allahabad:[25.4358,81.8463],
    Gaya:[24.791,85.000], Mughalsarai:[25.274,83.121], Jamshedpur:[22.8046,86.2029], Durgapur:[23.5204,87.3119], Lucknow:[26.8467,80.9462],
    Bhilai:[21.1938,81.3509], Nagpur:[21.1458,79.0882], Bhusawal:[21.043,75.785], Mumbai:[19.0760,72.8777], Raipur:[21.2514,81.6296], Gondia:[21.4625,80.2209], Itarsi:[22.607,77.762], Wardha:[20.7453,78.6022], Manmad:[20.5537,74.5300], Bilaspur:[22.0797,82.1409], Durg:[21.1904,81.2849], Khandwa:[21.8257,76.3520],
    Rourkela:[22.2604,84.8536], "Tata Nagar":[22.8046,86.2029], Kharagpur:[22.3460,87.2310], Kolkata:[22.5726,88.3639], Jharsuguda:[21.8553,84.0069], Dhenkanal:[20.6574,85.5981], Cuttack:[20.4625,85.8828], Angul:[20.8400,85.1000], Bhubaneswar:[20.2961,85.8245], Ranchi2:[23.344,85.309], Durgapur2:[23.5204,87.3119], Asansol2:[23.688,86.966],
    Burnpur:[23.6770,86.9630], Patna2:[25.594,85.137], Jhajha:[24.7735,86.3730], Hazaribagh:[23.9966,85.3691], Varanasi2:[25.317,82.973], Dhanbad2:[23.795,86.428], Gaya2:[24.791,85.000]
  };
  return (
    <main className="p-6 space-y-6">
      <h2 className="text-2xl font-semibold">Map & Route Visualization</h2>
      {overlayExpired && (
        <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 px-3 py-2 rounded">
          The overlay token has expired. Showing the selected alternative route instead.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">Plant
          <select className="bg-transparent border border-white/20 rounded px-2 py-1" value={plant} onChange={e=>setPlant(e.target.value)}>
            <option>Bokaro</option>
            <option>Bhilai</option>
            <option>Rourkela</option>
            <option>Durgapur</option>
            <option>Burnpur</option>
          </select>
        </label>
        <label className="flex items-center gap-2">CMO City
          <select className="bg-transparent border border-white/20 rounded px-2 py-1" value={cmo} onChange={e=>setCmo(e.target.value)}>
            <option>Delhi</option>
            <option>Mumbai</option>
            <option>Kolkata</option>
            <option>Patna</option>
          </select>
        </label>
        <span className="text-xs text-gray-400">Alt routes available: {options.length}</span>
        {options.length>0 && (
          <select className="bg-transparent border border-white/20 rounded px-2 py-1" value={selected} onChange={e=>setSelected(e.target.value)}>
            {options.map(o=> <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        <button
          className="ml-auto px-3 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 disabled:opacity-50"
          disabled={commitBusy || (!overlayPath && !selected)}
          onClick={async ()=>{
            setCommitBusy(true);
            try {
              const token = localStorage.getItem('token')||'';
              const basePayload:any = { plant, cmo, alternative: { id: selected || 'overlay', name: selected || 'overlay' } };
              if (Array.isArray(overlayPath) && overlayPath.length>=2) {
                basePayload.waypoints = overlayPath.map(p=> ({ name: p.name, lat: p.lat, lng: p.lng }));
              } else {
                const coords: Record<string,[number,number]> = {
                  Bokaro:[23.64,86.16], Patna:[25.594,85.137], Varanasi:[25.317,82.973], Kanpur:[26.4499,80.3319], Delhi:[28.6139,77.2090],
                  Asansol:[23.688,86.966], Dhanbad:[23.795,86.428], Ranchi:[23.344,85.309], Allahabad:[25.4358,81.8463],
                  Gaya:[24.791,85.000], Mughalsarai:[25.274,83.121], Jamshedpur:[22.8046,86.2029], Durgapur:[23.5204,87.3119], Lucknow:[26.8467,80.9462],
                  Bhilai:[21.1938,81.3509], Nagpur:[21.1458,79.0882], Bhusawal:[21.043,75.785], Mumbai:[19.0760,72.8777], Raipur:[21.2514,81.6296], Gondia:[21.4625,80.2209], Itarsi:[22.607,77.762], Wardha:[20.7453,78.6022], Manmad:[20.5537,74.5300], Bilaspur:[22.0797,82.1409], Durg:[21.1904,81.2849], Khandwa:[21.8257,76.3520],
                  Rourkela:[22.2604,84.8536], "Tata Nagar":[22.8046,86.2029], Kharagpur:[22.3460,87.2310], Kolkata:[22.5726,88.3639], Jharsuguda:[21.8553,84.0069], Dhenkanal:[20.6574,85.5981], Cuttack:[20.4625,85.8828], Angul:[20.8400,85.1000], Bhubaneswar:[20.2961,85.8245], Ranchi2:[23.344,85.309], Durgapur2:[23.5204,87.3119], Asansol2:[23.688,86.966],
                  Burnpur:[23.6770,86.9630], Patna2:[25.594,85.137], Jhajha:[24.7735,86.3730], Hazaribagh:[23.9966,85.3691], Varanasi2:[25.317,82.973], Dhanbad2:[23.795,86.428], Gaya2:[24.791,85.000]
                };
                const route = options.find(o=> o.id===selected);
                if (route) {
                  const wp = route.waypoints.map(w=> ({ name: w, lat: coords[w]?.[0], lng: coords[w]?.[1] })).filter(p=> p.lat && p.lng);
                  if (wp.length>=2) basePayload.waypoints = wp;
                }
              }
              // basic metrics approximation if we have waypoints
              if (Array.isArray(basePayload.waypoints) && basePayload.waypoints.length>=2) {
                const hav = (a:[number,number], b:[number,number])=>{ const R=6371; const toRad=(d:number)=>d*Math.PI/180; const dLat=toRad(b[0]-a[0]); const dLng=toRad(b[1]-a[1]); const la1=toRad(a[0]); const la2=toRad(b[0]); const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
                let dist = 0; for (let i=1;i<basePayload.waypoints.length;i++){ const a=basePayload.waypoints[i-1]; const b=basePayload.waypoints[i]; dist += hav([a.lat,a.lng],[b.lat,b.lng]); }
                basePayload.metrics = { distanceKm: Math.round(dist) };
              }
              async function trySeq(paths:string[]) {
                for (const p of paths) {
                  try {
                    const r = await fetch(withBase(p), { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body: JSON.stringify(basePayload) });
                    if (r.ok) return await r.json();
                  } catch {}
                }
                throw new Error('all_failed');
              }
              const resp = await trySeq(['/planner/plan/commit','/manager/plan/commit','/cmo/plan/commit','/admin/plan/commit']);
              const qp = new URLSearchParams({ plant, cmo, alt: basePayload.alternative.id });
              if (resp?.overlayToken) qp.set('overlay', resp.overlayToken);
              window.location.href = `/map?${qp.toString()}`;
            } catch (_) {
              // no-op
            } finally { setCommitBusy(false); }
          }}
        >{commitBusy? 'Committing…' : 'Commit this Route'}</button>
      </div>
      <div className="rounded-xl overflow-hidden border border-white/10">
        <MapLive
          selectedAltRoute={
            overlayPath
              ? overlayPath
              : (options.find(o=>o.id===selected)?.waypoints||[]).map(w=> ({ name:w, lat: coords[w]?.[0], lng: coords[w]?.[1] })).filter(p=> p.lat&&p.lng)
          }
        />
      </div>
      {options.length>0 && (
        <div className="rounded-xl border border-white/10 p-3 text-sm bg-white/5 space-y-3">
          <div className="font-medium">Compare Alternatives — AI Planner</div>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1 rounded border border-white/20" onClick={async ()=>{
              const token = localStorage.getItem('token')||'';
              const routes = options.map(o => ({ id: o.id, waypoints: o.waypoints.map(w => ({ name:w, lat: coords[w]?.[0], lng: coords[w]?.[1] })).filter(p=> p.lat&&p.lng) })).filter(r=> r.waypoints.length>=2);
              const resp = await fetch(withBase('/ai/alt/compare'), { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plant, cmo, cargo: 'steel', tonnage: 3000, routes }) });
              if (!resp.ok) { setCompare(null); return; }
              const j = await resp.json(); setCompare(j);
            }}>Run Compare</button>
            {compare && <span className="text-xs text-gray-400">Best — Cost: {compare.bestBy.cost}, ETA: {compare.bestBy.eta}, CO₂: {compare.bestBy.co2}</span>}
          </div>
          {compare && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead><tr className="text-gray-400"><th className="text-left p-2">Route</th><th className="text-left p-2">Distance (km)</th><th className="text-left p-2">ETA (h)</th><th className="text-left p-2">CO₂ (t)</th><th className="text-left p-2">Cost</th></tr></thead>
                <tbody>
                  {compare.routes.map(r => (
                    <tr key={r.id} className="border-t border-white/10">
                      <td className="p-2 font-mono">{r.id}</td>
                      <td className="p-2">{r.distanceKm}</td>
                      <td className={`p-2 ${compare.bestBy.eta===r.id?'text-emerald-400':''}`}>{r.etaHours}</td>
                      <td className={`p-2 ${compare.bestBy.co2===r.id?'text-emerald-400':''}`}>{r.co2Tons}</td>
                      <td className={`p-2 ${compare.bestBy.cost===r.id?'text-emerald-400':''}`}>{r.cost.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-[11px] text-gray-500">Legend: Highlighted values are best across alternatives. Coefficients are demo-friendly; wire in live planner metrics next.</div>
        </div>
      )}
      {options.length>0 && (
        <div className="rounded-xl border border-white/10 p-3 text-sm bg-white/5">
          <div className="font-medium mb-1">Alternative Routes — {plant} → {cmo}</div>
          <ol className="list-decimal pl-6 space-y-1">
            {options.map(o => (
              <li key={o.id} className="text-xs">{o.name} <span className="text-gray-500">({o.waypoints.join(' → ')})</span></li>
            ))}
          </ol>
          <div className="text-xs text-gray-400 mt-2">AI can compare distance, time, cost, and risk across these options.</div>
        </div>
      )}
    </main>
  );
}
