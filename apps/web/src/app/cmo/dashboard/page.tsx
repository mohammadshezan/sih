"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function CMODashboard(){
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string>("");
  useEffect(()=>{
    const load = async ()=>{
      try{
        const token = localStorage.getItem('token')||'';
        const r = await fetch(withBase('/api/v1/cmo/summary'), { headers: { Authorization: `Bearer ${token}` }});
        if(!r.ok) throw new Error('Failed');
        setData(await r.json());
      }catch(e:any){ setError(e?.message||'error'); }
    };
    load();
  },[]);
  if(error) return <main className="p-6">Error: {error}</main>;
  if(!data) return <main className="p-6">Loading…</main>;
  const k = data.kpis||{};
  return (
    <main className="p-6 space-y-4">
      <h2 className="text-2xl font-semibold">CMO Dashboard</h2>
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
