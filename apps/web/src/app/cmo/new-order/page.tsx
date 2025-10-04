"use client";
import { useState } from "react";
import Guard from "@/components/Guard";
import { withBase } from "@/lib/config";

export default function CmoNewOrderPage() {
  return (
    <Guard allow={["cmo"]}>
      <PageInner />
    </Guard>
  );
}

function PageInner() {
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [product, setProduct] = useState("TMT Bars");
  const [quantity, setQuantity] = useState<number>(100);
  const [destination, setDestination] = useState("Delhi");
  const [priority, setPriority] = useState<"Normal"|"Urgent">("Normal");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>("");
  return (
    <main className="p-6 space-y-6">
      <h2 className="text-2xl font-semibold">CMO — New Order</h2>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 rounded-xl border border-white/10 p-4 bg-white/5">
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <label className="space-y-1">
              <div className="text-gray-400 text-xs">Company</div>
              <input className="w-full bg-transparent border border-white/20 rounded px-2 py-1" value={company} onChange={e=>setCompany(e.target.value)} placeholder="Acme Infra Pvt Ltd" />
            </label>
            <label className="space-y-1">
              <div className="text-gray-400 text-xs">Email (optional)</div>
              <input className="w-full bg-transparent border border-white/20 rounded px-2 py-1" value={email} onChange={e=>setEmail(e.target.value)} placeholder="contact@acme.com" />
            </label>
            <label className="space-y-1">
              <div className="text-gray-400 text-xs">Product</div>
              <select className="w-full bg-transparent border border-white/20 rounded px-2 py-1" value={product} onChange={e=>setProduct(e.target.value)}>
                <option value="TMT Bars">TMT Bars</option>
                <option value="Structural Steel">Structural Steel</option>
                <option value="Plates">Plates</option>
                <option value="Rails">Rails</option>
              </select>
            </label>
            <label className="space-y-1">
              <div className="text-gray-400 text-xs">Quantity (tons)</div>
              <input type="number" className="w-full bg-transparent border border-white/20 rounded px-2 py-1" value={quantity} onChange={e=>setQuantity(Number(e.target.value||0))} />
            </label>
            <label className="space-y-1">
              <div className="text-gray-400 text-xs">Destination City</div>
              <input className="w-full bg-transparent border border-white/20 rounded px-2 py-1" value={destination} onChange={e=>setDestination(e.target.value)} placeholder="Delhi" />
            </label>
            <label className="space-y-1">
              <div className="text-gray-400 text-xs">Priority</div>
              <select className="w-full bg-transparent border border-white/20 rounded px-2 py-1" value={priority} onChange={e=>setPriority(e.target.value as any)}>
                <option>Normal</option>
                <option>Urgent</option>
              </select>
            </label>
          </div>
          <div className="mt-4">
            <button
              className="px-3 py-1 rounded border border-white/20 text-sm disabled:opacity-60"
              disabled={loading || !company || !product || !destination || quantity<=0}
              onClick={async()=>{
                setError(""); setResult(null); setLoading(true);
                try {
                  const token = localStorage.getItem('token')||'';
                  const r = await fetch(withBase('/cmo/order/new'), { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ company, email: email || undefined, product, quantity, destination, priority })});
                  if(!r.ok) throw new Error(`Failed (${r.status})`);
                  const j = await r.json();
                  setResult(j);
                } catch(e:any) {
                  setError(e?.message||'Failed');
                } finally { setLoading(false); }
              }}
            >{loading ? 'Creating…' : 'Create & Plan'}</button>
          </div>
          {error && <div className="mt-3 text-red-400 text-sm">{error}</div>}
        </div>
        <div className="rounded-xl border border-white/10 p-4 bg-white/5 text-sm">
          <div className="text-gray-400 text-xs">Output</div>
          {!result && <div className="text-gray-400">Result will appear here after creation.</div>}
          {result && (
            <div className="space-y-2">
              {result.credentials && (
                <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2">
                  <div className="font-medium">Customer Credentials (auto-generated)</div>
                  <div className="text-xs">Customer ID: {result.credentials.customerId}</div>
                  <div className="text-xs">Email: {result.credentials.email}</div>
                  <div className="text-xs">Password: {result.credentials.password}</div>
                </div>
              )}
              <div>
                <div className="text-gray-400 text-xs">Order</div>
                <pre className="text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(result.order, null, 2)}</pre>
              </div>
              <div>
                <div className="text-gray-400 text-xs">AI Plan</div>
                <pre className="text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(result.plan, null, 2)}</pre>
              </div>
              <div className="flex items-center gap-2">
                <a className="text-xs underline" href="#" onClick={async (e)=>{ e.preventDefault(); try { const token = localStorage.getItem('token')||''; const r = await fetch(withBase('/cmo/plan/export.pdf'), { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: result.plan }) }); const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'plan.pdf'; a.click(); URL.revokeObjectURL(url); } catch {} }}>Download PDF</a>
                <a className="text-xs underline" href="#" onClick={async (e)=>{ e.preventDefault(); try { const token = localStorage.getItem('token')||''; const r = await fetch(withBase('/cmo/plan/export.csv'), { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: result.plan }) }); const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'plan.csv'; a.click(); URL.revokeObjectURL(url); } catch {} }}>Download CSV</a>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
