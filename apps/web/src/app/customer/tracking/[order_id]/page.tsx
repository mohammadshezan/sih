"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";
import { useParams } from "next/navigation";

export default function CustomerTracking(){
  const params = useParams() as { order_id?: string };
  const orderId = params?.order_id || '';
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
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
