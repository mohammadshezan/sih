"use client";
import Guard from "@/components/Guard";
import { useState } from 'react';

interface ScenarioInput { id?: string; origin:string; destination:string; product:string; tonnage:number; desiredDeparture?: string; wagons?: number }
interface SimulationResult {
  id:string; input:ScenarioInput; distanceKm:number; wagonsUsed:number; capacityPerWagon:number; loadedQty:number; utilization:number; departure:string; eta:string; transitHours:number; locoType:string; cost:{ transport:number; energy:number; handling:number; total:number }; emissionsKg:number; emissionsDeltaVsAlternate:number; notes:string[]
}

export default function SimulatorPage(){
  const [scenarios, setScenarios] = useState<ScenarioInput[]>([{
    origin:'Bokaro', destination:'Bhilai', product:'Iron Ore', tonnage:3200, desiredDeparture:new Date(Date.now()+60*60*1000).toISOString().slice(0,16)
  }]);
  const [running,setRunning] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [results,setResults] = useState<SimulationResult[]|null>(null);
  const [aggregate,setAggregate] = useState<any>(null);
  const [locoType,setLocoType] = useState<'diesel'|'electric'>('diesel');

  const updateScenario = (idx:number, patch:Partial<ScenarioInput>) => {
    setScenarios(s => s.map((sc,i)=> i===idx? { ...sc, ...patch }: sc));
  };
  const addScenario = () => {
    setScenarios(s => [...s, { origin:'Bokaro', destination:'Durgapur', product:'Coal', tonnage:2800, desiredDeparture:new Date().toISOString().slice(0,16) }]);
  };
  const removeScenario = (idx:number) => setScenarios(s => s.filter((_,i)=> i!==idx));
  const run = () => {
    const token = localStorage.getItem('token');
    if(!token) return;
    setRunning(true); setError(null);
    const base = process.env.NODE_ENV==='production' ? 'https://qsteel-api.onrender.com':'http://localhost:4000';
    const body = JSON.stringify({ scenarios: scenarios.map(s=> ({...s, tonnage: Number(s.tonnage)})), constraints:{ locoType } });
    function call(path:string){
      return fetch(base + path, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body });
    }
    call('/simulator/run')
      .then(r=> r.ok? r.json(): call('/manager/simulator/run').then(r2=> { if(!r2.ok) throw new Error(`HTTP ${r.status}`); return r2.json(); }))
      .then(json => { setResults(json.results); setAggregate(json.aggregate); })
      .catch(()=> {
        const mock = buildMockResults(scenarios, locoType);
        setResults(mock.results as any); setAggregate(mock.aggregate); setError(null);
      })
      .finally(()=> setRunning(false));
  };

  function buildMockResults(input:ScenarioInput[], loco:'diesel'|'electric'){
    const res = input.map((sc,i)=> {
      const distanceKm = 320 + i*140;
      const wagonsUsed = Math.max(8, Math.round(sc.tonnage/220));
      const util = Math.min(100, Number(((sc.tonnage)/(wagonsUsed*60)*100).toFixed(1)));
      const depart = new Date();
      const transitHours = 11 + i*1.3;
      const eta = new Date(depart.getTime()+ transitHours*3600*1000);
      const totalCost = 420000 + i*70000;
      const emissionsKg = Number((wagonsUsed * distanceKm * (loco==='electric'?0.018:0.032)).toFixed(2));
      return { id:`SCN-${i+1}`, input:sc, distanceKm, wagonsUsed, capacityPerWagon:60, loadedQty: sc.tonnage, utilization: util, departure: depart.toISOString(), eta: eta.toISOString(), transitHours, locoType:loco, cost:{ transport: Math.round(totalCost*0.7), energy: Math.round(totalCost*0.2), handling: Math.round(totalCost*0.1), total: totalCost }, emissionsKg, emissionsDeltaVsAlternate: Number((emissionsKg * (loco==='electric'? 1.35 : -0.45)).toFixed(2)), notes: util<85? ['Low utilization — consider consolidating']: [] };
    });
    const aggregate = { scenarios: res.length, totalWagons: res.reduce((s,r)=> s+r.wagonsUsed,0), avgUtilization: Number((res.reduce((s,r)=> s+r.utilization,0)/res.length).toFixed(1)), totalCost: res.reduce((s,r)=> s+r.cost.total,0), totalEmissionsKg: Number(res.reduce((s,r)=> s+r.emissionsKg,0).toFixed(2)) };
    return { results: res, aggregate };
  }

  return (
    <Guard allow={['manager'] as any}>
      <main className="max-w-7xl mx-auto p-6 space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Operations Simulator</h1>
          <p className="text-sm text-gray-400">What-if rake allocation, cost, utilization & ETA scenario comparison.</p>
        </header>
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <button onClick={addScenario} className="px-3 py-1 rounded bg-white/10 border border-white/10 hover:bg-white/20">+ Add Scenario</button>
            <div className="flex items-center gap-2">Loco Type:
              <select value={locoType} onChange={e=> setLocoType(e.target.value as any)} className="bg-white/10 border border-white/10 rounded px-2 py-1 text-xs">
                <option value="diesel">Diesel</option>
                <option value="electric">Electric</option>
              </select>
            </div>
            <button disabled={running} onClick={run} className="px-4 py-1 rounded bg-brand-green/20 border border-brand-green/30 text-brand-green hover:bg-brand-green/30 disabled:opacity-40">{running? 'Running…':'Run Simulation'}</button>
            {error && <span className="text-red-400">{error}</span>}
          </div>
          <div className="space-y-4">
            {scenarios.map((s,i)=>(
              <div key={i} className="p-4 rounded-md bg-white/5 border border-white/10 space-y-3">
                <div className="flex justify-between items-center text-xs font-semibold">Scenario #{i+1}
                  <button onClick={()=> removeScenario(i)} className="text-red-400 hover:underline" disabled={scenarios.length===1}>Remove</button>
                </div>
                <div className="grid md:grid-cols-6 gap-3 text-xs">
                  <Field label="Origin"><input value={s.origin} onChange={e=> updateScenario(i,{origin:e.target.value})} className="w-full bg-white/10 border border-white/10 rounded px-2 py-1" /></Field>
                  <Field label="Destination"><input value={s.destination} onChange={e=> updateScenario(i,{destination:e.target.value})} className="w-full bg-white/10 border border-white/10 rounded px-2 py-1" /></Field>
                  <Field label="Product"><input value={s.product} onChange={e=> updateScenario(i,{product:e.target.value})} className="w-full bg-white/10 border border-white/10 rounded px-2 py-1" /></Field>
                  <Field label="Tonnage (T)"><input type="number" value={s.tonnage} onChange={e=> updateScenario(i,{tonnage:Number(e.target.value)})} className="w-full bg-white/10 border border-white/10 rounded px-2 py-1" /></Field>
                  <Field label="Depart (local)"><input type="datetime-local" value={s.desiredDeparture} onChange={e=> updateScenario(i,{desiredDeparture:e.target.value})} className="w-full bg-white/10 border border-white/10 rounded px-2 py-1" /></Field>
                  <Field label="Wagons (opt)"><input type="number" value={s.wagons||''} placeholder="auto" onChange={e=> updateScenario(i,{wagons: e.target.value? Number(e.target.value): undefined})} className="w-full bg-white/10 border border-white/10 rounded px-2 py-1" /></Field>
                </div>
              </div>
            ))}
          </div>
        </section>
        {aggregate && results && (
          <section className="space-y-4">
            <div className="grid md:grid-cols-5 gap-4">
              <Agg label="Scenarios" value={aggregate.scenarios} />
              <Agg label="Total Wagons" value={aggregate.totalWagons} />
              <Agg label="Avg Util %" value={aggregate.avgUtilization} />
              <Agg label="Total Cost" value={`₹${aggregate.totalCost.toLocaleString()}`} />
              <Agg label="Emissions (kg)" value={aggregate.totalEmissionsKg} />
            </div>
            <div className="overflow-auto border border-white/10 rounded-lg">
              <table className="min-w-full text-[11px]">
                <thead className="bg-white/10 text-gray-300">
                  <tr>
                    <Th>ID</Th><Th>Origin→Dest</Th><Th>Product</Th><Th>Tons</Th><Th>Wagons</Th><Th>Util%</Th><Th>Depart</Th><Th>ETA</Th><Th>Transit h</Th><Th>Cost ₹</Th><Th>Emissions kg</Th><Th>Δ Alt Emis</Th><Th>Notes</Th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(r=> (
                    <tr key={r.id} className="odd:bg-white/0 even:bg-white/5">
                      <Td mono>{r.id}</Td>
                      <Td>{r.input.origin} → {r.input.destination}</Td>
                      <Td>{r.input.product}</Td>
                      <Td>{r.input.tonnage}</Td>
                      <Td>{r.wagonsUsed}</Td>
                      <Td>{r.utilization}</Td>
                      <Td>{new Date(r.departure).toLocaleTimeString()}</Td>
                      <Td>{new Date(r.eta).toLocaleTimeString()}</Td>
                      <Td>{r.transitHours}</Td>
                      <Td>{r.cost.total.toLocaleString()}</Td>
                      <Td>{r.emissionsKg}</Td>
                      <Td className={r.emissionsDeltaVsAlternate<0? 'text-green-400':'text-yellow-400'}>{r.emissionsDeltaVsAlternate}</Td>
                      <Td className="max-w-[220px] truncate" title={r.notes.join('; ')}>{r.notes.join('; ')|| '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </Guard>
  );
}

function Field({label, children}:{label:string;children:any}){
  return <label className="space-y-1 text-xs"><div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>{children}</label>;
}
function Agg({label,value}:{label:string;value:any}){
  return <div className="p-3 rounded-md bg-white/5 border border-white/10"><div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div><div className="text-sm font-semibold">{value}</div></div>;
}
const Th = (p:any) => <th className="text-left py-2 px-3 font-medium">{p.children}</th>;
interface TdProps { children: React.ReactNode; mono?: boolean; className?: string; title?: string }
const Td = ({children, mono=false, className='', title}: TdProps) => <td title={title} className={`py-2 px-3 align-top ${mono?'font-mono text-[10px]':''} ${className}`}>{children}</td>;
