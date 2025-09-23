"use client";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function CompatibilityPage(){
  const [data, setData] = useState<any>(null);
  const token = typeof window !== 'undefined' ? (localStorage.getItem('token')||'') : '';
  useEffect(()=>{
    fetch(withBase('/optimizer/constraints'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=> r.ok ? r.json() : Promise.reject(r))
      .then(setData)
      .catch(()=> setData(null));
  },[]);
  const matrix = data?.wagonCompatibility || {};
  const products = Array.from(new Set(Object.values(matrix).flatMap((t:any)=> t.compatible || [])));
  const types = Object.keys(matrix);
  return (
    <main className="p-6 space-y-4">
      <h2 className="text-2xl font-semibold">Product × Wagon Compatibility</h2>
      {!data ? <p>Loading…</p> : (
        <div className="overflow-x-auto bg-white/5 border border-white/10 rounded-xl">
          <table className="min-w-full text-sm">
            <thead className="bg-white/10">
              <tr>
                <th className="text-left p-2">Wagon Type</th>
                {products.map((p:string)=> <th key={p} className="text-left p-2">{p}</th>)}
              </tr>
            </thead>
            <tbody>
              {types.map((t:string)=> (
                <tr key={t} className="border-t border-white/10">
                  <td className="p-2 font-medium">{t}</td>
                  {products.map((p:string)=> {
                    const ok = (matrix[t]?.compatible || []).includes(p);
                    return <td key={p} className="p-2">{ok ? '✅' : '—'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}