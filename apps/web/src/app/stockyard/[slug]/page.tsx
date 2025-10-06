"use client";
import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { getStockyard, PRODUCTS } from "@/lib/stockyards";
import Guard from "@/components/Guard";
import { withBase } from "@/lib/config";

export default function StockyardDetail({ params }: { params: { slug: string } }) {
  const yard = getStockyard(params.slug);
  if (!yard) return notFound();
  const [incoming, setIncoming] = useState<Array<{ code: string; status: string }>>([]);
  const [pending, setPending] = useState<Array<{ id: string; customer?: string; cargo?: string }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    async function load() {
      setLoading(true);
      try {
        const headers: any = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        // Incoming rakes filtered by yard name
  const r1 = await fetch(withBase(`/yard/incoming?yard=${encodeURIComponent(yard!.name)}`), { headers });
        const j1 = r1.ok ? await r1.json() : [];
        // Pending dispatches for this yard
  const r2 = await fetch(withBase(`/yard/dispatches?yard=${encodeURIComponent(yard!.name)}`), { headers });
        const j2 = r2.ok ? await r2.json() : [];
        if (!mounted) return;
        setIncoming(Array.isArray(j1) ? j1.slice(0, 6) : []);
        setPending(Array.isArray(j2) ? j2.slice(0, 6) : []);
      } catch {
        if (!mounted) return;
        setIncoming([]); setPending([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  return (
    <Guard allow={["supervisor","admin"]}>
    <main className="p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{yard.name} — Stockyard Dashboard</h1>
        <p className="opacity-80 text-sm">Updated just now</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Inventory (tons)</h2>
        <div className="overflow-x-auto">
          <table className="min-w-[520px] text-sm border border-white/10 rounded">
            <thead className="bg-white/5">
              <tr>
                <th className="text-left px-4 py-2">Product</th>
                <th className="text-right px-4 py-2">In Stock</th>
              </tr>
            </thead>
            <tbody>
              {PRODUCTS.map(p => (
                <tr key={p} className="border-t border-white/10">
                  <td className="px-4 py-2">{p}</td>
                  <td className="px-4 py-2 text-right font-medium">{yard.products[p].toLocaleString()} t</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid sm:grid-cols-2 gap-4">
        <div className="border border-white/10 rounded p-4">
          <h3 className="font-medium mb-2">Incoming Rakes</h3>
          {loading ? (
            <p className="opacity-80 text-sm">Loading…</p>
          ) : incoming.length ? (
            <ul className="text-sm space-y-1">
              {incoming.map((r:any) => (
                <li key={r.code} className="flex justify-between">
                  <span>{r.code}</span>
                  <span className="opacity-70">{r.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="opacity-80 text-sm">No incoming rakes right now.</p>
          )}
        </div>
        <div className="border border-white/10 rounded p-4">
          <h3 className="font-medium mb-2">Pending Dispatches</h3>
          {loading ? (
            <p className="opacity-80 text-sm">Loading…</p>
          ) : pending.length ? (
            <ul className="text-sm list-disc pl-5">
              {pending.map(p => (
                <li key={p.id}>{p.cargo || 'Pending item'}</li>
              ))}
            </ul>
          ) : (
            <p className="opacity-80 text-sm">No pending items right now.</p>
          )}
        </div>
      </section>
    </main>
    </Guard>
  );
}
