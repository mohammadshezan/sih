"use client";
import { useEffect, useState, useMemo } from 'react';

export interface WagonHealthRow {
  id: string;
  lastBrakeTest: string;
  brakeTestStatus: string;
  wheelWearMm: number;
  wheelWearPercent: number;
  bearingTempC: number;
  vibrationG: number;
  sensors: { acoustic: string; infrared: string; loadCell: string };
  mileageSinceServiceKm: number;
  nextServiceDueKm: number;
  alerts: string[];
}

interface WagonHealthResponse {
  kpis: {
    total: number;
    brakeCompliance: number;
    avgWheelWear: number;
    overWearCount: number;
    sensorAlertRate: number;
    avgBearingTemp: number;
  };
  wagons: WagonHealthRow[];
  generatedAt: string;
}

export function useWagonHealth(autoRefreshMs = 45000) {
  const [data, setData] = useState<WagonHealthResponse | null>(null);
  const [prev, setPrev] = useState<WagonHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyAlerts, setOnlyAlerts] = useState(false);

  function buildMock(): WagonHealthResponse {
    // deterministic-ish mock
    const seed = Date.now();
    const rand = () => { const x = Math.sin((Date.now()+Math.random()) * 99991) * 10000; return x - Math.floor(x); };
    const wagons: WagonHealthRow[] = Array.from({length: 16}).map((_,i)=> {
      const wheelWearPercent = Number((30 + rand()*50).toFixed(1));
      const bearingTempC = Number((45 + rand()*30).toFixed(1));
      const brakeTestStatus = rand() < 0.9 ? 'PASS':'FAIL';
      const alerts:string[] = [];
      if (brakeTestStatus==='FAIL') alerts.push('Brake test failed');
      if (wheelWearPercent>65) alerts.push('High wheel wear');
      if (bearingTempC>65) alerts.push('Bearing overheating');
      return {
        id: `W${(i+1).toString().padStart(2,'0')}`,
        lastBrakeTest: new Date(Date.now() - rand()*72*3600*1000).toISOString(),
        brakeTestStatus,
        wheelWearMm: Number((6 + rand()*4).toFixed(1)),
        wheelWearPercent,
        bearingTempC,
        vibrationG: Number((0.3 + rand()*0.7).toFixed(2)),
        sensors: {
          acoustic: rand()<0.95? 'OK':'ALERT',
          infrared: rand()<0.9? 'OK':'HOT',
          loadCell: rand()<0.93? 'OK':'CALIBRATE'
        },
        mileageSinceServiceKm: Math.floor(2000 + rand()*8000),
        nextServiceDueKm: 12000,
        alerts
      };
    });
    const kpis = {
      total: wagons.length,
      brakeCompliance: Number((wagons.filter(w=> w.brakeTestStatus==='PASS').length / wagons.length *100).toFixed(1)),
      avgWheelWear: Number((wagons.reduce((s,w)=> s + w.wheelWearPercent,0)/wagons.length).toFixed(1)),
      overWearCount: wagons.filter(w=> w.wheelWearPercent>65).length,
      sensorAlertRate: Number((wagons.filter(w=> w.alerts.some(a=> a.includes('hot')||a.includes('acoustic'))).length / wagons.length *100).toFixed(1)),
      avgBearingTemp: Number((wagons.reduce((s,w)=> s + w.bearingTempC,0)/wagons.length).toFixed(1))
    };
    return { kpis, wagons, generatedAt: new Date().toISOString() };
  }

  const fetchData = () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLoading(true);
    fetch(`${process.env.NODE_ENV === 'production' ? 'https://qsteel-api.onrender.com' : 'http://localhost:4000'}/yard/wagon-health`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => { if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(json => {
        setPrev(data);
        // annotate changes (diff flags) if previous exists
        if (data) {
          const prevMap = new Map(data.wagons.map(w => [w.id, w]));
          json.wagons = json.wagons.map((w: any) => {
            const p = prevMap.get(w.id);
            if (!p) return { ...w, _changed: true };
            const changed = ['brakeTestStatus','wheelWearPercent','bearingTempC','vibrationG'].some(k => (p as any)[k] !== (w as any)[k]) || (p.alerts.join() !== w.alerts.join());
            return { ...w, _changed: changed };
          });
        }
        setData(json);
        setError(null);
      })
      .catch(e => {
        // fallback to mock data for demo if not yet loaded
        if (!data) {
          const mock = buildMock();
            mock.wagons = mock.wagons.map(w=> ({...w, _changed: true} as any));
          setData(mock as any);
          setError(null);
        } else {
          setError(e.message);
        }
      })
      .finally(()=> setLoading(false));
  };

  useEffect(() => { fetchData(); // initial
    if (autoRefreshMs > 0) {
      const id = setInterval(fetchData, autoRefreshMs);
      return () => clearInterval(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!data) return null;
    if (!onlyAlerts) return data;
    return { ...data, wagons: data.wagons.filter(w => w.alerts.length>0) } as WagonHealthResponse;
  }, [data, onlyAlerts]);

  return { data: filtered, raw: data, previous: prev, loading, error, refresh: fetchData, onlyAlerts, setOnlyAlerts };
}
