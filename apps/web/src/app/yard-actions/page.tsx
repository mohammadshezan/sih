"use client";
import { useEffect, useState } from "react";
import Guard from "@/components/Guard";
import { useToast } from "@/components/Toast";
import { withBase } from "@/lib/config";

type Rake = { code: string; yard: string | null; status: string };

export default function YardActionsPage() {
  const [rakes, setRakes] = useState<Rake[]>([]);
  const [loading, setLoading] = useState(false);
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') || '' : '';
  const { push } = useToast();

  useEffect(() => {
    const load = async () => {
      try {
  const r = await fetch(withBase("/yard/rakes"), { headers: { Authorization: `Bearer ${token}` } });
        const data = await r.json();
        setRakes(data);
      } catch (e) {
        push({ text: "Failed to load rakes", tone: "error" });
      }
    };
    load();
  }, [token]);

  async function confirmLoading(code: string) {
    setLoading(true);
    try {
  const r = await fetch(withBase(`/yard/rake/${code}/confirm-loading`), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error('Request failed');
      push({ text: `Loading confirmed for ${code}`, tone: 'success' });
    } catch (e) {
      push({ text: `Failed to confirm ${code}`, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function dispatchRake(code: string) {
    const payload = { from: 'Yard', to: 'Plant', cargo: 'Ore', tonnage: 100 };
    setLoading(true);
    try {
  const r = await fetch(withBase(`/yard/rake/${code}/dispatch`), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error('Request failed');
      push({ text: `Dispatched ${code}`, tone: 'success' });
    } catch (e) {
      push({ text: `Failed to dispatch ${code}`, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
  <Guard allow={["yard"]}>
      <div className="mx-auto max-w-4xl p-4 space-y-4">
        <h1 className="text-2xl font-semibold">Yard Actions</h1>
        <p className="text-sm text-gray-300">Confirm loading and dispatch rakes. Designed for big touch targets.</p>
        <div className="grid gap-4">
          {rakes.map(r => (
            <div key={r.code} className="rounded-lg border border-white/10 p-4 flex items-center justify-between bg-white/5">
              <div>
                <div className="font-medium">{r.code}</div>
                <div className="text-xs text-gray-400">{r.yard || 'Unassigned'} • {r.status}</div>
              </div>
              <div className="flex gap-2">
                <button disabled={loading} onClick={() => confirmLoading(r.code)} className="px-4 py-3 rounded-lg bg-blue-500 text-white text-sm">Confirm Loading</button>
                <button disabled={loading} onClick={() => dispatchRake(r.code)} className="px-4 py-3 rounded-lg bg-green-500 text-white text-sm">Dispatch</button>
              </div>
            </div>
          ))}
          {rakes.length === 0 && (
            <div className="text-sm text-gray-400">No rakes pending right now.</div>
          )}
        </div>
      </div>
    </Guard>
  );
}
