"use client";
import { useEffect, useMemo, useState } from "react";
import io from "socket.io-client";
import { withBase, SOCKET_URL } from "@/lib/config";

const socket = SOCKET_URL ? io(SOCKET_URL) : io();

type Rake = { id: string; name: string; route: string; status: string; cargoType: string; locomotive: string; grade: string; tonnage: number };
type Wagon = { id: string; rake: string; type: string; cargo: string; capacityTons: number; loadedTons: number };
type LedgerBlock = { hash: string; type: string; rakeId: string; from?: string; to?: string; cargo?: string; tonnage?: number; actor?: string; ts: number };

type Props = { params: { id: string } };
export default function RakeDetailPage({ params }: Props) {
  const rakeId = decodeURIComponent(params.id);
  const [rake, setRake] = useState<Rake | null>(null);
  const [wagons, setWagons] = useState<Wagon[]>([]);
  const [rfid, setRfid] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Array<{ ts: number; text: string }>>([]);
  const [latestBlock, setLatestBlock] = useState<LedgerBlock | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    // load rake and wagons from mock endpoints
  fetch(withBase('/rakes'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then((rs:any[])=> setRake((rs||[]).find((r:any)=> r.id === rakeId) || null)).catch(()=> setRake(null));
  fetch(withBase('/wagons'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then((ws:any[])=> setWagons((ws||[]).filter((w:any)=> w.rake === rakeId))).catch(()=> setWagons([]));
  fetch(withBase('/positions'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then((ps:any[])=> { const p = (ps||[]).find((x:any)=> x.id === rakeId); if (p?.rfid) setRfid(p.rfid); }).catch(()=>{});
  fetch(withBase('/ledger'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then((d:any)=>{
        const chain: LedgerBlock[] = d?.chain || d?.ledger || [];
        const last = chain.filter(b=> b.rakeId === rakeId).sort((a,b)=> (b.ts||0)-(a.ts||0))[0] || null;
        setLatestBlock(last);
      }).catch(()=> setLatestBlock(null));

    const onAlert = (a:any) => {
      if (a?.rakeId === rakeId) setTimeline(prev => [{ ts: a.ts || Date.now(), text: a.message || 'Update' }, ...prev]);
    };
    socket.on('alert', onAlert);
    return () => { socket.off('alert', onAlert); };
  }, [rakeId]);

  const capacity = useMemo(()=> wagons.reduce((s,w)=> s + (w.capacityTons||0), 0), [wagons]);
  const loaded = useMemo(()=> wagons.reduce((s,w)=> s + (w.loadedTons||0), 0), [wagons]);
  const pct = capacity>0 ? Math.round((loaded/capacity)*100) : 0;

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Rake {rakeId}</h2>
        <a href="/planner" className="text-sm underline">Back to Planner</a>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 rounded-xl bg-white/5 p-4 border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-medium">{rake?.name || '(Unknown)'}</p>
              <p className="text-xs text-gray-400">Route: {rake?.route} · Status: {rake?.status} · Cargo: {rake?.cargoType} · Loco: {rake?.locomotive}</p>
              <p className="text-xs text-gray-400">RFID: {rfid || '—'}</p>
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
        </div>
        <div className="rounded-xl bg-white/5 p-4 border border-white/10">
          <h3 className="mb-2">Timeline</h3>
          <div className="text-sm space-y-2">
            {timeline.length === 0 && <p className="text-gray-400">No events yet…</p>}
            {timeline.map((e, i) => (
              <div key={i} className="bg-white/5 rounded-md p-2 border border-white/10">
                <p className="text-xs text-gray-400">{new Date(e.ts).toLocaleString()}</p>
                <p>{e.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-white/10 pt-3 text-sm">
            <h4 className="font-medium mb-1">Latest ledger</h4>
            {!latestBlock && <p className="text-gray-400">No ledger entries for this rake yet.</p>}
            {latestBlock && (
              <div className="space-y-1">
                <p><span className="text-gray-400">Type:</span> {latestBlock.type}</p>
                <p><span className="text-gray-400">From → To:</span> {latestBlock.from||'—'} → {latestBlock.to||'—'}</p>
                <p><span className="text-gray-400">Cargo/Tons:</span> {latestBlock.cargo||'—'} / {latestBlock.tonnage||'—'}</p>
                <p><span className="text-gray-400">Actor:</span> {latestBlock.actor||'—'}</p>
                <p className="font-mono text-xs break-all"><span className="text-gray-400">Hash:</span> {latestBlock.hash}</p>
                <div className="text-xs"><a className="underline" href="/ledger">Open full ledger →</a></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
