"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";
import { useParams } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import { useToast } from "@/components/Toast";
import io from "socket.io-client";

export default function CustomerTracking(){
  const params = useParams() as { order_id?: string };
  const orderId = params?.order_id || '';
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [speedKph, setSpeedKph] = useState<number>(50);
  const [dwellHours, setDwellHours] = useState<number>(3);
  const [etaCalc, setEtaCalc] = useState<null | { eta: string; confidence: number; transitHours: number; route?: { from: string; to: string; distanceKm: number }, multipliers?: { congestion: number; weather: number } }>(null);
  const [etaLoading, setEtaLoading] = useState(false);
  const [departedAt, setDepartedAt] = useState<string>(new Date().toISOString().slice(0,16));
  const [currentLocation, setCurrentLocation] = useState<string>("");
  const Toast = useToast();
  useEffect(()=>{
    const load = async ()=>{
      try{
        const token = localStorage.getItem('token')||'';
        const r = await fetch(withBase(`/api/v1/customer/orders/${orderId}/tracking`), { headers: { Authorization: `Bearer ${token}` }});
        if(!r.ok) throw new Error('Failed');
        setData(await r.json());
      }catch(e:any){ setError(e?.message||'error'); }
    };
    if(orderId) load();
    // optional sockets: append events
    const s = (window as any).io ? (window as any).io() : io();
    const onNotif = (n:any)=>{
      if(!n) return;
      setData((prev:any)=> {
        if(!prev) return prev;
        const ev = { ts: Date.now(), type: n.type || 'info', note: n.message || `${n.type} ${n.reason || ''}` };
        const next = { ...prev, events: [ev, ...(prev.events||[])] };
        return next;
      });
    };
    const onPos = (_p:any)=>{ /* could append finer-grain movement events if needed */ };
    s.on('notification', onNotif);
    s.on('positions', onPos);
    return () => { s.off('notification', onNotif); s.off('positions', onPos); };
  },[orderId]);
  if(!orderId) return <main className="p-6">Missing order id</main>;
  if(error) return <main className="p-6">Error: {error}</main>;
  if(!data) return <main className="p-6">Loading…</main>;
  return (
    <main className="p-6 space-y-4">
      <h2 className="text-2xl font-semibold">Order Tracking — {orderId}</h2>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="rounded-xl bg-white/5 p-4 border border-white/10">
          <div className="text-xs text-gray-400">Rake</div>
          <div className="text-xl font-semibold">{data.rake_id}</div>
          <div className="text-xs text-gray-400 mt-2">ETA</div>
          <div className="text-lg">{new Date(data.ETA).toLocaleString()}</div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <label className="text-gray-400">Speed (kph)</label>
              <input type="number" className="w-20 bg-transparent border border-white/20 rounded px-2 py-1" value={speedKph} onChange={e=> setSpeedKph(Number(e.target.value||0))} />
              <label className="text-gray-400">Dwell (h)</label>
              <input type="number" className="w-20 bg-transparent border border-white/20 rounded px-2 py-1" value={dwellHours} onChange={e=> setDwellHours(Number(e.target.value||0))} />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label className="text-gray-400">Departed At</label>
              <input type="datetime-local" className="bg-transparent border border-white/20 rounded px-2 py-1" value={departedAt} onChange={e=> setDepartedAt(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label className="text-gray-400">Current Location</label>
              <select className="bg-transparent border border-white/20 rounded px-2 py-1" value={currentLocation} onChange={e=> setCurrentLocation(e.target.value)}>
                <option value="">Select plant…</option>
                <option value="Bokaro">Bokaro (BKSC)</option>
                <option value="Durgapur">Durgapur (DGR)</option>
                <option value="Rourkela">Rourkela (ROU)</option>
                <option value="Bhilai">Bhilai (BPHB)</option>
              </select>
              <input type="text" placeholder="Custom location" className="bg-transparent border border-white/20 rounded px-2 py-1" value={currentLocation} onChange={e=> setCurrentLocation(e.target.value)} />
            </div>
            <div className="text-[10px] text-gray-500">Tip: Select a plant from the dropdown for consistency, or type a custom location if needed.</div>
            <button
              className="px-3 py-1 rounded border border-white/20 text-xs disabled:opacity-60"
              disabled={etaLoading}
              onClick={async ()=>{
                try{
                  setEtaLoading(true);
                  const token = localStorage.getItem('token')||'';
                  const resp = await fetch(withBase('/ai/eta'), {
                    method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ destination: data?.last_known_location?.name || 'Destination', source: data?.rake_id || 'Rake', speedKph, dwellHours, departedAt: departedAt ? new Date(departedAt).toISOString() : undefined, currentLocation: currentLocation || undefined, context: `tracking/${orderId}` })
                  });
                  if(!resp.ok) throw new Error('failed');
                  const j = await resp.json();
                  setEtaCalc({ eta: j.eta, confidence: j.confidence, transitHours: j.transitHours, route: j.route, multipliers: j.multipliers });
                  try { trackEvent('customer_eta_recalc', { page: `/customer/tracking/${orderId}`, action: 'recalc_eta', meta: { speedKph, dwellHours } }); } catch {}
                  try { Toast.push({ text: 'ETA recalculated', tone: 'success' }); } catch {}
                }catch{ setEtaCalc(null); }
                finally{ setEtaLoading(false); }
              }}
            >{etaLoading ? 'Calculating…' : 'Recalculate ETA'}</button>
            {etaCalc && (
              <div className="text-xs text-gray-300">
                <div>ETA: {new Date(etaCalc.eta).toLocaleString()} · {etaCalc.transitHours}h · conf {(etaCalc.confidence*100).toFixed(0)}%</div>
                {etaCalc.route && (
                  <div className="mt-1 text-[11px] text-gray-400">
                    Route: {etaCalc.route.from} → {etaCalc.route.to} · {etaCalc.route.distanceKm} km
                  </div>
                )}
                {etaCalc.multipliers && (
                  <div className="text-[11px] text-gray-400">Multipliers: congestion ×{etaCalc.multipliers.congestion}, weather ×{etaCalc.multipliers.weather}</div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="rounded-xl bg-white/5 p-4 border border-white/10 md:col-span-2">
          <div className="text-xs text-gray-400">Last Known Location</div>
          <div className="text-sm">{data.last_known_location?.name} ({data.last_known_location?.lat?.toFixed(3)},{data.last_known_location?.lng?.toFixed(3)})</div>
          <div className="text-xs text-gray-400 mt-2">Events</div>
          <ul className="text-xs space-y-1">
            {(data.events||[]).map((e:any,i:number)=> <li key={i}>• [{new Date(e.ts).toLocaleTimeString()}] {e.type} — {e.note}</li>)}
          </ul>
        </div>
      </div>
    </main>
  );
}
