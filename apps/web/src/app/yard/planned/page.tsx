"use client";
import { useEffect, useState } from "react";
import Guard from "@/components/Guard";
import { useToast } from "@/components/Toast";
import { withBase } from "@/lib/config";

type PlannedRake = {
  code: string;
  wagons: number;
  yard: string | null;
  status: string;
};

export default function PlannedRakesPage() {
  const [rakes, setRakes] = useState<PlannedRake[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";
  const { push } = useToast();

  async function load() {
    try {
      const res = await fetch(withBase("/yard/planned-rakes"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load planned rakes");
      const data = await res.json();
      setRakes(Array.isArray(data) ? data : []);
    } catch (e) {
      push({ text: "Could not load planned rakes", tone: "error" });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function confirmLoading(code: string) {
    setBusyId(code);
    try {
      const res = await fetch(withBase(`/yard/rake/${code}/confirm-loading`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to confirm loading");
      push({ text: `Loading confirmed for ${code}` , tone: "success" });
    } catch (e) {
      push({ text: `Failed to confirm ${code}`, tone: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function dispatchRake(r: PlannedRake) {
    setBusyId(r.code);
    const payload = {
      from: "Bokaro Steel Plant",
      to: r.yard || "Stockyard",
      cargo: "Steel",
      tonnage: Math.max(0, (r.wagons || 0) * 60),
    };
    try {
      const res = await fetch(withBase(`/yard/rake/${r.code}/dispatch`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to dispatch");
      push({ text: `Dispatched ${r.code}` , tone: "success" });
      // Optimistic refresh
      load();
    } catch (e) {
      push({ text: `Failed to dispatch ${r.code}`, tone: "error" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Guard allow={["yard"]}>
      <div className="mx-auto max-w-4xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Planned Rakes</h1>
          <button onClick={load} className="text-sm rounded-md border border-white/10 px-3 py-1">Refresh</button>
        </div>
        <p className="text-sm text-gray-300">Quickly confirm loading and dispatch rakes planned by the manager.</p>
        <div className="grid gap-4">
          {rakes.map((r) => (
            <div key={r.code} className="rounded-lg border border-white/10 p-4 flex items-center justify-between bg-white/5">
              <div>
                <div className="font-medium">{r.code}</div>
                <div className="text-xs text-gray-400">{r.yard || "Unassigned"} • {r.wagons} wagons • {r.status}</div>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={busyId === r.code}
                  onClick={() => confirmLoading(r.code)}
                  className="px-4 py-2 rounded-md bg-blue-500 text-white text-sm"
                >
                  Confirm Loading
                </button>
                <button
                  disabled={busyId === r.code}
                  onClick={() => dispatchRake(r)}
                  className="px-4 py-2 rounded-md bg-green-500 text-white text-sm"
                >
                  Dispatch
                </button>
              </div>
            </div>
          ))}
          {rakes.length === 0 && (
            <div className="text-sm text-gray-400">No planned rakes right now.</div>
          )}
        </div>
      </div>
    </Guard>
  );
}
