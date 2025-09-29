"use client";
import Guard from '@/components/Guard';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface WagonDetailResp {
  wagon: any;
  trends: Array<{ t: number; bearingTempC: number; wheelWearPercent: number; vibrationG: number }>;
  generatedAt: string;
}

export default function WagonDetailPage({ params }: { params: { id: string } }) {
  const id = params.id?.toUpperCase();
  const [data, setData] = useState<WagonDetailResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if(!token) return;
    setLoading(true);
    fetch(`${process.env.NODE_ENV==='production' ? 'https://qsteel-api.onrender.com':'http://localhost:4000'}/yard/wagon-health/${id}`, { headers: { Authorization: `Bearer ${token}` }})
      .then(r=> { if(r.status===404){ throw new Error('Not found'); } if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(json=> { setData(json); setError(null);} )
      .catch(e=> setError(e.message))
      .finally(()=> setLoading(false));
  }, [id]);

  return (
    <Guard allow={['yard'] as any}>
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <button onClick={()=> router.back()} className="text-xs underline text-gray-400 hover:text-white">← Back</button>
        <h1 className="text-2xl font-semibold">Wagon {id} Detail</h1>
        {loading && <div className="text-sm text-gray-400">Loading…</div>}
        {error && <div className="text-sm text-red-400">{error}</div>}
        {data && (
          <>
            <section className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <KPI label="Brake" value={data.wagon.brakeTestStatus} />
              <KPI label="Wheel Wear %" value={data.wagon.wheelWearPercent} />
              <KPI label="Bearing °C" value={data.wagon.bearingTempC} />
              <KPI label="Vibration g" value={data.wagon.vibrationG} />
              <KPI label="Alerts" value={data.wagon.alerts.length} />
              <KPI label="Mileage Km" value={data.wagon.mileageSinceServiceKm.toLocaleString()} />
            </section>
            <section>
              <h2 className="text-lg font-semibold mb-2">Trend (recent synthetic)</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Spark title="Bearing °C" color="#f97316" data={data.trends} field="bearingTempC" />
                <Spark title="Wheel Wear %" color="#6366f1" data={data.trends} field="wheelWearPercent" />
                <Spark title="Vibration g" color="#10b981" data={data.trends} field="vibrationG" />
              </div>
            </section>
            {data.wagon.alerts.length>0 && (
              <section>
                <h2 className="text-lg font-semibold mb-2">Alerts</h2>
                <ul className="text-sm space-y-1">
                  {data.wagon.alerts.map((a:string,i:number)=>(<li key={i} className="bg-red-500/10 border border-red-500/30 rounded px-3 py-1">{a}</li>))}
                </ul>
              </section>
            )}
            <section>
              <p className="text-[11px] text-gray-500">Generated: {new Date(data.generatedAt).toLocaleString()}</p>
            </section>
          </>
        )}
      </main>
    </Guard>
  );
}

function KPI({label,value}:{label:string; value:any}){
  return (
    <div className="p-3 rounded bg-white/5 border border-white/10">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Spark({ title, data, field, color }:{ title:string; data:any[]; field:string; color:string }){
  // Simple SVG sparkline
  const values = data.map(d=> d[field]);
  const min = Math.min(...values); const max = Math.max(...values);
  const pts = values.map((v,i)=> {
    const x = (i/(values.length-1))*100; // percent
    const y = max===min? 50 : (1 - (v-min)/(max-min))*100;
    return `${x},${y}`;
  }).join(' ');
  return (
    <div className="p-3 rounded bg-white/5 border border-white/10">
      <div className="text-xs mb-1 text-gray-300">{title}</div>
      <svg viewBox="0 0 100 100" className="w-full h-20">
        <polyline fill="none" stroke={color} strokeWidth={2} points={pts} />
      </svg>
      <div className="flex justify-between text-[10px] text-gray-500">
        <span>{min}</span><span>{max}</span>
      </div>
    </div>
  );
}
