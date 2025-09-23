"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function LedgerPage(){
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const token = typeof window !== 'undefined' ? (localStorage.getItem('token')||'') : '';

  useEffect(()=>{
    fetch(withBase('/ledger'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=> r.ok ? r.json() : Promise.reject(r))
      .then(d=> setItems(d.ledger || []))
      .catch(()=> setItems([]))
      .finally(()=> setLoading(false));
  },[]);

  return (
    <main className="p-6 space-y-4">
      <h2 className="text-2xl font-semibold">Blockchain-Inspired Ledger</h2>
      {loading ? <p>Loading…</p> : (
        <div className="overflow-x-auto bg-white/5 border border-white/10 rounded-xl">
          <table className="min-w-full text-sm">
            <thead className="bg-white/10">
              <tr>
                <th className="text-left p-2">#</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Rake</th>
                <th className="text-left p-2">From → To</th>
                <th className="text-left p-2">Cargo/Tons</th>
                <th className="text-left p-2">Actor</th>
                <th className="text-left p-2">Time</th>
                <th className="text-left p-2">Hash</th>
              </tr>
            </thead>
            <tbody>
              {items.map((b:any, i:number)=> (
                <tr key={b.hash} className="border-t border-white/10">
                  <td className="p-2">{i+1}</td>
                  <td className="p-2">{b.type}</td>
                  <td className="p-2">{b.rakeId}</td>
                  <td className="p-2">{b.from} → {b.to}</td>
                  <td className="p-2">{b.cargo} / {b.tonnage}</td>
                  <td className="p-2">{b.actor}</td>
                  <td className="p-2">{new Date(b.ts).toLocaleString()}</td>
                  <td className="p-2 font-mono text-xs break-all">{b.hash}</td>
                </tr>
              ))}
              {items.length===0 && (
                <tr><td className="p-3" colSpan={8}>No entries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}