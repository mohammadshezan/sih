"use client";
import Guard from "@/components/Guard";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function OrderDetail({ params }: any) {
  const orderId = params.id;
  return (
    <Guard allow={['customer'] as any}>
      <OrderView orderId={orderId} />
    </Guard>
  );
}

function OrderView({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<any>(null);
  const [etaCalc, setEtaCalc] = useState<null | { eta: string; confidence: number; transitHours: number }>(null);
  const [etaLoading, setEtaLoading] = useState(false);
  useEffect(() => {
    const token = localStorage.getItem('token')||'';
    fetch(withBase(`/customer/orders/${orderId}`), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then(d=>setOrder(d.order)).catch(()=>{});
  }, [orderId]);
  const onRecalcEta = async () => {
    if (!order?.destination) return;
    try {
      setEtaLoading(true);
      const token = localStorage.getItem('token')||'';
      const resp = await fetch(withBase('/ai/eta'), {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourcePlant: order.sourcePlant, destination: order.destination })
      });
      if (!resp.ok) throw new Error('Failed');
      const j = await resp.json();
      setEtaCalc({ eta: j.eta, confidence: j.confidence, transitHours: j.transitHours });
    } catch {
      setEtaCalc(null);
    } finally {
      setEtaLoading(false);
    }
  };
  if (!order) return <div className="max-w-3xl mx-auto p-6">Loading…</div>;
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-lg font-medium">Order #{order.orderId.slice(0,8)}</div>
          <div className="text-sm text-gray-400">Status: {order.status}{order.rakeId?` · Rake ${order.rakeId}`:''}</div>
        </div>
        <div className="flex items-center gap-2">
          <a className="rounded border border-white/20 px-3 py-2" href={`/customer/orders/${order.orderId}/invoice.pdf`} target="_blank">Download Invoice</a>
          <a className="rounded border border-white/20 px-3 py-2" href="/map">Track on Map</a>
        </div>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-white/10 rounded p-3">
          <div className="font-medium mb-2">Details</div>
          <div className="text-sm">Cargo: {order.cargo}</div>
          <div className="text-sm">Quantity: {order.quantityTons}T</div>
          <div className="text-sm">Source: {order.sourcePlant}</div>
          <div className="text-sm">Destination: {order.destination}</div>
          <div className="text-sm">Priority: {order.priority}</div>
          <div className="text-sm">Notes: {order.notes||'-'}</div>
        </div>
        <div className="border border-white/10 rounded p-3">
          <div className="font-medium mb-2">Estimate</div>
          <div className="text-sm">Cost: ₹{order.estimate?.cost?.toLocaleString?.()}</div>
          <div className="text-sm">ETA: {new Date(order.estimate?.eta).toLocaleString()}</div>
          <div className="text-sm">Carbon: {order.estimate?.carbonTons} tCO₂</div>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={onRecalcEta} className="px-3 py-1 rounded border border-white/20 text-xs disabled:opacity-60" disabled={etaLoading}>
              {etaLoading ? 'Calculating…' : 'Recalculate ETA'}
            </button>
            {etaCalc && (
              <div className="text-xs text-gray-300">
                ETA: {new Date(etaCalc.eta).toLocaleString()} · {etaCalc.transitHours}h · conf {(etaCalc.confidence*100).toFixed(0)}%
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="border border-white/10 rounded p-3">
        <div className="font-medium mb-2">History</div>
        <ol className="text-sm list-disc pl-6">
          {(order.history||[]).map((h:any, idx:number)=> (
            <li key={idx}>{new Date(h.ts).toLocaleString()} — {h.status}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
