"use client";
import { useEffect, useState } from "react";
import Guard from "@/components/Guard";
import { withBase } from "@/lib/config";

export default function CrewControlsPage(){
  return (
    <Guard allow={["crew","yard","manager","cmo"]}>
      <PageInner />
    </Guard>
  );
}

function PageInner(){
  const [rakeId, setRakeId] = useState("RK1001");
  const [reasons, setReasons] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [pathText, setPathText] = useState("Bokaro,23.64,86.16\nDhanbad,23.79,86.43\nAsansol,23.68,86.98\nKanpur,26.45,80.34\nDelhi,28.61,77.20");
  const [busy, setBusy] = useState(false);
  useEffect(()=>{
    const load = async ()=>{
      try{ const token = localStorage.getItem('token')||''; const r = await fetch(withBase('/crew/reasons'), { headers: { Authorization: `Bearer ${token}` }}); const j = await r.json(); setReasons(j.reasons||[]); setReason(j.reasons?.[0]||''); }catch{}
    }; load();
  },[]);
  const parsePath = () => {
    const lines = pathText.split(/\n|\r/).map(s=>s.trim()).filter(Boolean);
    const pts = lines.map(line=>{
      const [name, a, b] = line.split(',').map(s=>s.trim());
      return { name, lat: Number(a), lng: Number(b) };
    }).filter(p=> p.name && !Number.isNaN(p.lat) && !Number.isNaN(p.lng));
    return pts.length>=2 ? pts : null;
  };
  return (
    <main className="p-6 space-y-6">
      <h2 className="text-2xl font-semibold">Crew Controls</h2>
      <div className="grid md:grid-cols-2 gap-4 text-sm">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="font-medium mb-2">Start Journey (4 minutes, 5s ticks)</div>
          <label className="block mb-2">
            <div className="text-xs text-gray-400">Rake ID</div>
            <input className="w-full bg-transparent border border-white/20 rounded px-2 py-1" value={rakeId} onChange={e=>setRakeId(e.target.value)} />
          </label>
          <label className="block mb-2">
            <div className="text-xs text-gray-400">Path CSV (name,lat,lng per line)</div>
            <textarea rows={6} className="w-full bg-transparent border border-white/20 rounded px-2 py-1" value={pathText} onChange={e=>setPathText(e.target.value)} />
          </label>
          <button className="px-3 py-1 rounded border border-white/20 disabled:opacity-60" disabled={busy} onClick={async()=>{
            const pts = parsePath(); if(!pts) return alert('Invalid path');
            setBusy(true);
            try {
              const token = localStorage.getItem('token')||'';
              const r = await fetch(withBase('/crew/trip/start'), { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ rakeId, path: pts }) });
              if(!r.ok) throw new Error('Failed');
              alert('Trip started. Check Map page for live updates.');
            } catch(e:any) { alert(e?.message||'Error'); }
            finally { setBusy(false); }
          }}>Start Journey</button>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="font-medium mb-2">Delay/Stop</div>
          <div className="flex items-center gap-2 mb-2">
            <select className="bg-transparent border border-white/20 rounded px-2 py-1" value={reason} onChange={e=>setReason(e.target.value)}>
              {reasons.map(r=> <option key={r} value={r}>{r}</option>)}
            </select>
            <button className="px-3 py-1 rounded border border-white/20 disabled:opacity-60" disabled={busy} onClick={async()=>{
              try{ const token = localStorage.getItem('token')||''; const r = await fetch(withBase('/crew/trip/delay'), { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ rakeId, reason }) }); if(!r.ok) throw new Error('Failed'); alert('Delay reported.'); } catch(e:any){ alert(e?.message||'Error'); }
            }}>Report Delay</button>
            <button className="px-3 py-1 rounded border border-white/20 disabled:opacity-60" disabled={busy} onClick={async()=>{
              try{ const token = localStorage.getItem('token')||''; const r = await fetch(withBase('/crew/trip/stop'), { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ rakeId, reason }) }); if(!r.ok) throw new Error('Failed'); alert('Stop reported.'); } catch(e:any){ alert(e?.message||'Error'); }
            }}>Report Stop</button>
          </div>
          <div className="text-xs text-gray-400">These actions broadcast alerts and affect ETA for customer tracking.</div>
        </div>
      </div>
    </main>
  );
}
