"use client";
import Guard from "@/components/Guard";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

type Order = {
  orderId: string;
  customerId: string;
  cargo: string;
  quantityTons: number;
  sourcePlant: string;
  destination: string;
  priority: string;
  status: string;
  createdAt: string;
};

export default function ApprovalsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(withBase('/manager/orders/pending'), {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')||''}` }
      });
      if (!r.ok) throw new Error('Failed to load');
      const data = await r.json();
      setOrders(data.orders || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function act(id: string, action: 'approve'|'reject') {
    try {
      const r = await fetch(withBase(`/manager/orders/${id}/${action}`), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')||''}`, 'Content-Type': 'application/json' }
      });
      if (!r.ok) throw new Error('Action failed');
      await load();
    } catch (e) { console.error(e); }
  }

  return (
    <Guard allow={["manager"] as any}>
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-xl font-semibold mb-4">Manager Approvals</h1>
        {loading && <div>Loading…</div>}
        {!loading && orders.length === 0 && (
          <div className="text-sm text-gray-400">No pending orders.</div>
        )}
        <div className="overflow-x-auto rounded-md border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5">
              <tr>
                <th className="px-3 py-2 text-left">Order</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Cargo</th>
                <th className="px-3 py-2 text-left">Qty (T)</th>
                <th className="px-3 py-2 text-left">Source → Destination</th>
                <th className="px-3 py-2 text-left">Priority</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.orderId} className="border-t border-white/5">
                  <td className="px-3 py-2 font-mono">{o.orderId.slice(0,8)}</td>
                  <td className="px-3 py-2">{o.customerId}</td>
                  <td className="px-3 py-2">{o.cargo}</td>
                  <td className="px-3 py-2">{o.quantityTons}</td>
                  <td className="px-3 py-2">{o.sourcePlant} → {o.destination}</td>
                  <td className="px-3 py-2">{o.priority}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button onClick={()=>act(o.orderId,'approve')} className="px-2 py-1 rounded bg-green-500/20 border border-green-500/40">Approve</button>
                      <button onClick={()=>act(o.orderId,'reject')} className="px-2 py-1 rounded bg-red-500/20 border border-red-500/40">Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Guard>
  );
}
