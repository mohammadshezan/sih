"use client";
import Guard from "@/components/Guard";
import { useState } from "react";
import { withBase } from "@/lib/config";

export default function ReportLowStockPage(){
  const [stockyardCity, setStockyardCity] = useState("");
  const [product, setProduct] = useState("");
  const [currentTons, setCurrentTons] = useState<string>("");
  const [thresholdTons, setThresholdTons] = useState<string>("");
  const [requiredTons, setRequiredTons] = useState<string>("");
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");

  const submit = async () => {
    setMsg(""); setErr("");
    try {
      const token = localStorage.getItem('token') || '';
      const res = await fetch(withBase('/stock/low-stock/report'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          stockyardCity, product,
          currentTons: currentTons? Number(currentTons): undefined,
          thresholdTons: thresholdTons? Number(thresholdTons): undefined,
          requiredTons: requiredTons? Number(requiredTons): undefined,
        })
      });
      if (!res.ok) {
        const t = await res.text();
        setErr(`Failed (${res.status}). ${t}`);
      } else {
        setMsg('Reported to manager successfully.');
        setStockyardCity(""); setProduct(""); setCurrentTons(""); setThresholdTons(""); setRequiredTons("");
      }
    } catch(e:any){ setErr(e?.message || 'Network error'); }
  };

  return (
    <Guard allow={["supervisor","admin"]}>
      <main className="p-6 max-w-xl">
        <h1 className="text-2xl font-semibold mb-4">Report Low Stock</h1>
        <div className="space-y-3 text-sm">
          <div>
            <label className="block text-gray-400 mb-1">Stockyard City</label>
            <input value={stockyardCity} onChange={e=>setStockyardCity(e.target.value)} className="w-full rounded border border-white/10 bg-black/40 p-2" placeholder="e.g., Durgapur" />
          </div>
          <div>
            <label className="block text-gray-400 mb-1">Product</label>
            <input value={product} onChange={e=>setProduct(e.target.value)} className="w-full rounded border border-white/10 bg-black/40 p-2" placeholder="e.g., TMT Bars" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-gray-400 mb-1">Current Tons (opt)</label>
              <input value={currentTons} onChange={e=>setCurrentTons(e.target.value)} className="w-full rounded border border-white/10 bg-black/40 p-2" />
            </div>
            <div>
              <label className="block text-gray-400 mb-1">Threshold (opt)</label>
              <input value={thresholdTons} onChange={e=>setThresholdTons(e.target.value)} className="w-full rounded border border-white/10 bg-black/40 p-2" />
            </div>
            <div>
              <label className="block text-gray-400 mb-1">Required (opt)</label>
              <input value={requiredTons} onChange={e=>setRequiredTons(e.target.value)} className="w-full rounded border border-white/10 bg-black/40 p-2" />
            </div>
          </div>
          <button onClick={submit} className="rounded bg-brand-green text-black px-4 py-2">Send to Manager</button>
          {msg && <div className="text-green-400">{msg}</div>}
          {err && <div className="text-red-400">{err}</div>}
        </div>
      </main>
    </Guard>
  );
}
