"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { withBase } from "@/lib/config";

export default function AllocationDetail(){
  const params = useParams();
  const id = decodeURIComponent(String(params?.id||''));
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string>("");

  useEffect(()=>{
    const load = async ()=>{
      try{
        const token = localStorage.getItem('token')||'';
        const r = await fetch(withBase(`/api/v1/cmo/allocations/${id}`), { headers: { Authorization: `Bearer ${token}` }});
        if(!r.ok) throw new Error('Failed');
        setData(await r.json());
      }catch(e:any){ setError(e?.message||'Failed'); }
    };
    if(id) load();
  },[id]);

  if(error) return <main className="p-6">Error: {error}</main>;
  if(!data) return <main className="p-6">Loading…</main>;
  const a = data.allocation||{};
  const audit = data.audit||[];

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Allocation {a.id}</h2>
        <span className="text-xs rounded px-2 py-1 bg-white/10 border border-white/10">{a.status}</span>
      </div>
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl bg-white/5 p-4 border border-white/10">
          <h3 className="font-medium mb-2">Payload</h3>
          <pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(a.payload,null,2)}</pre>
        </div>
        <div className="rounded-xl bg-white/5 p-4 border border-white/10">
          <h3 className="font-medium mb-2">Meta</h3>
          <ul className="text-sm">
            <li><b>Created By:</b> {a.createdBy}</li>
            <li><b>Created At:</b> {a.createdAt ? new Date(a.createdAt).toLocaleString() : '-'}</li>
            {a.approvedBy && <li><b>Approved By:</b> {a.approvedBy} ({a.approvedAt ? new Date(a.approvedAt).toLocaleString() : ''})</li>}
            {a.rejectedBy && <li><b>Rejected By:</b> {a.rejectedBy} ({a.rejectedAt ? new Date(a.rejectedAt).toLocaleString() : ''})</li>}
            {a.rejectReason && <li><b>Reason:</b> {a.rejectReason}</li>}
          </ul>
        </div>
      </section>
      <section className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="font-medium mb-2">Audit Trail</h3>
        <table className="min-w-full text-sm">
          <thead><tr><Th>When</Th><Th>User</Th><Th>Action</Th><Th>Diff</Th></tr></thead>
          <tbody>
            {audit.map((r:any,idx:number)=> (
              <tr key={idx} className="border-b border-white/10">
                <Td>{new Date(r.ts).toLocaleString()}</Td>
                <Td>{r.user}</Td>
                <Td>{r.action}</Td>
                <Td className="text-xs text-gray-400">{r.diff?.reason || JSON.stringify(r.diff||{})}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
function Th({children}:any){ return <th className="text-left p-2 text-xs text-gray-400 uppercase">{children}</th>; }
function Td({children}:any){ return <td className="p-2">{children}</td>; }
