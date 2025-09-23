"use client";
import Guard from "@/components/Guard";
import { useToast } from "@/components/Toast";
import { useState } from "react";
import { withBase } from "@/lib/config";

const cargoes = ['TMT Bars','H-Beams','Coils','Ore','Cement'];
const plants = ['BKSC','DGR','ROU','BPHB'];

export default function NewOrder() {
  const Toast = useToast();
  const [form, setForm] = useState({ cargo: cargoes[0], quantityTons: 100, sourcePlant: plants[0], destination: '', priority: 'Normal', notes: '' });
  const [estimate, setEstimate] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const getEstimate = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token')||'';
      const r = await fetch(withBase('/customer/orders'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...form, estimateOnly: true }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error||'Failed');
      setEstimate(j.estimate);
    } catch (e: any) { Toast.push({ text: e.message||'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };

  const placeOrder = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token')||'';
      const r = await fetch(withBase('/customer/orders'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(form) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error||'Failed');
      Toast.push({ text: 'Order created', tone: 'success' });
      location.href = `/customer/orders/${j.order.orderId}`;
    } catch (e: any) { Toast.push({ text: e.message||'Failed', tone: 'error' }); }
    finally { setLoading(false); }
  };

  return (
    <Guard allow={['customer'] as any}>
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Place New Order</h1>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <label className="text-sm">Cargo</label>
            <select className="bg-black/30 border border-white/10 rounded px-3 py-2" value={form.cargo} onChange={e=>setForm({...form, cargo: e.target.value})}>
              {cargoes.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <label className="text-sm">Quantity (tons)</label>
            <input type="number" className="bg-black/30 border border-white/10 rounded px-3 py-2" value={form.quantityTons} onChange={e=>setForm({...form, quantityTons: Number(e.target.value)})} />
          </div>
          <div className="grid gap-1">
            <label className="text-sm">Source Plant</label>
            <select className="bg-black/30 border border-white/10 rounded px-3 py-2" value={form.sourcePlant} onChange={e=>setForm({...form, sourcePlant: e.target.value})}>
              {plants.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <label className="text-sm">Destination (city/state or pincode)</label>
            <input className="bg-black/30 border border-white/10 rounded px-3 py-2" value={form.destination} onChange={e=>setForm({...form, destination: e.target.value})} />
          </div>
          <div className="grid gap-1">
            <label className="text-sm">Priority</label>
            <select className="bg-black/30 border border-white/10 rounded px-3 py-2" value={form.priority} onChange={e=>setForm({...form, priority: e.target.value})}>
              <option>Normal</option>
              <option>Urgent</option>
            </select>
          </div>
          <div className="grid gap-1">
            <label className="text-sm">Special notes</label>
            <textarea className="bg-black/30 border border-white/10 rounded px-3 py-2" value={form.notes} onChange={e=>setForm({...form, notes: e.target.value})} />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={loading} onClick={getEstimate} className="rounded border border-white/20 px-3 py-2">Estimate</button>
            <button type="button" disabled={loading} onClick={placeOrder} className="rounded bg-brand-green text-black px-3 py-2">Confirm Order</button>
          </div>
          {estimate && (
            <div className="border border-white/10 rounded p-3 text-sm">
              <div>Estimated Cost: ₹{estimate.cost.toLocaleString()}</div>
              <div>ETA: {new Date(estimate.eta).toLocaleString()}</div>
              <div>Carbon Footprint: {estimate.carbonTons} tCO₂</div>
              <div className="text-xs text-gray-400">Eco Hint: {estimate.ecoHint}</div>
            </div>
          )}
        </div>
      </div>
    </Guard>
  );
}
