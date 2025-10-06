"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { withBase } from "@/lib/config";
import io from 'socket.io-client';

export default function ProductionAlignmentPage(){
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState<boolean>(false);
  const router = useRouter();

  const [managerData, setManagerData] = useState<any>(null);
  const [wsMetrics, setWsMetrics] = useState<any>(null);
  const [appliedSuggestions, setAppliedSuggestions] = useState<string[]>([]);
  const [role, setRole] = useState<string>('guest');
  const trendRef = useRef<any[]>([]);
  const [trend, setTrend] = useState<any[]>([]);

  useEffect(()=>{
    const token = localStorage.getItem('token') || '';
    try {
      const payload = token ? JSON.parse(atob(token.split('.')[1]||'')) : null;
      const r = payload?.role || 'guest';
      setRole(r);
      if (r === 'manager' || r === 'admin') {
        setAllowed(true);
      } else {
        router.replace('/signin');
        return;
      }
    } catch {
      router.replace('/signin');
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const token = localStorage.getItem('token') || '';
        // Try enhanced manager dashboard first
        const enhanced = await fetch(withBase('/optimizer/alignment/manager-dashboard'), { headers: { Authorization: `Bearer ${token}` } });
        if (enhanced.ok) {
          const edata = await enhanced.json();
            if (!cancelled) setManagerData(edata);
        }
        // Base alignment for summary metrics
        const base = await fetch(withBase('/optimizer/production-alignment'), { headers: { Authorization: `Bearer ${token}` } });
        if (base.ok) {
          const bdata = await base.json();
          if (!cancelled) setData(bdata);
        }
      } catch (e) {
        if (!cancelled) setError('Failed to load production alignment');
      }
    };
    load();
    const iv = setInterval(load, 10000); // refresh every 10s
    return () => { cancelled = true; clearInterval(iv); };
  },[]);

  useEffect(()=>{
    if(!allowed) return;
    const socket = io(withBase('/ws/alignment'), { transports:['websocket'] });
    socket.on('heartbeat', (m)=> {
      setWsMetrics(m);
      trendRef.current.push(m);
      if (trendRef.current.length > 60) trendRef.current.shift();
      setTrend([...trendRef.current]);
    });
    return ()=> { socket.close(); };
  },[allowed]);

  const applySuggestion = (id:string, actionType:'approve'|'delay') => {
    if (actionType === 'approve' && !(role==='manager' || role==='admin')) return;
    if (actionType === 'delay' && role !== 'admin') return;
    setAppliedSuggestions(prev => prev.includes(id) ? prev : [...prev, id]);
  };

  const exportCSV = () => {
    const token = localStorage.getItem('token');
    window.open(withBase(`/optimizer/alignment/export.csv?token=${token}`),'_blank');
  };
  const exportPDF = () => {
    const token = localStorage.getItem('token');
    window.open(withBase(`/optimizer/alignment/export.pdf?token=${token}`),'_blank');
  };

  if(!allowed) return null;
  if(!data) return <main className="p-6">Loading…</main>;

  return (
    <main className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Production vs Wagon Alignment</h2>
        <p className="text-sm text-gray-400">Analyze how production plans align with available wagons and constraints</p>
      </div>

      {/* Summary */}
      {data.summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Summary title="Total Production" value={`${data.summary.totalProduction} T`} />
          <Summary title="Available Wagons" value={data.summary.availableWagons} />
            <Summary title="Capacity Gap" value={`${data.summary.capacityGap} T`} />
            <Summary title="Alignment Score" value={`${Math.round(data.summary.alignmentScore*100)}%`} />
            {managerData && <Summary title="Strategic Align" value={`${Math.round((managerData.strategic?.strategicAlignmentScore||0)*100)}%`} />}
        </div>
      )}

      {managerData && (
        <section className="space-y-6 mt-4">
          <div className="flex flex-wrap gap-3 items-center text-xs text-gray-400">
            <span className="px-2 py-1 rounded bg-white/5 border border-white/10">Live Avg Util: {wsMetrics? toFixedStr(wsMetrics?.avgUtil,1)+'%':'—'}</span>
            <span className="px-2 py-1 rounded bg-white/5 border border-white/10">Live Cost: {wsMetrics? '₹'+wsMetrics.cost.toLocaleString():'—'}</span>
            <span className="px-2 py-1 rounded bg-white/5 border border-white/10">Live CO₂: {wsMetrics? (toFixedStr(wsMetrics?.co2,1)+'T'):'—'}</span>
            <span className="px-2 py-1 rounded bg-white/5 border border-white/10">Align Score: {wsMetrics? Math.round((wsMetrics.alignmentScore||0)*100)+'%':'—'}</span>
            <button onClick={exportCSV} className="px-3 py-1 rounded bg-indigo-600 text-white text-xs hover:bg-indigo-500">Export CSV</button>
            <button onClick={exportPDF} className="px-3 py-1 rounded bg-green-600 text-white text-xs hover:bg-green-500">Export PDF</button>
          </div>
          {/* 360 Flow Map */}
          <div className="rounded-xl bg-white/5 p-4 border border-white/10">
            <h3 className="font-medium mb-2">📍 360° Alignment Map</h3>
            <div className="text-xs text-gray-400 mb-2">Plant ➜ Destination flows (tons, cost, CO₂)</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-800/50">
                  <tr>
                    <Th>From</Th><Th>To</Th><Th>Tons</Th><Th>Cost</Th><Th>CO₂</Th><Th>SLA</Th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(managerData?.map?.flows) ? managerData.map.flows : []).map((f:any,i:number)=>(
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <Td>{f.from}</Td>
                      <Td>{f.to}</Td>
                      <Td>{Math.round(f.tons)}</Td>
                      <Td>₹{(f.cost||0).toLocaleString()}</Td>
                      <Td>{toFixedStr(f.emissions,1)}T</Td>
                      <Td>{f.sla? '✅':'⚠️'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Strategic Priority */}
          <div className="rounded-xl bg-white/5 p-4 border border-white/10">
            <h3 className="font-medium mb-2">🧭 Strategic Priority Matching</h3>
            <p className="text-xs text-gray-400 mb-3">High-value / time-sensitive routes highlighted.</p>
            <ul className="text-sm space-y-1">
              {(managerData?.strategic?.prioritizedOrders ?? []).map((p:any,i:number)=>(<li key={i}>⭐ {p.route} — {p.tons}T ({p.reason})</li>))}
            </ul>
          </div>

          {/* Cost Alignment */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-xl bg-white/5 p-4 border border-white/10">
              <h3 className="font-medium mb-2">💸 Cost Alignment Tracker</h3>
              <p className="text-xs text-gray-400 mb-2">Freight + risk exposure</p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-gray-400">Freight:</span><br/>₹{(managerData?.cost?.totalFreight||0).toLocaleString()}</div>
                <div><span className="text-gray-400">Demurrage Risk:</span><br/>₹{(managerData?.cost?.demurrageRisk||0).toLocaleString()}</div>
                <div><span className="text-gray-400">Penalty Risk:</span><br/>₹{(managerData?.cost?.penaltyRisk||0).toLocaleString()}</div>
                <div><span className="text-gray-400">Suggestions:</span><br/>{(managerData?.cost?.suggestions?.length||0)}</div>
              </div>
              <ul className="mt-3 text-xs list-disc ml-5 space-y-1">
                {(managerData?.cost?.suggestions ?? []).map((s:any,i:number)=>(<li key={i}>{s.action} — {s.impact}</li>))}
              </ul>
            </div>

            {/* Sustainability */}
            <div className="rounded-xl bg-white/5 p-4 border border-white/10">
              <h3 className="font-medium mb-2">♻️ Sustainability Alignment</h3>
              <div className="text-sm grid grid-cols-2 gap-4">
                <div><span className="text-gray-400">Total CO₂:</span><br/>{toFixedStr(managerData?.sustainability?.totalCO2, 1)}T</div>
                <div><span className="text-gray-400">Avg / Rake:</span><br/>{toFixedStr(managerData?.sustainability?.avgPerRake, 1)}T</div>
                <div><span className="text-gray-400">Target CO₂:</span><br/>{toFixedStr(managerData?.sustainability?.targetCO2, 1)}T</div>
                <div><span className="text-gray-400">Eco Score:</span><br/>{Math.round(((managerData?.sustainability?.ecoScore)||0)*100)}%</div>
              </div>
              <div className="mt-3 max-h-32 overflow-auto text-xs space-y-1">
                {(managerData?.sustainability?.rakeEmissions ?? []).map((r:any)=>(<div key={r.id}>• {r.id}: {toFixedStr(r.emissions,1)}T ({toFixedStr(r.utilization,1)}% util)</div>))}
              </div>
            </div>
          </div>

          {/* Timeline & SLA */}
            <div className="rounded-xl bg-white/5 p-4 border border-white/10">
              <h3 className="font-medium mb-2">🕒 Timeline & SLA Alignment</h3>
              <div className="space-y-2 text-xs">
                {(managerData?.timeline ?? []).map((t:any)=> {
                  const spanHrs = (new Date(t.eta).getTime() - new Date(t.start).getTime())/3600000;
                  return (
                    <div key={t.id} className="flex items-center gap-3">
                      <div className="w-40 font-mono text-gray-300">{t.id}</div>
                      <div className="flex-1 h-3 bg-gray-800 rounded overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-indigo-500 to-blue-500" style={{ width: Math.min(100, spanHrs*8)+'%' }} />
                      </div>
                      <div className="w-32 text-gray-400">SLA Risk: {Math.round(t.slaRisk*100)}%</div>
                    </div>
                  );
                })}
              </div>
            </div>

          {/* AI Suggestions */}
          <div className="rounded-xl bg-white/5 p-4 border border-white/10">
            <h3 className="font-medium mb-2">🤖 AI Alignment Suggestions</h3>
            <ul className="text-sm space-y-2">
              {(managerData?.aiSuggestions ?? []).map((s:any)=>(
                <li key={s.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 bg-gray-800/40 p-2 rounded">
                  <div className="flex-1">⚡ {s.message} {appliedSuggestions.includes(s.id) && <span className="text-green-400 text-xs ml-2">(Applied)</span>}</div>
                  <div className="flex gap-2 text-xs">
                    <button
                      disabled={appliedSuggestions.includes(s.id) || !(role==='manager' || role==='admin')}
                      onClick={()=>applySuggestion(s.id,'approve')}
                      className="px-2 py-1 rounded bg-blue-600 disabled:opacity-40 hover:bg-blue-500 text-white">
                      Approve
                    </button>
                    <button
                      disabled={appliedSuggestions.includes(s.id) || role!=='admin'}
                      onClick={()=>applySuggestion(s.id,'delay')}
                      className="px-2 py-1 rounded bg-yellow-600 disabled:opacity-40 hover:bg-yellow-500 text-white">
                      Delay
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Collaboration Board (placeholder) */}
          <div className="rounded-xl bg-white/5 p-4 border border-white/10">
            <h3 className="font-medium mb-2">📢 Collaboration Board</h3>
            <p className="text-xs text-gray-400 mb-2">Inline comments & approvals (demo placeholder)</p>
            <div className="space-y-2 text-xs">
              <div className="p-2 rounded bg-gray-800/50">plant_mgr: Approving consolidation for Bhilai rake.</div>
              <div className="p-2 rounded bg-gray-800/50">log_coord: Adjusting departure to align with yard clearance.</div>
            </div>
          </div>

          {/* Policy Compliance */}
          <div className="rounded-xl bg-white/5 p-4 border border-white/10">
            <h3 className="font-medium mb-2">🔗 Policy & Compliance Alignment</h3>
            <div className="text-xs text-gray-400 mb-2">Rules checked: {(managerData?.policy?.rulesChecked)||0}</div>
            {(managerData?.policy?.violations?.length ? (
              <ul className="text-xs space-y-1 text-red-400">
                {(managerData?.policy?.violations ?? []).map((v:any,i:number)=>(<li key={i}>⚠️ {v.rake}: {v.rule} (Current {toFixedStr(v.current,1)}%)</li>))}
              </ul>
            ) : <div className="text-xs text-green-400">✅ No violations</div>)}
          </div>

          {/* Goal Alignment */}
          <div className="rounded-xl bg-white/5 p-4 border border-white/10">
            <h3 className="font-medium mb-3">🎯 Goal Alignment Dashboard</h3>
            <div className="grid md:grid-cols-3 gap-4 text-sm">
              {(managerData?.goals ? Object.entries(managerData.goals) : []).map(([k,v]:any)=>(
                <div key={k} className={`p-3 rounded border ${v.status==='green'?'border-green-500/40 bg-green-500/10':'border-yellow-500/40 bg-yellow-500/10'}`}>
                  <div className="uppercase text-xs tracking-wide text-gray-400">{k}</div>
                  <div className="text-lg font-semibold">{v.value}{k==='utilization'?'%':''}</div>
                  <div className="text-xs text-gray-400">Target: {v.target}</div>
                </div>
              ))}
            </div>
            {managerData?.team && (
              <div className="mt-6">
                <h4 className="font-medium mb-2">🤝 Team & Role Alignment</h4>
                <div className="grid md:grid-cols-2 gap-3 text-xs">
                  {(managerData?.team?.roles ?? []).map((r:any,i:number)=>(
                    <div key={i} className="flex items-center gap-3 p-2 rounded bg-gray-800/40">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
                        {r.role.split(' ').map((p:string)=>p[0]).join('').slice(0,2)}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-gray-200">{r.role}</div>
                        <div className="text-gray-400">{r.user}</div>
                        <div className="text-gray-500 text-[10px]">{r.responsibility}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Decision Impact & Heatmap + Trend */}
          <div className="rounded-xl bg-white/5 p-4 border border-white/10">
            <h3 className="font-medium mb-2">📊 Decision Impact Preview</h3>
            <ul className="text-xs space-y-1">
              {(managerData?.decisionImpactTemplates ?? []).map((d:any,i:number)=>(<li key={i}>• {d.action}: {Object.entries(d.effect).map(([k,val]:any)=> `${k} ${val}`).join(', ')}</li>))}
            </ul>
            {trend.length > 1 && (
              <div className="mt-4">
                <h4 className="font-medium mb-2">📈 Alignment Trend</h4>
                <div className="h-40 relative">
                  <TrendCanvas points={trend} />
                </div>
                <div className="flex gap-4 text-[10px] text-gray-400 mt-2">
                  <span>Samples: {trend.length}</span>
                  <span>Last Util: {toFixedStr(wsMetrics?.avgUtil,1)}%</span>
                  <span>Last CO₂: {toFixedStr(wsMetrics?.co2,1)}T</span>
                  <span>Last Align: {Math.round((wsMetrics?.alignmentScore||0)*100)}%</span>
                </div>
              </div>
            )}
            <div className="mt-4">
              <h4 className="font-medium mb-2">🔥 Emissions vs Utilization Heatmap</h4>
              <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                {(managerData?.sustainability?.rakeEmissions ?? []).slice(0,32).map((r:any)=>{
                  const util = Number(r.utilization) || 0; // 0-100
                  const em = Number(r.emissions) || 0; // raw tons
                  const normUtil = Math.min(1, util/100);
                  const baseAvg = Number(managerData?.sustainability?.avgPerRake) || 1;
                  const normEm = Math.min(1, em / (baseAvg*2));
                  const intensity = (normEm*0.6 + (1-normUtil)*0.4); // higher = worse
                  const bg = `hsl(${Math.round(120 - intensity*120)},70%,${40 + (1-intensity)*10}%)`;
                  return (
                    <div key={r.id} className="relative group h-10 rounded flex items-center justify-center text-[10px] font-bold text-black/70" style={{ background:bg }}>
                      {r.id.replace(/[^0-9]/g,'').slice(-2)}
                      <div className="absolute z-10 hidden group-hover:block bg-black/80 text-white p-2 rounded text-[10px] w-40 -top-2 left-1/2 -translate-x-1/2 -translate-y-full">
                        <div className="font-mono">{r.id}</div>
                        <div>Util: {toFixedStr(util,1)}%</div>
                        <div>CO₂: {toFixedStr(em,1)}T</div>
                        <div>Score: {Math.round((1-intensity)*100)}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Alerts */}
          {(managerData?.alerts?.length > 0) && (
            <div className="rounded-xl bg-white/5 p-4 border border-white/10">
              <h3 className="font-medium mb-2">🔔 Alignment Alerts</h3>
              <ul className="text-xs space-y-1">
                {(managerData?.alerts ?? []).map((a:any,i:number)=>(<li key={i}>{a.severity==='risk'?'🚨':a.severity==='warning'?'⚠️':'ℹ️'} {a.message}</li>))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Recommendations */}
      <div className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="font-medium mb-2">Recommendations</h3>
        <ul className="list-disc ml-6 text-sm text-gray-200 space-y-1">
          {Array.isArray(data.recommendations) && data.recommendations.length > 0
            ? data.recommendations.map((r:string, i:number)=> <li key={i}>{r}</li>)
            : <li className="text-gray-400 list-none">No recommendations at this time.</li>
          }
        </ul>
      </div>

      {/* Plant breakdown */}
      <div className="rounded-xl bg-white/5 p-4 border border-white/10">
        <h3 className="font-medium mb-2">Plant Breakdown</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <Th>Plant</Th><Th>Grade</Th><Th>Produced (T)</Th><Th>Required Wagons</Th><Th>Assigned Wagons</Th><Th>Gap</Th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {(Array.isArray(data?.plants) ? data.plants : []).map((p:any)=> (
                <tr key={p.plant} className="hover:bg-gray-50">
                  <Td>{p.plant}</Td>
                  <Td>{p.grade}</Td>
                  <Td>{p.produced}</Td>
                  <Td>{p.requiredWagons}</Td>
                  <Td>{p.assignedWagons}</Td>
                  <Td className={p.gap>0? 'text-red-600':'text-green-600'}>{p.gap}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function Summary({ title, value }:{ title:string; value:any }){
  return (
    <div className="rounded-xl bg-white/5 p-4 border border-white/10">
      <p className="text-xs text-gray-400">{title}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}
function Th({ children }: any) { return <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{children}</th>; }
function Td({ children }: any) { return <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{children}</td>; }

function TrendCanvas({ points }:{ points:any[] }) {
  if (!points.length) return null;
  const w = 600; const h = 140;
  const utilMax = 100; // percent
  const co2Max = Math.max(1, ...points.map(p=> p.co2||1));
  const alignMax = 1; // 0-1
  const step = w / Math.max(1, points.length - 1);
  const utilPath = points.map((p,i)=> `${i===0? 'M':'L'} ${i*step} ${h - (Math.min(100,p.avgUtil)/utilMax)*h}` ).join(' ');
  const alignPath = points.map((p,i)=> `${i===0? 'M':'L'} ${i*step} ${h - ((p.alignmentScore||0)/alignMax)*h}` ).join(' ');
  const bars = points.map((p,i)=> {
    const bh = (p.co2 / co2Max) * (h*0.4);
    return <rect key={i} x={i*step - 2} y={h - bh} width={4} height={bh} fill="rgba(16,185,129,0.5)" />;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 w-full h-full">
      <g>{bars}</g>
      <path d={utilPath} stroke="#3B82F6" fill="none" strokeWidth={2} />
      <path d={alignPath} stroke="#F59E0B" fill="none" strokeWidth={2} strokeDasharray="4 4" />
      <text x={8} y={12} fontSize={10} fill="#3B82F6">Util%</text>
      <text x={60} y={12} fontSize={10} fill="#F59E0B">Align%</text>
      <text x={120} y={12} fontSize={10} fill="#10B981">CO₂</text>
    </svg>
  );
}

// Safe numeric helpers to avoid calling toFixed on non-number values
function toNumber(val: any, fallback = 0): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
  if (val == null) return fallback;
  const n = parseFloat(String(val));
  return Number.isFinite(n) ? n : fallback;
}
function toFixedStr(val: any, digits = 1): string {
  const n = toNumber(val, 0);
  try {
    return n.toFixed(digits);
  } catch {
    return (0).toFixed(digits);
  }
}
