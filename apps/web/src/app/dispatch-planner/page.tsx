"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { withBase } from "@/lib/config";

export default function DispatchPlannerPage() {
  const [plan, setPlan] = useState<any>(null);
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState<boolean>(false);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    try {
      const payload = token ? JSON.parse(atob(token.split('.')[1]||'')) : null;
      const role = payload?.role || 'guest';
      if (role === 'manager' || role === 'admin') {
        setAllowed(true);
      } else {
        router.replace('/signin');
        return;
      }
    } catch {
      router.replace('/signin');
      return;
    }
    fetch(withBase('/optimizer/daily-plan'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then(setPlan).catch(()=> setError('Failed to load daily plan'));
  }, []);

  const exportCsv = async () => {
    const token = localStorage.getItem('token') || '';
    try {
      const res = await fetch(withBase('/optimizer/export/daily-plan.csv'), { headers: { Authorization: `Bearer ${token}` } });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'daily-plan.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed');
    }
  };

  const exportPdf = async () => {
    const token = localStorage.getItem('token') || '';
    try {
      const res = await fetch(withBase('/optimizer/export/daily-plan.pdf'), { headers: { Authorization: `Bearer ${token}` } });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'daily-plan.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed');
    }
  };

  if (!allowed) return null;
  if (!plan) return <main className="p-6">Loading…</main>;

  return (
    <main className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Dispatch Planner</h2>
          <p className="text-sm text-gray-400">Decision support view with Gantt and exports</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="rounded-md bg-brand-green text-black px-4 py-2">Export CSV</button>
          <button onClick={exportPdf} className="rounded-md border border-white/20 px-4 py-2">Export PDF</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi title="Total Rakes" value={plan.kpis.totalRakes} tone="blue" />
        <Kpi title="On-Time" value={plan.kpis.onTimeDeliveries} tone="green" />
        <Kpi title="Avg Utilization" value={`${plan.kpis.avgUtilization.toFixed(1)}%`} tone="purple" />
        <Kpi title="Total Cost" value={`₹${plan.kpis.totalCost.toLocaleString()}`} tone="orange" />
        <Kpi title="CO₂ Saved" value={`${plan.kpis.carbonSaved.toFixed(1)}T`} tone="teal" />
      </div>

      {/* Gantt-like list */}
      <div className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="mb-2">Schedule</h3>
        <div className="space-y-2">
          {plan.gantt.map((t:any, i:number) => (
            <div key={t.id} className="flex items-center gap-4 bg-white/5 rounded-md p-3">
              <div className="w-48">
                <div className="font-medium text-sm">{t.name}</div>
                <div className="text-xs text-gray-400">⏰ {new Date(t.start).toLocaleString()} → {new Date(t.end).toLocaleString()}</div>
              </div>
              <div className="flex-1 h-6 bg-white/10 rounded">
                <div className={`h-6 rounded ${t.priority==='High'?'bg-red-500':t.priority==='Medium'?'bg-yellow-500':'bg-green-500'}`} style={{ width: `${Math.min(100,(i+1)*15)}%` }} />
              </div>
              <div className="text-xs text-gray-400">{t.resources.join(' • ')}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Rake table */}
      <div className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="mb-2">Rake Plan</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <Th>Rake ID</Th><Th>Cargo</Th><Th>Loading Point</Th><Th>Destination</Th><Th>Wagons</Th><Th>ETA</Th><Th>Cost</Th><Th>SLA</Th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {plan.rakes.map((r:any) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <Td>{r.id}</Td>
                  <Td>{r.cargo}</Td>
                  <Td>{r.loadingPoint}</Td>
                  <Td>{r.destination}</Td>
                  <Td>{r.wagons} {r.wagonType}</Td>
                  <Td>{new Date(r.eta).toLocaleString()}</Td>
                  <Td>₹{r.cost.toLocaleString()}</Td>
                  <Td>{r.slaFlag? '✅':'⚠️'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function Kpi({ title, value, tone }:{ title:string; value:any; tone:string }) {
  return (
    <div className="rounded-xl bg-white/5 p-4 border border-white/10">
      <p className="text-xs text-gray-400">{title}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}
function Th({ children }: any) { return <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{children}</th>; }
function Td({ children }: any) { return <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{children}</td>; }
