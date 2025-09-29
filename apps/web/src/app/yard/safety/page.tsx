"use client";
import Guard from "@/components/Guard";
import { useEffect, useState, useMemo, useRef } from 'react';
import io from 'socket.io-client';

interface SafetyData {
  summary: { totalIncidents:number; openIncidentCount:number; highSeverity:number; checklistIssues:number; complianceScore:number };
  compliance: { ppe:number; housekeeping:number; equipment:number; trainingCompletion:number; lastLostTimeIncidentDays:number };
  incidents: Array<{ id:string; type:string; severity:string; description:string; reportedBy:string; shift:string; status:string; ts:string }>;
  checklists: Array<{ id:string; title:string; shift:string; completedAt:string; items:Array<{ name:string; status:string; note:string }> }>;
  openIssues: Array<{ checklist:string; item:string; note:string }>;
  generatedAt: string;
}

export default function YardSafetyPage(){
  const [data,setData] = useState<SafetyData|null>(null);
  const [error,setError] = useState<string|null>(null);
  const [loading,setLoading] = useState(false);
  const [onlyOpen,setOnlyOpen] = useState(false);
  const [history,setHistory] = useState<any[]>([]);
  const [page,setPage] = useState(0);
  const pageSize = 10;
  const socketRef = useRef<any>(null);

  const load = () => {
    const token = localStorage.getItem('token');
    if(!token) return;
    setLoading(true);
    fetch(`${process.env.NODE_ENV==='production' ? 'https://qsteel-api.onrender.com':'http://localhost:4000'}/yard/safety`, { headers: { Authorization: `Bearer ${token}` }})
      .then(r=> { if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(json => { setData(json); setError(null); })
      .catch(e=> {
        // fallback mock for demo clarity when backend unavailable/404
        if (!data) {
          const mock = buildMockSafety();
          setData(mock);
          setError(null);
        } else {
          setError(e.message);
        }
      })
      .finally(()=> setLoading(false));
  };

  // initial load + history
  useEffect(()=> {
    const stored = localStorage.getItem('yardSafety.onlyOpen');
    if (stored) setOnlyOpen(stored === '1');
    load();
    const token = localStorage.getItem('token');
    if (token) {
      fetch(`${process.env.NODE_ENV==='production' ? 'https://qsteel-api.onrender.com':'http://localhost:4000'}/yard/safety/history`, { headers: { Authorization: `Bearer ${token}` }})
        .then(r=> r.ok ? r.json(): [])
        .then(h=> setHistory(h.slice(-40)))
        .catch(()=>{});
    }
    // websocket for push updates
    socketRef.current = io(process.env.NODE_ENV==='production' ? 'https://qsteel-api.onrender.com':'http://localhost:4000', { transports:['websocket'] });
    socketRef.current.on('safety:update', (msg:any) => {
      setData(msg.snapshot);
      setHistory(h => [...h, { generatedAt: msg.snapshot.generatedAt, compliance: msg.snapshot.compliance, summary: msg.snapshot.summary }].slice(-60));
    });
    return () => { socketRef.current?.disconnect(); };
  }, []);

  useEffect(()=> { localStorage.setItem('yardSafety.onlyOpen', onlyOpen ? '1':'0'); }, [onlyOpen]);

  const incidents = useMemo(()=> {
    if(!data) return [];
    return data.incidents.filter(i=> !onlyOpen || i.status==='Open');
  }, [data, onlyOpen]);

  const pagedIncidents = incidents.slice(page*pageSize, (page+1)*pageSize);
  useEffect(()=> { if (page*pageSize >= incidents.length) setPage(0); }, [incidents, page]);

  const complianceSeries = useMemo(()=> {
    return history.map(h => ({ t: h.generatedAt, ppe: h.compliance.ppe, house: h.compliance.housekeeping, eq: h.compliance.equipment }));
  }, [history]);

  return (
    <Guard allow={['yard'] as any}>
      <main className="max-w-7xl mx-auto p-6 space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Yard Safety</h1>
          <p className="text-sm text-gray-400">Safety checklists, incidents, compliance KPIs (mock demo).</p>
          <div className="flex flex-wrap gap-4 items-center text-xs text-gray-400">
            <button onClick={load} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/10">↻ Refresh</button>
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-green" checked={onlyOpen} onChange={e=> setOnlyOpen(e.target.checked)} />Only open incidents</label>
            {data && <a href="#" onClick={(e)=> {e.preventDefault(); window.open(`${process.env.NODE_ENV==='production' ? 'https://qsteel-api.onrender.com':'http://localhost:4000'}/yard/safety/export.csv?token=${localStorage.getItem('token')}`,'_blank');}} className="underline hover:text-white">Export Incidents CSV</a>}
            {data && <span className="ml-auto text-[10px]">Generated {new Date(data.generatedAt).toLocaleTimeString()}</span>}
          </div>
        </header>
        {loading && <div className="text-sm text-gray-400">Loading safety data…</div>}
        {error && <div className="text-sm text-red-400">Error: {error}</div>}
        {data && (
          <>
            <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <KPI label="Incidents" value={data.summary.totalIncidents} />
              <KPI label="Open" value={data.summary.openIncidentCount} warn={data.summary.openIncidentCount>2} />
              <KPI label="High Sev" value={data.summary.highSeverity} warn={data.summary.highSeverity>0} />
              <KPI label="Checklist Issues" value={data.summary.checklistIssues} warn={data.summary.checklistIssues>3} />
              <KPI label="Compliance Score" value={data.summary.complianceScore + '%'} />
              <KPI label="LTI Free Days" value={data.compliance.lastLostTimeIncidentDays} />
            </section>
            <section className="bg-white/5 border border-white/10 rounded p-4 space-y-3">
              <h2 className="text-sm font-semibold">Compliance Trends</h2>
              <div className="grid md:grid-cols-3 gap-4 text-[10px]">
                <Spark title="PPE" color="#10b981" values={complianceSeries.map(p=>p.ppe)} />
                <Spark title="Housekeeping" color="#6366f1" values={complianceSeries.map(p=>p.house)} />
                <Spark title="Equipment" color="#f59e0b" values={complianceSeries.map(p=>p.eq)} />
              </div>
            </section>
            <section className="bg-white/5 border border-white/10 rounded-md p-4 space-y-4">
              <h2 className="text-lg font-semibold">Incidents</h2>
              <div className="flex justify-end gap-2 text-xs">
                <button disabled={page===0} onClick={()=> setPage(p=> Math.max(0,p-1))} className="px-2 py-1 rounded bg-white/10 disabled:opacity-30">Prev</button>
                <span className="px-2 py-1">Page {page+1} / {Math.max(1, Math.ceil(incidents.length / pageSize))}</span>
                <button disabled={(page+1)*pageSize >= incidents.length} onClick={()=> setPage(p=> p+1)} className="px-2 py-1 rounded bg-white/10 disabled:opacity-30">Next</button>
              </div>
              <table className="w-full text-xs">
                <thead className="text-gray-300 bg-white/10">
                  <tr>
                    <Th>ID</Th><Th>Type</Th><Th>Severity</Th><Th>Status</Th><Th>Shift</Th><Th>Description</Th><Th>Reported</Th><Th>When</Th>
                  </tr>
                </thead>
                <tbody>
                  {pagedIncidents.map(i => (
                    <tr key={i.id} className="odd:bg-white/0 even:bg-white/5">
                      <Td mono>{i.id}</Td>
                      <Td>{i.type}</Td>
                      <Td className={i.severity==='High'? 'text-red-400': i.severity==='Medium'? 'text-yellow-400':'text-green-400'}>{i.severity}</Td>
                      <Td className={i.status==='Open'? 'text-orange-300':'text-green-400'}>{i.status}</Td>
                      <Td>{i.shift}</Td>
                      <Td className="max-w-[220px] truncate" title={i.description}>{i.description}</Td>
                      <Td className="text-[10px] text-gray-400">{i.reportedBy}</Td>
                      <Td className="text-[10px] text-gray-400">{new Date(i.ts).toLocaleDateString()}</Td>
                    </tr>
                  ))}
                  {incidents.length===0 && <tr><td colSpan={8} className="py-4 text-center text-gray-500">No incidents</td></tr>}
                </tbody>
              </table>
            </section>
            <section className="grid md:grid-cols-3 gap-6">
              {data.checklists.map(c => (
                <div key={c.id} className="bg-white/5 border border-white/10 rounded-md p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-sm">{c.title}</h3>
                    <span className="text-[10px] text-gray-400">{c.shift}</span>
                  </div>
                  <ul className="space-y-1 text-xs">
                    {c.items.map(it => (
                      <li key={it.name} className="flex justify-between"><span className="truncate mr-2">{it.name}</span><span className={it.status==='ISSUE'? 'text-red-400':'text-green-400'}>{it.status}</span></li>
                    ))}
                  </ul>
                  <div className="text-[10px] text-gray-500">Completed {new Date(c.completedAt).toLocaleTimeString()}</div>
                </div>
              ))}
            </section>
            <section className="bg-white/5 border border-white/10 rounded-md p-4">
              <h2 className="text-lg font-semibold mb-2">Open Checklist Issues</h2>
              <ul className="text-sm space-y-1">
                {data.openIssues.map((o,i)=>(<li key={i} className="flex justify-between bg-red-500/10 border border-red-500/30 rounded px-3 py-1"><span>{o.item}</span><span className="text-[11px] text-gray-400">{o.checklist}</span></li>))}
                {data.openIssues.length===0 && <li className="text-gray-500 text-sm">None</li>}
              </ul>
            </section>
          </>
        )}
      </main>
    </Guard>
  );
}

function KPI({label,value,warn}:{label:string;value:any;warn?:boolean}){
  return (
    <div className={`p-3 rounded-md border ${warn? 'bg-red-500/10 border-red-500/30':'bg-white/5 border-white/10'}`}>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

const Th = (p:any) => <th className="text-left py-2 px-3 font-medium">{p.children}</th>;
interface TdProps { children: React.ReactNode; mono?: boolean; className?: string; title?: string }
const Td = ({children, mono=false, className='', title}: TdProps) => <td title={title} className={`py-2 px-3 align-top ${mono?'font-mono text-[11px]':''} ${className}`}>{children}</td>;

function buildMockSafety(): SafetyData {
  const rand = () => Math.random();
  const incidents = Array.from({length:5}).map((_,i)=> ({ id:`INC-DEMO-${i+1}`, type: rand()<0.4? 'Near Miss':'Unsafe Condition', severity: rand()<0.7? 'Low': (rand()<0.85? 'Medium':'High'), description: rand()<0.5? 'Temporary obstruction in aisle':'Improper stacking observed', reportedBy: 'yard@sail.test', shift: ['Morning','Afternoon','Night'][i%3], status: rand()<0.5? 'Open':'Closed', ts: new Date(Date.now()- i*3600*1000).toISOString() }));
  const compliance = { ppe: 92.4, housekeeping: 88.1, equipment: 85.6, trainingCompletion: 78.2, lastLostTimeIncidentDays: 37 };
  const checklists = [
    { id:'CHK-PPE', title:'PPE Compliance', shift:'Morning', completedAt:new Date().toISOString(), items:[ 'Helmets','Gloves','Eye Protection','Hi-Vis Vests','Safety Boots' ].map(n=> ({ name:n, status: n==='Eye Protection'? 'ISSUE':'OK', note:''}))},
    { id:'CHK-HOUSE', title:'Housekeeping', shift:'Afternoon', completedAt:new Date().toISOString(), items:[ 'Clear Aisles','No Oil Spills','Material Stacking','Waste Segregation' ].map(n=> ({ name:n, status:'OK', note:''}))}
  ];
  const openIssues = [{ checklist:'CHK-PPE', item:'Eye Protection', note:'' }];
  const summary = { totalIncidents: incidents.length, openIncidentCount: incidents.filter(i=> i.status==='Open').length, highSeverity: incidents.filter(i=> i.severity==='High').length, checklistIssues: openIssues.length, complianceScore: Number(((compliance.ppe+compliance.housekeeping+compliance.equipment)/3).toFixed(1)) };
  return { summary, compliance, incidents, checklists, openIssues, generatedAt: new Date().toISOString() };
}

function Spark({ title, values, color }: { title:string; values:number[]; color:string }) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const norm = (v:number)=> (v - min)/(max-min || 1);
  const pts = values.map((v,i)=> `${(i/(values.length-1))*100},${(1-norm(v))*100}`).join(' ');
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]"><span>{title}</span><span>{values[values.length-1]?.toFixed?.(1)}</span></div>
      <svg viewBox="0 0 100 100" className="w-full h-10">
        <polyline fill="none" stroke={color} strokeWidth={2} points={pts} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
