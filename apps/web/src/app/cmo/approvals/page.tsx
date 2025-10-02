"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function CMOApprovals(){
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [actionNote, setActionNote] = useState<string>("");

  const token = typeof window !== 'undefined' ? (localStorage.getItem('token')||'') : '';

  const load = async ()=>{
    setLoading(true);
    try{
      const r = await fetch(withBase('/api/v1/cmo/allocations'), { headers: { Authorization: `Bearer ${token}` }});
      const j = await r.json();
      setItems((j.allocations||[]).filter((a:any)=> a.status === 'submitted'));
    }catch(e:any){ setMsg(e?.message||'Failed to load'); }
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  const act = async (id:string, type:'approve'|'reject')=>{
    const url = type==='approve' ? `/api/v1/cmo/allocations/${id}/approve` : `/api/v1/cmo/allocations/${id}/reject`;
    const body = type==='reject' ? JSON.stringify({ reason: actionNote }) : undefined;
    const r = await fetch(withBase(url), { method:'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body });
    if(r.ok){ setMsg(type==='approve'?'Approved':'Rejected'); setActionNote(''); load(); } else { setMsg('Action failed'); }
  };

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">CMO Approvals</h2>
        <button onClick={load} className="px-3 py-1 rounded bg-white/10 border border-white/10 text-sm">Refresh</button>
      </div>
      {msg && <div className="text-xs text-gray-400">{msg}</div>}
      {loading? <div>Loading…</div> : (
        <table className="min-w-full text-sm">
          <thead><tr><Th>ID</Th><Th>Stockyard</Th><Th>Orders</Th><Th>Created</Th><Th>Actions</Th></tr></thead>
          <tbody>
            {items.map((r)=> (
              <tr key={r.id} className="border-b border-white/10">
                <Td>{r.id}</Td>
                <Td>{r.payload?.stockyard_id}</Td>
                <Td>{(r.payload?.order_ids||[]).join(', ')}</Td>
                <Td>{new Date(r.createdAt).toLocaleString()}</Td>
                <Td>
                  <div className="flex gap-2 items-center">
                    <button onClick={()=> act(r.id,'approve')} className="px-2 py-1 rounded bg-emerald-600 text-white">Approve</button>
                    <input value={actionNote} onChange={e=> setActionNote(e.target.value)} placeholder="Reject reason" className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs"/>
                    <button onClick={()=> act(r.id,'reject')} className="px-2 py-1 rounded bg-rose-600 text-white">Reject</button>
                  </div>
                </Td>
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
