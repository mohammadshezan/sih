"use client";
import Guard from "@/components/Guard";
import { useWagonHealth } from "./useWagonHealth";
import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';

const statusColor = (s:string) => {
  if(['FAIL','HOT','ALERT','CALIBRATE'].includes(s)) return 'text-red-500';
  if(s==='PASS'|| s==='OK') return 'text-green-500';
  return 'text-yellow-500';
};

export default function WagonHealthPage(){
  const { data, raw, loading, error, refresh, onlyAlerts, setOnlyAlerts } = useWagonHealth(60000);
  const wagons = data?.wagons || [];
  const k = data?.kpis;
  const critical = useMemo(()=> wagons.filter(w=> w.alerts.length>0).slice(0,5), [wagons]);
  const [flashIds, setFlashIds] = useState<string[]>([]);
  useEffect(()=> {
    if (!raw) return;
    const changed = raw.wagons.filter((w:any)=> w._changed).map((w:any)=> w.id);
    if (changed.length){
      setFlashIds(changed);
      const t = setTimeout(()=> setFlashIds([]), 2500);
      return ()=> clearTimeout(t);
    }
  }, [raw]);
  return (
    <Guard allow={['yard'] as any}>
      <main className="max-w-7xl mx-auto p-6 space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Wagon Health</h1>
          <p className="text-sm text-gray-400">Brake tests, wheel wear, bearing temperature & sensor telemetry (mock data, auto-generated each load).</p>
        </header>
        {loading && <div className="text-sm text-gray-400">Loading wagon telemetry…</div>}
        {error && <div className="text-sm text-red-400">Error: {error}</div>}
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input type="checkbox" checked={onlyAlerts} onChange={e=> setOnlyAlerts(e.target.checked)} className="accent-brand-green" />
            Show only alert wagons
          </label>
          <button onClick={refresh} className="text-xs px-3 py-1 rounded bg-white/10 hover:bg-white/20 border border-white/10">↻ Refresh</button>
          <div className="text-[11px] text-gray-500">Auto-refresh: 60s</div>
          <div className="ml-auto flex gap-2 text-xs">
            <a href={`/yard/wagon-health?dl=1`} onClick={(e)=> {e.preventDefault(); window.open(`${process.env.NODE_ENV==='production' ? 'https://qsteel-api.onrender.com':'http://localhost:4000'}/yard/wagon-health/export.csv?token=${localStorage.getItem('token')}`,'_blank');}} className="underline text-gray-300 hover:text-white">Export CSV</a>
            <a href="#" onClick={(e)=> {e.preventDefault(); window.open(`${process.env.NODE_ENV==='production' ? 'https://qsteel-api.onrender.com':'http://localhost:4000'}/yard/wagon-health/export.pdf?token=${localStorage.getItem('token')}`,'_blank');}} className="underline text-gray-300 hover:text-white">Export PDF</a>
          </div>
        </div>
        {data && (
          <>
            <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <KPI label="Total Wagons" value={k?.total} />
              <KPI label="Brake Pass %" value={k?.brakeCompliance + '%'} trend={k?.brakeCompliance && k?.brakeCompliance<90? '↓':'↑'} />
              <KPI label="Avg Wheel Wear %" value={k?.avgWheelWear + '%'} />
              <KPI label="Over Wear" value={k?.overWearCount} />
              <KPI label="Sensor Alert %" value={k?.sensorAlertRate + '%'} />
              <KPI label="Avg Bearing °C" value={k?.avgBearingTemp + '°'} />
            </section>
            {critical.length>0 && (
              <section>
                <h2 className="text-lg font-semibold mb-2">⚠️ Critical / Attention</h2>
                <ul className="space-y-1 text-sm">
                  {critical.map(c => (
                    <li key={c.id} className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded">
                      <span className="font-mono text-xs mt-0.5">{c.id}</span>
                      <span className="text-red-300">{c.alerts.join('; ')}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
              <table className="min-w-full text-xs">
                <thead className="bg-white/10 text-gray-300">
                  <tr>
                    <Th>ID</Th>
                    <Th>Brake Test</Th>
                    <Th>Wheel Wear</Th>
                    <Th>Bearing °C</Th>
                    <Th>Vibration (g)</Th>
                    <Th>Sensors</Th>
                    <Th>Since Service (km)</Th>
                    <Th>Alerts</Th>
                  </tr>
                </thead>
                <tbody>
                  {wagons.map(w => {
                    const changed = (w as any)._changed;
                    const flashing = flashIds.includes(w.id);
                    return (
                    <tr key={w.id} className={`odd:bg-white/0 even:bg-white/5 hover:bg-brand-green/10 transition-colors ${flashing? 'animate-pulse bg-brand-green/20':''}`}>
                      <Td mono>
                        <Link href={`/yard/wagon-health/${w.id.toLowerCase()}`} className="underline decoration-dotted hover:text-brand-green">{w.id}</Link>
                        {changed && <span className="ml-1 text-[9px] text-brand-green">Δ</span>}
                      </Td>
                      <Td>
                        <span className={statusColor(w.brakeTestStatus)}>{w.brakeTestStatus}</span>
                        <div className="text-[10px] text-gray-500">{new Date(w.lastBrakeTest).toLocaleString()}</div>
                      </Td>
                      <Td>
                        {w.wheelWearPercent.toFixed(1)}% <span className="text-gray-500">({w.wheelWearMm}mm)</span>
                      </Td>
                      <Td className={w.bearingTempC>65? 'text-red-400':''}>{w.bearingTempC}</Td>
                      <Td>{w.vibrationG}</Td>
                      <Td>
                        <div className="flex flex-col gap-0.5">
                          <span className={statusColor(w.sensors.acoustic)}>Acoustic: {w.sensors.acoustic}</span>
                          <span className={statusColor(w.sensors.infrared)}>IR: {w.sensors.infrared}</span>
                          <span className={statusColor(w.sensors.loadCell)}>Load: {w.sensors.loadCell}</span>
                        </div>
                      </Td>
                      <Td>{w.mileageSinceServiceKm.toLocaleString()}</Td>
                      <Td>{w.alerts.length? <span className="text-red-400">{w.alerts.length}</span>: '—'}</Td>
                    </tr>
                    );})}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </Guard>
  );
}

function KPI({label,value,trend}:{label:string;value:any;trend?:string}){
  return (
    <div className="p-3 rounded-md bg-white/5 border border-white/10">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-lg font-semibold flex items-center gap-1">{value}{trend && <span className={trend==='↓'? 'text-red-400 text-xs':'text-green-400 text-xs'}>{trend}</span>}</div>
    </div>
  );
}

const Th = (p:any) => <th className="text-left py-2 px-3 font-medium">{p.children}</th>;
interface TdProps { children: React.ReactNode; mono?: boolean; className?: string; }
const Td = ({children, mono=false, className=''}: TdProps) => <td className={`py-2 px-3 align-top ${mono?'font-mono text-[11px]':''} ${className}`}>{children}</td>;
