"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function CMOAllocation(){
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const load = async ()=>{
    setLoading(true);
    const token = localStorage.getItem('token')||'';
    const r = await fetch(withBase('/api/v1/cmo/allocations'), { headers: { Authorization: `Bearer ${token}` }});
    if(r.ok) { const j = await r.json(); setList(j.allocations||[]); } else { setMsg('Failed to load'); }
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);
  const createDraft = async ()=>{
    const token = localStorage.getItem('token')||'';
    const r = await fetch(withBase('/api/v1/cmo/allocations/draft'), { method:'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ order_ids:['ORD001'], stockyard_id:'DGR-Y1', notes:'Demo draft' }) });
    if(r.ok) { setMsg('Draft created'); load(); } else setMsg('Failed to create');
  };
  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">CMO Allocation Manager</h2>
        <button onClick={createDraft} className="px-3 py-1 rounded bg-indigo-600 text-white text-sm">New Draft</button>
      </div>
      {msg && <div className="text-xs text-gray-400">{msg}</div>}
      {loading? <div>Loading…</div> : (
        <table className="min-w-full text-sm">
          <thead><tr><Th>ID</Th><Th>Status</Th><Th>Created By</Th><Th>When</Th></tr></thead>
          <tbody>
            {list.map((r)=> (
              <tr key={r.id} className="border-b border-white/10">
                <Td>{r.id}</Td>
                <Td>{r.status}</Td>
                <Td>{r.createdBy}</Td>
                <Td>{new Date(r.createdAt).toLocaleString()}</Td>
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
