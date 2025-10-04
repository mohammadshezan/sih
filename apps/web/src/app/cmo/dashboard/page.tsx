"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function CMODashboard(){
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string>("");
  const [yards, setYards] = useState<string[]>(["Chennai","Mumbai","Delhi","Visakhapatnam","Indore","Kanpur","Rourkela","Patna","Durgapur","Bhilai"]);
  const [selected, setSelected] = useState<string[]>(["Durgapur","Rourkela","Bhilai"]);
  useEffect(()=>{
    const load = async ()=>{
      try{
        const token = localStorage.getItem('token')||'';
        const qs = selected.map(s=> `yard=${encodeURIComponent(s)}`).join('&');
        const r = await fetch(withBase(`/api/v1/cmo/summary?${qs}`), { headers: { Authorization: `Bearer ${token}` }});
        if(!r.ok) throw new Error('Failed');
        setData(await r.json());
      }catch(e:any){ setError(e?.message||'error'); }
    };
    load();
  },[selected]);
  if(error) return <main className="p-6">Error: {error}</main>;
  if(!data) return <main className="p-6">Loading…</main>;
  const k = data.kpis||{};
  return (
    <main className="p-6 space-y-4">
      <h2 className="text-2xl font-semibold">CMO Dashboard</h2>
      <div>
        <a
          className="text-xs underline"
          href="#"
          onClick={async (e)=>{
            e.preventDefault();
            try {
              const token = localStorage.getItem('token')||'';
              const r = await fetch(withBase('/cmo/orders.csv'), { headers: { Authorization: `Bearer ${token}` }});
              if(!r.ok) throw new Error('Failed');
              const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'cmo-orders.csv'; a.click(); URL.revokeObjectURL(url);
            } catch {}
          }}
        >Download CMO Orders CSV</a>
      </div>
      <div className="rounded-xl bg-white/5 p-4 border border-white/10">
        <div className="text-sm text-gray-400 mb-2">Filter Stockyards</div>
        <div className="flex flex-wrap gap-2">
          {yards.map(y=>{
            const active = selected.includes(y);
            return (
              <button key={y} onClick={()=> setSelected(s=> active ? s.filter(i=> i!==y) : [...s,y])} className={`px-2 py-1 rounded border ${active? 'bg-brand-green text-black border-brand-green':'border-white/20'}`}>{y}</button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card title="Backlog" value={k.backlog}/>
        <Card title="Stockyard Util" value={`${Math.round((k.stockyardUtil||0)*100)}%`}/>
        <Card title="SLA Risk" value={`${Math.round((k.slaRisk||0)*100)}%`}/>
        <Card title="Eco Score" value={`${Math.round((k.ecoScore||0)*100)}%`}/>
      </div>
      <div className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="font-medium mb-2">Alerts</h3>
        <ul className="text-sm list-disc ml-5">
          {(data.alerts||[]).map((a:any,i:number)=> <li key={i}>{a.message||a.text}</li>)}
        </ul>
      </div>
    </main>
  );
}
function Card({title,value}:{title:string;value:any}){
  return (
    <div className="rounded-xl bg-white/5 p-4 border border-white/10">
      <div className="text-xs text-gray-400">{title}</div>
      <div className="text-2xl font-bold">{String(value)}</div>
    </div>
  );
}
