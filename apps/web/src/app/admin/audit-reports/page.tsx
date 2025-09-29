"use client";
import { useEffect, useMemo, useState } from "react";
import Guard from "@/components/Guard";
import { withBase } from "@/lib/config";
import { ResponsiveContainer, LineChart, Line, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";

type Item = {
  id: string;
  type: string;
  severity: "low"|"medium"|"high"|"critical"|string;
  rakeId: string;
  route: string;
  title: string;
  details: string;
  metricName: string;
  metricValue: number|string;
  status: string;
  actor: string;
  ts: string;
}

export default function AuditReports() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [fType, setFType] = useState<string>('all');
  const [fSev, setFSev] = useState<string>('all');
  const [fActor, setFActor] = useState<string>('all');

  useEffect(() => {
    let alive = true;
    const token = localStorage.getItem('token') || '';
    const load = () => {
      fetch(withBase('/reports/audit'), { headers: { Authorization: `Bearer ${token}` } })
        .then(async r => {
          if (!r.ok) {
            const text = await r.text().catch(()=>'');
            throw new Error(`HTTP ${r.status} ${r.statusText}${text?` – ${text.slice(0,120)}`:''}`);
          }
          return r.json();
        })
        .then(d => { if (!alive) return; setItems(d.items || []); setError(''); })
        .catch((e) => { if (!alive) return; setError('Failed to load reports'); console.error('Audit load error:', e); })
        .finally(() => { if (!alive) return; setLoading(false); });
    };
    load();
    const id = setInterval(load, 5000); // auto-refresh every 5s
    return () => { alive = false; clearInterval(id); };
  }, []);

  const exportCsv = async () => {
    const token = localStorage.getItem('token') || '';
    const res = await fetch(withBase('/reports/audit.csv'), { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'audit-compliance.csv';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const exportPdf = async () => {
    const token = localStorage.getItem('token') || '';
    const res = await fetch(withBase('/reports/audit.pdf'), { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'audit-compliance.pdf';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  return (
    <Guard allow={['admin'] as any}>
      <main className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Audit & Compliance Reports</h1>
            <p className="text-sm text-gray-400">Safety, emissions, SLA and governance findings</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} className="rounded-md bg-brand-green text-black px-4 py-2">Export CSV</button>
            <button onClick={exportPdf} className="rounded-md border border-white/20 px-4 py-2">Export PDF</button>
          </div>
        </div>

        {/* Filters */}
        <div className="rounded-xl bg-white/5 p-4 border border-white/10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Type</label>
              <select value={fType} onChange={e=>setFType(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2">
                {['all','Safety Incident','Emission','SLA Breach','Compliance Audit'].map(t=> <option key={t} value={t}>{t === 'all' ? 'All' : t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Severity</label>
              <select value={fSev} onChange={e=>setFSev(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2">
                {['all','low','medium','high','critical'].map(s=> <option key={s} value={s}>{s==='all'?'All':s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Actor</label>
              <select value={fActor} onChange={e=>setFActor(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-md px-2 py-2">
                {['all', ...Array.from(new Set(items.map(i=>i.actor)))].map(a=> <option key={a} value={a}>{a==='all'?'All':a}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <Kpis items={items} />

        {/* Emissions trend */}
        <div className="rounded-xl bg-white/5 p-4 border border-white/10">
          <h3 className="mb-2">Carbon Emissions Trend</h3>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={buildEmissionsSeries(items)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="co2" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {loading && <div>Loading…</div>}
        {error && <div className="text-red-500 text-sm">{error}</div>}

        {!loading && (
          <div className="rounded-xl bg-white/5 p-4 border border-white/10">
            <h3 className="mb-2">Findings</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <Th>ID</Th><Th>Type</Th><Th>Severity</Th><Th>Rake</Th><Th>Route/Location</Th><Th>Title</Th><Th>Metric</Th><Th>Value</Th><Th>Status</Th><Th>Actor</Th><Th>Timestamp</Th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {items
                    .filter(r => fType==='all' || r.type===fType)
                    .filter(r => fSev==='all' || r.severity===fSev)
                    .filter(r => fActor==='all' || r.actor===fActor)
                    .map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <Td>{r.id}</Td>
                      <Td>{r.type}</Td>
                      <Td>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${sevTone(r.severity)}`}>{r.severity}</span>
                      </Td>
                      <Td>{r.rakeId}</Td>
                      <Td>{r.route}</Td>
                      <Td title={r.details}>{r.title}</Td>
                      <Td>{r.metricName}</Td>
                      <Td>{String(r.metricValue)}</Td>
                      <Td>{r.status}</Td>
                      <Td>{r.actor}</Td>
                      <Td>{new Date(r.ts).toLocaleString()}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </Guard>
  );
}

function Th({ children }: any) { return <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{children}</th>; }
function Td({ children }: any) { return <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{children}</td>; }
function sevTone(sev: string) {
  switch (sev) {
    case 'critical': return 'bg-red-100 text-red-700';
    case 'high': return 'bg-orange-100 text-orange-700';
    case 'medium': return 'bg-yellow-100 text-yellow-700';
    default: return 'bg-green-100 text-green-700';
  }
}

function Kpis({ items }: { items: Item[] }) {
  const { safePct, slaPct } = useMemo(() => {
    const total = items.length || 1;
    // Safe deliveries: no safety incident with status Open/Investigating on delivered rakes
    const unsafeIds = new Set(items.filter(i => i.type==='Safety Incident' && /open|investigating/i.test(i.status)).map(i=>i.rakeId));
    // Approx: consider rakes not in unsafeIds as safe (best-effort with mock data)
    const rakeIds = Array.from(new Set(items.map(i=>i.rakeId).filter(Boolean)));
    const safe = rakeIds.filter(id => !unsafeIds.has(id)).length;
    const safePct = rakeIds.length ? Math.round((safe / rakeIds.length) * 100) : 100;
    // SLA met: items of type "SLA Breach" not Open count as met; if none, assume 100% met
    const slaItems = items.filter(i => i.type==='SLA Breach');
    const met = slaItems.filter(i => !/open/i.test(i.status)).length;
    const slaPct = slaItems.length ? Math.round((met / slaItems.length) * 100) : 100;
    return { safePct, slaPct };
  }, [items]);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard title="Safe Deliveries" value={`${safePct}%`} hint="No open safety incidents on rakes" />
      <KpiCard title="SLA Met" value={`${slaPct}%`} hint="Non-open SLA breaches" />
      <KpiCard title="Open Findings" value={items.filter(i=>/open|investigating|assigned/i.test(i.status)).length} hint="Currently active items" />
      <KpiCard title="Total Findings" value={items.length} hint="All records in window" />
    </div>
  );
}

function KpiCard({ title, value, hint }:{ title:string; value:any; hint?:string }){
  return (
    <div className="rounded-xl bg-white/5 p-4 border border-white/10">
      <p className="text-xs text-gray-400">{title}</p>
      <p className="text-3xl font-bold">{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function buildEmissionsSeries(items: Item[]) {
  // Aggregate CO₂ (t) over a timeline by minute bucket
  const emissions = items.filter(i => i.type==='Emission' && /co2|CO₂/.test(i.metricName));
  const byBucket = new Map<string, number>();
  emissions.forEach(e => {
    const d = new Date(e.ts);
    const bucket = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    const prev = byBucket.get(bucket) || 0;
    const val = typeof e.metricValue === 'number' ? e.metricValue : parseFloat(String(e.metricValue));
    byBucket.set(bucket, prev + (isFinite(val) ? val : 0));
  });
  // Sort by time label
  return Array.from(byBucket.entries()).sort(([a],[b]) => a.localeCompare(b)).map(([name, co2]) => ({ name, co2 }));
}
