"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function CMOAudit(){
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [allocId, setAllocId] = useState<string>("");
  const [action, setAction] = useState<string>("");

  const token = typeof window !== 'undefined' ? (localStorage.getItem('token')||'') : '';

  const load = async ()=>{
    setLoading(true);
    try{
      const qs = new URLSearchParams();
      if(from) qs.set('from', from);
      if(to) qs.set('to', to);
      if(allocId) qs.set('allocId', allocId);
      if(action) qs.set('action', action);
      const r = await fetch(withBase(`/api/v1/cmo/audit?${qs.toString()}`), { headers: { Authorization: `Bearer ${token}` }});
      const j = await r.json();
      setItems(j.audit||[]);
    }catch(e:any){ setMsg(e?.message||'Failed to load'); }
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  const exportCsv = ()=>{
    const qs = new URLSearchParams();
    if(from) qs.set('from', from);
    if(to) qs.set('to', to);
    if(allocId) qs.set('allocId', allocId);
    if(action) qs.set('action', action);
    window.open(withBase(`/api/v1/cmo/audit.csv?${qs.toString()}`), '_blank');
  };

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">CMO Audit</h2>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="px-3 py-1 rounded bg-white/10 border border-white/10 text-sm">Export CSV</button>
          <button onClick={load} className="px-3 py-1 rounded bg-white/10 border border-white/10 text-sm">Refresh</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <input value={from} onChange={e=> setFrom(e.target.value)} placeholder="From ISO" className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs"/>
        <input value={to} onChange={e=> setTo(e.target.value)} placeholder="To ISO" className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs"/>
        <input value={allocId} onChange={e=> setAllocId(e.target.value)} placeholder="Allocation ID" className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs"/>
        <select value={action} onChange={e=> setAction(e.target.value)} className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs">
          <option value="">Any Action</option>
          <option value="create_draft">create_draft</option>
          <option value="submit">submit</option>
          <option value="approve">approve</option>
          <option value="reject">reject</option>
        </select>
        <button onClick={load} className="px-3 py-1 rounded bg-indigo-600 text-white text-sm">Apply</button>
      </div>
      {msg && <div className="text-xs text-gray-400">{msg}</div>}
      {loading? <div>Loading…</div> : (
        <table className="min-w-full text-sm">
          <thead><tr><Th>When</Th><Th>Alloc</Th><Th>User</Th><Th>Action</Th><Th>Details</Th></tr></thead>
          <tbody>
            {items.map((r,index)=> (
              <tr key={index} className="border-b border-white/10">
                <Td>{new Date(r.ts).toLocaleString()}</Td>
                <Td>{r.allocId}</Td>
                <Td>{r.user}</Td>
                <Td>{r.action}</Td>
                <Td className="text-xs text-gray-400">{r.diff?.reason || JSON.stringify(r.diff||{})}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
function Th({children}:any){ return <th className="text-left p-2 text-xs text-gray-400 uppercase">{children}</th>; }
function Td({children}:any){ return <td className="p-2">{children}</td>; }
