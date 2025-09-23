"use client";
import Guard from "@/components/Guard";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function OrdersList() {
  const [orders, setOrders] = useState<any[]>([]);
  useEffect(() => {
    const token = localStorage.getItem('token')||'';
    fetch(withBase('/customer/orders'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then(d=>setOrders(d.orders||[])).catch(()=>{});
  }, []);
  return (
    <Guard allow={['customer'] as any}>
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4">My Orders</h1>
        <div className="grid gap-3">
          {orders.map(o => (
            <a key={o.orderId} href={`/customer/orders/${o.orderId}`} className="block border border-white/10 rounded p-3 hover:bg-white/5">
              <div className="flex items-center justify-between">
                <div>#{o.orderId.slice(0,8)} · {o.cargo} · {o.quantityTons}T</div>
                <div className="text-sm text-gray-400">{o.status}</div>
              </div>
              <div className="text-xs text-gray-400">{o.sourcePlant} → {o.destination} · ETA {new Date(o.estimate?.eta).toLocaleString()}</div>
            </a>
          ))}
          {orders.length === 0 && <div className="text-gray-400 text-sm">No orders found.</div>}
        </div>
      </div>
    </Guard>
  );
}
