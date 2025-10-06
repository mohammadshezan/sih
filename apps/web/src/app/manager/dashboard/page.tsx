"use client";
import { useEffect, useMemo, useState } from "react";
import Guard from "@/components/Guard";
import { withBase } from "@/lib/config";
import io from 'socket.io-client';

type Production = { product: string; rateTph: number; shiftTotalTons: number; todayTons: number };
type RawInv = { name: string; stockTons: number; capacityTons: number; thresholdTons: number; low: boolean };
type FinishedInv = { product: string; readyTons: number; capacityTons: number; thresholdTons: number; low: boolean };
type Rake = { code: string; destination: string; product: string; tons: number | null; departedAt: string };
type Order = { id: string; customer: string; product: string; quantityTons: number; destination: string; priority: string; status: string };

export default function ManagerDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plant, setPlant] = useState<string>('');
  const [production, setProduction] = useState<Production[]>([]);
  const [raw, setRaw] = useState<RawInv[]>([]);
  const [finished, setFinished] = useState<FinishedInv[]>([]);
  const [outgoing, setOutgoing] = useState<Rake[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [notif, setNotif] = useState<string>("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const token = typeof window !== 'undefined' ? (localStorage.getItem('token') || localStorage.getItem('authToken') || '') : '';
        const res = await fetch(withBase('/plant/manager/overview'), {
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
        });
        if (!mounted) return;
        if (!res.ok) {
          const t = await res.text();
          setError(`Failed to load manager overview (${res.status}). ${t||''}`);
        } else {
          const data = await res.json();
          setPlant(data.plant || 'Bokaro Steel Plant');
          setProduction(Array.isArray(data.production) ? data.production : []);
          setRaw(Array.isArray(data.rawInventory) ? data.rawInventory : []);
          setFinished(Array.isArray(data.finishedInventory) ? data.finishedInventory : []);
          setOutgoing(Array.isArray(data.outgoingRakes) ? data.outgoingRakes : []);
          setOrders(Array.isArray(data.pendingOrders) ? data.pendingOrders : []);
        }
      } catch (e: any) {
        if (!mounted) return; setError(e?.message || 'Network error');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // WebSocket notifications for low stock / rake plan
  useEffect(() => {
    const socket = io(withBase('/'));
    const handler = (a: any) => {
      if (!a) return;
      if (a.type === 'low_stock') setNotif(`Low stock: ${a?.meta?.product || ''} @ ${a?.meta?.stockyardCity || ''}`);
      if (a.type === 'rake_plan') setNotif(`Rake plan ready for ${a?.meta?.plan?.destination || ''}`);
      if (a.type === 'manager_order') setNotif(a.message || 'Manager order issued');
      // auto-clear
      setTimeout(()=> setNotif(""), 5000);
    };
    socket.on('alert', handler);
    return () => { socket.off('alert', handler); socket.close(); };
  }, []);

  const totalReady = useMemo(() => finished.reduce((s,f)=> s + (f.readyTons||0), 0), [finished]);

  return (
    <Guard allow={["manager","admin"]}>
      <main className="p-6 space-y-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Manager Dashboard — {plant}</h1>
          <span className="text-sm opacity-70">Updated {new Date().toLocaleTimeString()}</span>
        </div>

        {loading ? <p className="opacity-80">Loading…</p> : error ? <div className="text-red-400">{error}</div> : (
          <>
            {notif && (
              <div className="rounded-md border border-green-500/40 bg-green-500/10 text-green-300 px-3 py-2 text-sm">{notif}</div>
            )}
            {/* Production KPI cards */}
            <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              {production.map(p => (
                <div key={p.product} className="rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-4">
                  <div className="text-sm opacity-80">{p.product}</div>
                  <div className="mt-1 text-2xl font-semibold">{p.rateTph} tph</div>
                  <div className="mt-2 text-xs opacity-80">Shift total: {p.shiftTotalTons.toLocaleString()} t</div>
                  <div className="text-xs opacity-80">Today: {p.todayTons.toLocaleString()} t</div>
                </div>
              ))}
            </section>

            {/* Inventory: Raw Materials */}
            <section>
              <h2 className="text-lg font-medium mb-2">Raw Materials Inventory</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {raw.map(r => {
                  const pct = Math.max(0, Math.min(100, (r.stockTons / r.capacityTons) * 100));
                  const left = Math.max(0, r.capacityTons - r.stockTons);
                  return (
                    <div key={r.name} className="rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-4">
                      <div className="flex items-baseline justify-between">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-sm font-semibold">{r.stockTons.toLocaleString()} t</div>
                      </div>
                      <div className="mt-2 h-1.5 w-full bg-white/10 rounded">
                        <div className={`h-1.5 rounded ${r.low ? 'bg-red-400' : 'bg-brand-green'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-[11px] opacity-75">{left.toLocaleString()} t left out of {r.capacityTons.toLocaleString()} t {r.low && <span className="ml-2 text-red-400">(below {r.thresholdTons}t)</span>}</div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Inventory: Finished Products (Ready for dispatch) */}
            <section>
              <h2 className="text-lg font-medium mb-2">Finished Products Ready for Dispatch</h2>
              <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-4">
                <div className="mb-3 text-sm opacity-80">Total ready: <span className="font-semibold">{totalReady.toLocaleString()} t</span></div>
                <div className="overflow-x-auto">
                  <table className="min-w-[560px] text-sm border border-white/10 rounded">
                    <thead className="bg-white/5">
                      <tr>
                        <th className="text-left px-3 py-2">Product</th>
                        <th className="text-right px-3 py-2">Ready (t)</th>
                        <th className="text-right px-3 py-2">Capacity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finished.map(f => {
                        const pct = Math.max(0, Math.min(100, (f.readyTons / f.capacityTons) * 100));
                        const left = Math.max(0, f.capacityTons - f.readyTons);
                        return (
                          <tr key={f.product} className="border-t border-white/10 align-top">
                            <td className="px-3 py-2">
                              <div className="font-medium">{f.product}</div>
                              <div className="mt-1 h-1.5 w-full bg-white/10 rounded">
                                <div className={`h-1.5 rounded ${f.low ? 'bg-red-400' : 'bg-brand-green'}`} style={{ width: `${pct}%` }} />
                              </div>
                              <div className="mt-1 text-[11px] opacity-75">{left.toLocaleString()} t left out of {f.capacityTons.toLocaleString()} t {f.low && <span className="ml-2 text-red-400">(below {f.thresholdTons}t)</span>}</div>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold">{f.readyTons.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">{f.capacityTons.toLocaleString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* Outgoing rakes and pending orders */}
            <section className="grid md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-4">
                <h3 className="font-medium mb-2">Recent Outgoing Rakes</h3>
                {outgoing.length ? (
                  <ul className="text-sm space-y-1">
                    {outgoing.map(r => (
                      <li key={r.code} className="flex justify-between">
                        <span>{r.code} → {r.destination}</span>
                        <span className="opacity-75">{r.product} {(r.tons||0).toLocaleString()}t</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="opacity-80 text-sm">No recent dispatches.</p>}
              </div>
              <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-4">
                <h3 className="font-medium mb-2">Pending/Approved Customer Orders</h3>
                {orders.length ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-[480px] text-sm">
                      <thead className="bg-white/5">
                        <tr>
                          <th className="text-left px-3 py-2">Order</th>
                          <th className="text-left px-3 py-2">Customer</th>
                          <th className="text-left px-3 py-2">Product</th>
                          <th className="text-right px-3 py-2">Qty</th>
                          <th className="text-left px-3 py-2">Dest</th>
                          <th className="text-left px-3 py-2">Priority</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map(o => (
                          <tr key={o.id} className="border-t border-white/10">
                            <td className="px-3 py-2">{o.id}</td>
                            <td className="px-3 py-2">{o.customer}</td>
                            <td className="px-3 py-2">{o.product}</td>
                            <td className="px-3 py-2 text-right">{o.quantityTons.toLocaleString()} t</td>
                            <td className="px-3 py-2">{o.destination}</td>
                            <td className="px-3 py-2">{o.priority}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="opacity-80 text-sm">No pending orders.</p>}
              </div>
            </section>
          </>
        )}
      </main>
    </Guard>
  );
}
