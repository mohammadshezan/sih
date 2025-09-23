"use client";
import { useMemo, useState } from "react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { withBase } from "@/lib/config";

export default function WhatIfPage() {
  const [spike, setSpike] = useState(20); // percent
  const [forecast, setForecast] = useState<number[]|null>(null);
  const base = [100, 98, 102, 105, 107, 103, 104];
  const series = useMemo(()=>{
    const f = forecast || base.map(v=>Math.round(v*(1+spike/100)));
    return f.map((v,i)=>({ d: `D${i+1}`, base: base[i], whatif: v }));
  }, [forecast, spike]);

  const run = async () => {
    const token = localStorage.getItem('token')||'';
  const r = await fetch(withBase('/ai/forecast'), { method: 'POST', headers: { 'Content-Type':'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ series: base.map(v=>Math.round(v*(1+spike/100))), horizon: 7 }) });
    const data = await r.json();
    setForecast(data.forecast || null);
  };

  return (
    <main className="p-6 space-y-6">
      <h2 className="text-2xl font-semibold">What-If Simulation</h2>
      <div className="rounded-xl bg-white/5 p-4 border border-white/10">
        <div className="flex items-center gap-4">
          <label>Demand spike: <span className="font-semibold">+{spike}%</span></label>
          <input type="range" min={0} max={50} value={spike} onChange={e=>setSpike(parseInt(e.target.value))} />
          <button onClick={run} className="rounded-md bg-brand-green text-black px-3 py-1">Simulate</button>
        </div>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <XAxis dataKey="d" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip contentStyle={{ background: '#0b1220', border: '1px solid #374151' }} />
              <Legend />
              <Line dataKey="base" stroke="#60A5FA" strokeWidth={2} />
              <Line dataKey="whatif" stroke="#10B981" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </main>
  );
}
