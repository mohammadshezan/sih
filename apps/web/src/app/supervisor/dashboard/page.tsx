"use client";
import { useEffect, useState } from "react";
import Guard from "@/components/Guard";
import { withBase } from "@/lib/config";

type Yard = { slug: string; name: string; products: Record<string, number> };

export default function SupervisorDashboard() {
  const [yards, setYards] = useState<Yard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
  const token = typeof window !== 'undefined' ? (localStorage.getItem('token') || localStorage.getItem('authToken') || '') : '';
        const res = await fetch(withBase('/stock/yard'), {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!mounted) return;
        if (!res.ok) {
          const txt = await res.text();
          setError(`Failed to load inventory (${res.status}). ${txt || ''}`);
          setYards([]);
        } else {
          const data = await res.json();
          const list: Yard[] = Array.isArray(data?.yards) ? data.yards : [];
          setYards(list);
        }
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Network error');
        setYards([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  // Collect product headers dynamically from first yard
  const productKeys = yards.length ? Object.keys(yards[0].products || {}) : [];

  return (
    <Guard allow={["supervisor","admin"]}>
      <main className="p-6 space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Supervisor Dashboard</h1>
          <p className="opacity-80 text-sm">Stockyard Inventory Overview</p>
        </div>

        {loading ? (
          <p className="opacity-80">Loading inventory…</p>
        ) : error ? (
          <div className="text-red-400">{error}</div>
        ) : (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {yards.map((y) => {
              const THRESHOLDS: Record<string, number> = {
                'TMT Bars': Number(process.env.NEXT_PUBLIC_THRESHOLD_TMT || 300),
                'Hot Rolled': Number(process.env.NEXT_PUBLIC_THRESHOLD_HR || 300),
                'Galvanised Sheet': Number(process.env.NEXT_PUBLIC_THRESHOLD_GS || 300),
                'Coils': Number(process.env.NEXT_PUBLIC_THRESHOLD_COILS || 300),
                'Billets': Number(process.env.NEXT_PUBLIC_THRESHOLD_BILLETS || 300),
              };
              const CAPACITY: Record<string, number> = {
                'TMT Bars': 700,
                'Hot Rolled': 700,
                'Galvanised Sheet': 700,
                'Coils': 700,
                'Billets': 700,
              };
              const pKeys = Object.keys(y.products || {});
              const low = pKeys.filter(p => (y.products as any)[p] < (THRESHOLDS as any)[p]);
              return (
                <li key={y.slug} className="rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-4 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-baseline justify-between mb-2">
                    <h2 className="text-lg font-semibold">{y.name}</h2>
                    <span className="text-xs opacity-70">{new Date().toLocaleTimeString()}</span>
                  </div>
                  {low.length > 0 && (
                    <div className="mb-3 text-xs text-brand-red bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                      Low stock alert: {low.join(', ')} below threshold
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="min-w-[420px] text-sm border border-white/10 rounded">
                      <thead className="bg-white/5">
                        <tr>
                          <th className="text-left px-3 py-2">Product</th>
                          <th className="text-right px-3 py-2 whitespace-nowrap">In Stock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pKeys.map((p) => {
                          const qty = (y.products as any)[p] || 0;
                          const cap = (CAPACITY as any)[p] || 100;
                          const left = Math.max(0, cap - qty);
                          const threshold = (THRESHOLDS as any)[p] || 0;
                          const pct = Math.max(0, Math.min(100, (qty / cap) * 100));
                          const isLow = qty < threshold;
                          return (
                            <tr key={p} className="border-t border-white/10 align-top">
                              <td className="px-3 py-2">
                                <div className="font-medium">{p}</div>
                                <div className="mt-1 h-1.5 w-full bg-white/10 rounded">
                                  <div className={`h-1.5 rounded ${isLow ? 'bg-red-400' : 'bg-brand-green'}`} style={{ width: `${pct}%` }} />
                                </div>
                                <div className="mt-1 text-[11px] opacity-75">
                                  {left.toLocaleString()} t left out of {cap.toLocaleString()} t
                                  {isLow && <span className="ml-2 text-red-400">(below threshold {threshold}t)</span>}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{qty.toLocaleString()} t</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </Guard>
  );
}
