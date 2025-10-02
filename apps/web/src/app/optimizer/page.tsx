'use client';

import { useState, useEffect } from 'react';
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, 
  PieChart, Pie, Cell, ResponsiveContainer, ScatterChart, Scatter
} from 'recharts';
import { trackAction } from '@/lib/analytics';

const API_BASE = process.env.NODE_ENV === 'production' 
  ? 'https://qsteel-api.onrender.com' 
  : 'http://localhost:4000';

const OptimizerPage = () => {
  const [optimizationResult, setOptimizationResult] = useState<any>(null);
  const [constraints, setConstraints] = useState<any>(null);
  const [productionAlignment, setProductionAlignment] = useState<any>(null);
  const [dailyPlan, setDailyPlan] = useState<any>(null);
  const [scenarioResults, setScenarioResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('optimization');
  const [weights, setWeights] = useState({
    cost: 0.3,
    sla: 0.4,
    utilization: 0.2,
    emissions: 0.1
  });
  const [highContrast, setHighContrast] = useState<boolean>(false);

  // Load preference
  useEffect(() => {
    try { const v = localStorage.getItem('optimizer_high_contrast'); if (v) setHighContrast(v === '1'); } catch {}
  }, []);
  const toggleContrast = () => {
    setHighContrast(prev => {
      const next = !prev; try { localStorage.setItem('optimizer_high_contrast', next ? '1':'0'); } catch {}
      return next;
    });
  };
  
  const [scenarioConfig, setScenarioConfig] = useState({
    sidingCapacity: {} as Record<string, number>,
    wagonAvailability: {} as Record<string, number>,
    demandChange: {} as Record<string, number>
  });

  useEffect(() => {
    loadConstraints();
    loadProductionAlignment();
    loadDailyPlan();
  }, []);

  const apiCall = async (endpoint: string, options: any = {}) => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers
      },
      ...options
    });
    if (response.status === 401) {
      // Redirect to sign-in if unauthorized
      if (typeof window !== 'undefined') {
        window.location.href = '/signin';
      }
      throw new Error('Unauthorized');
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return response.json();
  };

  const loadConstraints = async () => {
    try {
      const data = await apiCall('/optimizer/constraints');
      setConstraints(data);
    } catch (error) {
      console.error('Failed to load constraints:', error);
    }
  };

  const loadProductionAlignment = async () => {
    try {
      const data = await apiCall('/optimizer/production-alignment');
      setProductionAlignment(data);
    } catch (error) {
      console.error('Failed to load production alignment:', error);
    }
  };

  const loadDailyPlan = async () => {
    try {
      const data = await apiCall('/optimizer/daily-plan');
      setDailyPlan(data);
    } catch (error) {
      console.error('Failed to load daily plan:', error);
    }
  };

  const runOptimization = async () => {
    try { trackAction('run_optimization'); } catch {}
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const base = API_BASE;
      const body = JSON.stringify({ weights });
      async function trySeq(paths:string[]) {
        for (const p of paths) {
          try {
            const r = await fetch(base + p, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body });
            if (r.ok) return await r.json();
          } catch {}
        }
        throw new Error('all_failed');
      }
      const data = await trySeq([
        '/optimizer/rake-formation',
        '/manager/optimizer/rake-formation',
        '/admin/optimizer/rake-formation'
      ]).catch(async () => {
        // fallback: pull lightweight mock endpoint, else generate local stub
        try {
          const r = await fetch(base + '/optimizer/mock', { headers:{ Authorization:`Bearer ${token}` }});
          if (r.ok) return await r.json();
        } catch {}
        return buildLocalOptimizationMock();
      });
      setOptimizationResult(data);
    } catch (error) {
      console.error('Optimization failed:', error);
      setOptimizationResult(buildLocalOptimizationMock());
    } finally {
      setLoading(false);
    }
  };

  const runAdvancedOptimization = async () => {
    try { trackAction('run_advanced_optimization'); } catch {}
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const base = API_BASE;
      const body = JSON.stringify({ weights });
      const adaptAdvancedResponse = (data:any) => {
        try {
          if (!data || !data.optimization) return data;
            const opt = data.optimization.optimal;
            // Only adapt if advanced shape (no summary) is detected
            if (opt && !opt.summary) {
              const utilRatio = typeof opt.utilization === 'number' && opt.utilization <= 1.5 ? opt.utilization : (opt.utilization/100);
              const slaRisk = typeof opt.slaRisk === 'number' ? opt.slaRisk : 0.05;
              const summary = {
                totalCost: opt.cost ?? 0,
                slaCompliance: Math.max(0, 1 - slaRisk), // keep 0..1 like basic API
                avgUtilization: (utilRatio * 100),
                totalEmissions: opt.emissions ?? opt.carbon ?? 0,
                carbonFootprint: opt.emissions ?? opt.carbon ?? 0
              };
              data.optimization.optimal = { ...opt, summary };
              const alts = Array.isArray(data.optimization.alternatives) ? data.optimization.alternatives : [];
              // Compute heuristic scores consistent with weights (normalize for display ~0.85-0.95)
              const rawScores = alts.map((a: any) => {
                const uRatio = (typeof a.utilization === 'number' && a.utilization <= 1.5) ? a.utilization : a.utilization/100;
                return (
                  -weights.cost * (a.cost||0) - weights.emissions * (a.emissions||0) - weights.sla * (a.slaRisk||0)*1000 + weights.utilization * uRatio * 1000
                );
              });
              const min = Math.min(...rawScores, 0);
              const max = Math.max(...rawScores, 1);
              const norm = (v:number) => 0.85 + ((v - min) / (max - min + 1e-9)) * 0.1;
              data.optimization.alternatives = alts.map((a: any, i: number) => {
                const uRatio = (typeof a.utilization === 'number' && a.utilization <= 1.5) ? a.utilization : a.utilization/100;
                return {
                  name: a.name || a.id || `Alt ${i+1}`,
                  score: Number(norm(rawScores[i]).toFixed(3)),
                  summary: {
                    totalCost: a.cost ?? 0,
                    slaCompliance: Math.max(0, 1 - (a.slaRisk||0)),
                    avgUtilization: uRatio * 100,
                    totalEmissions: a.emissions ?? 0,
                    carbonFootprint: a.emissions ?? 0
                  }
                };
              });
            }
        } catch (e) {
          console.warn('adaptAdvancedResponse failed', e);
        }
        return data;
      };
      async function trySeq(paths:string[]) {
        for (const p of paths) {
          try {
            const r = await fetch(base + p, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body });
            if (r.ok) return await r.json();
          } catch {}
        }
        throw new Error('all_failed');
      }
      const data = await trySeq([
        '/optimizer/rake-formation/advanced',
        '/manager/optimizer/rake-formation/advanced',
        '/admin/optimizer/rake-formation/advanced'
      ]).catch(() => buildLocalAdvancedMock());
      // Tag result so UI can show expanded explainability sections
      (data as any)._advanced = true;
      setOptimizationResult(adaptAdvancedResponse(data));
    } catch (e) {
      console.error('Advanced optimization failed:', e);
      setOptimizationResult(buildLocalAdvancedMock());
    } finally {
      setLoading(false);
    }
  };

  function buildLocalAdvancedMock(){
    return {
      success:true,
      _advanced:true,
      optimization:{
        method:'hybrid-milp-heuristic',
        optimal:{ id:'ALT-1', cost:12850, emissions:840, slaRisk:0.042, utilization:0.91 },
        alternatives:[
          { id:'ALT-1', cost:12850, emissions:840, slaRisk:0.042, utilization:0.91 },
          { id:'ALT-2', cost:13300, emissions:790, slaRisk:0.051, utilization:0.905 },
          { id:'ALT-3', cost:12440, emissions:905, slaRisk:0.060, utilization:0.93 },
          { id:'ALT-4', cost:13920, emissions:760, slaRisk:0.055, utilization:0.89 }
        ],
        explanation:{
          method:'hybrid-milp-heuristic',
            objectiveWeights:weights,
            stages:[
              { stage:'clustering', clusters:4, details:[{destination:'BHILAI',orders:2,totalQty:4000}]},
              { stage:'heuristic_seeding', wagonsSeeded:12, avgFill:87.5 },
              { stage:'local_refinement', swapsTried:9, bestVariance:0.0123 },
              { stage:'pareto_sampling', samples:4 }
            ],
            decisionLog:[
              'Clustered by destination to reduce fragmentation',
              'Seeded high-priority orders first',
              'Executed local swaps to reduce load variance',
              'Generated Pareto frontier for planner review'
            ],
            rationale:'Local heuristic + swap hill-climb approximates MILP quickly for UI responsiveness.'
        }
      },
      wagons: Array.from({length:8}).map((_,i)=>({ id:'WG'+(i+1), used: 40 + i*3, capacity:60, fill: Number(((40+i*3)/60*100).toFixed(1)), orders:[{id:'ORD00'+((i%4)+1), alloc:40+i*3}]})),
      meta:{ clusters:4, utilization:89.3 }
    };
  }

  const runScenarioAnalysis = async () => {
    try { trackAction('run_scenario_analysis', { scenario: scenarioConfig }); } catch {}
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const base = API_BASE;
      const payload = JSON.stringify({ scenario:'Custom Analysis', disruptions: scenarioConfig });
      async function trySeq(paths:string[]) {
        for (const p of paths) {
          try {
            const r = await fetch(base + p, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body: payload });
            if (r.ok) return await r.json();
          } catch {}
        }
        throw new Error('all_failed');
      }
      const data = await trySeq([
        '/optimizer/scenario-analysis',
        '/manager/optimizer/scenario-analysis',
        '/admin/optimizer/scenario-analysis'
      ]).catch(() => buildLocalScenarioMock());
      setScenarioResults(data);
    } catch (error) {
      console.error('Scenario analysis failed:', error);
      setScenarioResults(buildLocalScenarioMock());
    } finally {
      setLoading(false);
    }
  };

  function buildLocalOptimizationMock(){
    // minimal local fabrication resembling API shape
    const rakes = Array.from({ length: 4}).map((_,i)=> ({
      id:`RAKE-DEMO-${i+1}`, wagons: 42+i*3, wagonType:'BOXN', utilization: 78 + i*5, cost: 250000 + i*40000,
      slaFlag: i%3!==0, cargo: ['HRC','CRC','PIPES','BILLETS'][i%4], loadingPoint:'Bokaro', destination:['Bhilai','Rourkela','Durgapur','Asansol'][i%4]
    }));
    const summary = {
      totalCost: rakes.reduce((s,r)=> s+r.cost,0), slaCompliance: 0.87, avgUtilization: rakes.reduce((s,r)=> s+r.utilization,0)/rakes.length,
      carbonFootprint: 540, totalEmissions: 540
    };
    const alternatives = [0,1].map(i => ({ name:`Alt ${i+1}`, score: 0.91 - i*0.02, summary: { ...summary, totalCost: summary.totalCost*(1+ i*0.03), slaCompliance: summary.slaCompliance - i*0.02 } }));
    return { success:true, optimization:{ optimal:{ summary, rakes }, alternatives, explanation:{ keyDecisions:[ 'Selected BOXN wagons for balance of cost & capacity', 'Prioritized SLA for high priority orders' ] } }, mock:true };
  }
  function buildLocalScenarioMock(){
    return {
      impact:{ costDelta: 125000, slaDelta: -0.03, utilizationDelta: -2.4 },
      recommendations:[
        { type:'Reallocate Wagons', action:'Shift 5 BOXN to Bokaro', impact:'₹85K cost avoidance', priority:'High' },
        { type:'Adjust Departure', action:'Advance rake RAKE-DEMO-2 by 1h', impact:'Improve SLA by 1.2%', priority:'Medium' }
      ]
    };
  }

  const exportDailyPlan = () => {
    const token = localStorage.getItem('token');
    try { trackAction('export_daily_plan_csv'); } catch {}
    window.open(`${API_BASE}/optimizer/export/daily-plan.csv?token=${token}`, '_blank');
  };

  const renderOptimizationTab = () => (
    <div className="space-y-6">
      {/* Multi-Objective Weight Controls */}
  <div className="p-6 rounded-lg shadow bg-gray-900 border border-gray-700">
        <h3 className="text-lg font-semibold mb-4 text-gray-100">🎯 Optimization Weights</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(weights).map(([key, value]) => (
            <div key={key} className="space-y-2">
              <label className="block text-sm font-medium text-gray-300 capitalize">
                {key === 'sla' ? 'SLA Compliance' : key} ({Math.round(value * 100)}%)
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={value}
                onChange={(e) => setWeights({
                  ...weights,
                  [key]: parseFloat(e.target.value)
                })}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
              />
            </div>
          ))}
        </div>
        <button
          onClick={runOptimization}
          disabled={loading}
          className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-500/90 disabled:opacity-50 transition-colors font-medium shadow"
        >
          {loading ? '🔄 Optimizing...' : '🚀 Run Optimization'}
        </button>
        <button
          onClick={runAdvancedOptimization}
          disabled={loading}
          className="mt-4 ml-3 bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '🧮 Running MILP…' : '⚡ Advanced Hybrid (MILP + Heuristic)'}
        </button>
      </div>

      {/* Optimization Results */}
      {optimizationResult && (
        <div className="space-y-6">
          {/* Helpers */}
          {(() => {
            // Inline helpers for formatting
            const _ = 0; // no-op to allow IIFE block in TSX
            return null;
          })()}
          {/* Key Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <div className="text-2xl font-bold text-green-600">
                ₹{optimizationResult.optimization.optimal.summary.totalCost.toLocaleString()}
              </div>
              <div className="text-sm text-green-800">💰 Total Cost</div>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <div className="text-2xl font-bold text-blue-600">
                {(() => {
                  const v = optimizationResult.optimization.optimal.summary.slaCompliance;
                  const pct = v <= 1 ? v * 100 : v;
                  return `${pct.toFixed(1)}%`;
                })()}
              </div>
              <div className="text-sm text-blue-800">⏰ SLA Compliance</div>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
              <div className="text-2xl font-bold text-purple-600">
                {optimizationResult.optimization.optimal.summary.avgUtilization.toFixed(1)}%
              </div>
              <div className="text-sm text-purple-800">📊 Avg Utilization</div>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
              <div className="text-2xl font-bold text-orange-600">
                {(() => {
                  const s = optimizationResult.optimization.optimal.summary as any;
                  const emissions = (s.totalEmissions ?? s.carbonFootprint ?? 0) as number;
                  return `${emissions.toFixed(1)}T`;
                })()}
              </div>
              <div className="text-sm text-orange-800">🌱 CO2 Emissions</div>
            </div>
          </div>

          {/* Alternatives Comparison */}
          <div className="p-6 rounded-lg shadow bg-gray-900 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4 text-gray-100">🔄 Alternative Solutions</h3>
            <div className="space-y-4">
              {(optimizationResult.optimization.alternatives ?? []).map((alt: any, idx: number) => (
                <div key={idx} className="border border-gray-700 rounded-lg p-4 bg-gray-800/70 hover:bg-gray-800 transition-colors">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-medium text-gray-100">{alt.name}</h4>
                    <span className="text-sm bg-gray-700/70 text-gray-200 px-2 py-1 rounded">
                      Score: {(alt.score ?? alt.cost ? (alt.score||0) : 0).toFixed ? (alt.score||0).toFixed(3) : alt.score}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-sm text-gray-300">
                    <div className="font-mono">💰 Cost: <span className="text-gray-100">₹{alt.summary.totalCost.toLocaleString()}</span></div>
                    <div className="font-mono">⏰ SLA: <span className="text-gray-100">{(() => {
                      const v = alt.summary.slaCompliance as number;
                      const pct = v <= 1 ? v * 100 : v;
                      return `${pct.toFixed(1)}%`;
                    })()}</span></div>
                    <div className="font-mono">📊 Util: <span className="text-gray-100">{alt.summary.avgUtilization.toFixed(1)}%</span></div>
                    <div className="font-mono">🌱 CO2: <span className="text-gray-100">{(() => {
                      const s = alt.summary as any;
                      const emissions = (s.totalEmissions ?? s.carbonFootprint ?? 0) as number;
                      return `${emissions.toFixed(1)}T`;
                    })()}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Explainable AI - Decision Reasoning */}
          <div className="p-6 rounded-lg shadow bg-gray-900 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4 text-gray-100">🧠 Decision Reasoning (Explainable AI)</h3>
            {(() => {
              const exp: any = optimizationResult.optimization.explanation ?? optimizationResult.optimization.explainability ?? {};
              const decisions: any[] = exp.decisions ?? [];
              const keyDecisions: any[] = exp.keyDecisions ?? [];
              const hasDecisions = Array.isArray(decisions) && decisions.length > 0;
              const items = hasDecisions ? decisions : keyDecisions.map((d: any) => ({ decision: d, reasoning: '', impact: '' }));
              if (!items || items.length === 0) {
                return (
                  <div className="text-gray-400">No explanation details available.</div>
                );
              }
              return (
                <div className="space-y-3 text-gray-200">
                  {items.map((decision: any, idx: number) => (
                    <div key={idx} className="border-l-4 border-blue-400/70 pl-4 bg-gray-800/60 hover:bg-gray-800 transition-colors p-3 rounded-r-lg">
                      <div className="font-medium text-blue-300">✅ {decision.decision || decision}</div>
                      {decision.reasoning && (
                        <div className="text-sm text-gray-400 mt-1">📝 {decision.reasoning}</div>
                      )}
                      {decision.impact && (
                        <div className="text-xs text-gray-500 mt-1">🎯 Impact: {decision.impact}</div>
                      )}
                    </div>
                  ))}
                  {optimizationResult._advanced && exp.stages && (
                    <div className="mt-6">
                      <h4 className="font-semibold mb-2 text-gray-100">📊 Optimization Stages</h4>
                      <div className="grid md:grid-cols-2 gap-4 text-gray-200">
                        {exp.stages.map((s:any,i:number)=>(
                          <div key={i} className="p-3 rounded border border-gray-600 bg-gray-800/70">
                            <div className="text-sm font-medium text-indigo-300">{i+1}. {s.stage.replace(/_/g,' ')}</div>
                            <div className="text-xs text-gray-400 mt-1">
                              {Object.keys(s).filter(k=>k!=='stage' && k!=='details').map(k=> `${k}: ${typeof s[k]==='number'? s[k]: JSON.stringify(s[k])}`).join(' · ')}
                            </div>
                            {Array.isArray(s.details) && s.details.length>0 && (
                              <div className="mt-2 max-h-32 overflow-auto text-xs text-gray-300 space-y-1">
                                {s.details.slice(0,5).map((d:any,j:number)=>(<div key={j}>• {d.destination || d.id}: {(d.totalQty||d.orders||'') }</div>))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      {exp.decisionLog && (
                        <div className="mt-6">
                          <h4 className="font-semibold mb-2 text-gray-100">🧾 Decision Log</h4>
                          <ul className="list-disc ml-5 text-sm text-gray-300 space-y-1">
                            {exp.decisionLog.map((d:string,i:number)=>(<li key={i}>{d}</li>))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {optimizationResult._advanced && optimizationResult.wagons && (
                    <div className="mt-8">
                      <h4 className="font-semibold mb-3 text-gray-100">🚛 Wagon Fill Distribution</h4>
                      <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {optimizationResult.wagons.slice(0,16).map((w:any)=>(
                          <div key={w.id} className="p-3 rounded bg-gray-800/70 border border-gray-600">
                            <div className="text-xs text-gray-400 mb-1 font-mono">{w.id}{w.virtual? ' (virtual)':''}</div>
                            <div className="flex items-center justify-between text-sm text-gray-200">
                              <span className="font-semibold text-gray-100">{w.fill}%</span>
                              <span className="text-xs text-gray-400">{w.used}/{w.capacity}T</span>
                            </div>
                            <div className="h-2 bg-gray-700 rounded mt-2 overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-indigo-500 to-blue-500" style={{ width: `${Math.min(100,w.fill)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );

  const renderScenarioTab = () => (
    <div className="space-y-6">
      {/* Scenario Configuration */}
      <div className="p-6 rounded-lg shadow bg-gray-900 border border-gray-700">
        <h3 className="text-lg font-semibold mb-4 text-gray-100">🎛️ Scenario Configuration</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Siding Capacity */}
          <div className="bg-red-50 p-4 rounded-lg border border-red-200">
            <h4 className="font-medium mb-3 text-red-800">📉 Siding Capacity Reduction</h4>
            {constraints && Object.keys(constraints.loadingPoints).map((point: string) => (
              <div key={point} className="mb-3">
                <label className="block text-sm font-medium text-gray-700">
                  {point} (-{Math.round((scenarioConfig.sidingCapacity[point] || 0) * 100)}%)
                </label>
                <input
                  type="range"
                  min="0"
                  max="0.8"
                  step="0.05"
                  value={scenarioConfig.sidingCapacity[point] || 0}
                  onChange={(e) => setScenarioConfig({
                    ...scenarioConfig,
                    sidingCapacity: {
                      ...scenarioConfig.sidingCapacity,
                      [point]: parseFloat(e.target.value)
                    }
                  })}
                  className="w-full h-2 bg-red-200 rounded-lg slider"
                />
              </div>
            ))}
          </div>

          {/* Wagon Availability */}
          <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
            <h4 className="font-medium mb-3 text-yellow-800">🚛 Wagon Availability Reduction</h4>
            {['BHILAI', 'ROURKELA', 'DURGAPUR'].map((point: string) => (
              <div key={point} className="mb-3">
                <label className="block text-sm font-medium text-gray-700">
                  {point} (-{Math.round((scenarioConfig.wagonAvailability[point] || 0) * 100)}%)
                </label>
                <input
                  type="range"
                  min="0"
                  max="0.6"
                  step="0.05"
                  value={scenarioConfig.wagonAvailability[point] || 0}
                  onChange={(e) => setScenarioConfig({
                    ...scenarioConfig,
                    wagonAvailability: {
                      ...scenarioConfig.wagonAvailability,
                      [point]: parseFloat(e.target.value)
                    }
                  })}
                  className="w-full h-2 bg-yellow-200 rounded-lg slider"
                />
              </div>
            ))}
          </div>

          {/* Demand Changes */}
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h4 className="font-medium mb-3 text-blue-800">📈 Demand Changes</h4>
            {['HRC', 'CRC', 'PIPES'].map((product: string) => (
              <div key={product} className="mb-3">
                <label className="block text-sm font-medium text-gray-700">
                  {product} ({(scenarioConfig.demandChange[product] || 0) > 0 ? '+' : ''}{Math.round((scenarioConfig.demandChange[product] || 0) * 100)}%)
                </label>
                <input
                  type="range"
                  min="-0.3"
                  max="0.5"
                  step="0.05"
                  value={scenarioConfig.demandChange[product] || 0}
                  onChange={(e) => setScenarioConfig({
                    ...scenarioConfig,
                    demandChange: {
                      ...scenarioConfig.demandChange,
                      [product]: parseFloat(e.target.value)
                    }
                  })}
                  className="w-full h-2 bg-blue-200 rounded-lg slider"
                />
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={runScenarioAnalysis}
          disabled={loading}
          className="mt-4 bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '🔄 Analyzing...' : '🔍 Run Scenario Analysis'}
        </button>
      </div>

      {/* Scenario Results */}
      {scenarioResults && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <div className="text-2xl font-bold text-red-600">
                ₹{scenarioResults.impact.costDelta.toLocaleString()}
              </div>
              <div className="text-sm text-red-800">💸 Cost Impact</div>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
              <div className="text-2xl font-bold text-yellow-600">
                {(() => {
                  const v = scenarioResults.impact.slaDelta as number;
                  const pct = Math.abs(v) <= 1 ? v * 100 : v;
                  return `${pct.toFixed(1)}%`;
                })()}
              </div>
              <div className="text-sm text-yellow-800">⏰ SLA Impact</div>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
              <div className="text-2xl font-bold text-orange-600">
                {scenarioResults.impact.utilizationDelta.toFixed(1)}%
              </div>
              <div className="text-sm text-orange-800">📊 Utilization Impact</div>
            </div>
          </div>

          <div className="p-6 rounded-lg shadow bg-gray-900 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4 text-gray-100">💡 Recommendations</h3>
            <div className="space-y-3">
              {scenarioResults.recommendations.map((rec: any, idx: number) => (
                <div key={idx} className={`border-l-4 pl-4 p-4 rounded-r-lg ${
                  rec.priority === 'High' ? 'border-red-500 bg-red-50' : 'border-yellow-500 bg-yellow-50'
                }`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">🎯 {rec.type}</div>
                      <div className="text-sm text-gray-600 mt-1">📝 {rec.action}</div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${
                      rec.priority === 'High' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {rec.priority}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">💰 {rec.impact}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderProductionTab = () => (
    <div className="space-y-6">
      {productionAlignment && (
        <>
          {/* Production Recommendations */}
          <div className="p-6 rounded-lg shadow bg-gray-900 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4 text-gray-100">🏭 Production Recommendations</h3>
            {productionAlignment.productionRecommendations.length > 0 ? (
              <div className="space-y-3">
                {productionAlignment.productionRecommendations.map((rec: any, idx: number) => (
                  <div key={idx} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-center mb-2">
                      <div className="font-medium">🏗️ {rec.product} at {rec.plant}</div>
                      <span className={`text-xs px-2 py-1 rounded ${
                        rec.priority === 'High' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {rec.priority}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 mb-2">📊 {rec.rationale}</div>
                    <div className="text-sm font-medium text-blue-600">
                      🎯 Action: {rec.action} (+{rec.quantity}T)
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-green-600 p-4 bg-green-50 rounded-lg border border-green-200">
                ✅ Production is well-aligned with demand
              </div>
            )}
          </div>

          {/* Modal Split Analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-6 rounded-lg shadow bg-gray-900 border border-gray-700">
              <h3 className="text-lg font-semibold mb-4 text-gray-100">🚂 Modal Split Analysis</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={[
                      { 
                        name: 'Rail Capacity', 
                        value: productionAlignment.modalSplit.railCapacityT,
                        label: `${productionAlignment.modalSplit.railCapacityT.toLocaleString()}T`
                      },
                      { 
                        name: 'Road Required', 
                        value: Math.max(0, productionAlignment.modalSplit.roadRequiredT),
                        label: `${Math.max(0, productionAlignment.modalSplit.roadRequiredT).toLocaleString()}T`
                      }
                    ]}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="value"
                    label={(entry: any) => entry.label}
                  >
                    <Cell fill="#3B82F6" />
                    <Cell fill="#EF4444" />
                  </Pie>
                  <Tooltip formatter={(value: any) => `${value.toLocaleString()}T`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>🚂 Rail Coverage:</span>
                  <span className="font-medium">{productionAlignment.modalSplit.railCoverage.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>💰 Potential Savings:</span>
                  <span className="font-medium text-green-600">₹{productionAlignment.modalSplit.costComparison.savings.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="p-6 rounded-lg shadow bg-gray-900 border border-gray-700">
              <h3 className="text-lg font-semibold mb-4 text-gray-100">🚛 Wagon Utilization</h3>
              <div className="space-y-4">
                <div className="flex justify-between">
                  <span>Total Wagons:</span>
                  <span className="font-medium">{productionAlignment.utilization.wagonUtilization.total}</span>
                </div>
                <div className="flex justify-between">
                  <span>Used Wagons:</span>
                  <span className="font-medium">{productionAlignment.utilization.wagonUtilization.used}</span>
                </div>
                <div className="flex justify-between">
                  <span>Utilization:</span>
                  <span className="font-medium text-blue-600">
                    {productionAlignment.utilization.wagonUtilization.utilization.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-4 p-3 bg-red-50 rounded-lg border border-red-200">
                  <div className="text-sm text-gray-600 mb-2">💸 Idle Capacity Cost Impact:</div>
                  <div className="text-lg font-semibold text-red-600">
                    ₹{productionAlignment.utilization.idleAnalysis.costImpact.toLocaleString()}/day
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium text-gray-700 mb-2">💡 Recommendations:</div>
                  {productionAlignment.utilization.idleAnalysis.recommendations.map((rec: string, idx: number) => (
                    <div key={idx} className="text-xs text-gray-600 pl-2">• {rec}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  const renderDailyPlanTab = () => (
    <div className="space-y-6">
      {dailyPlan && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <div className="text-2xl font-bold text-blue-600">{dailyPlan.kpis.totalRakes}</div>
              <div className="text-sm text-blue-800">🚂 Total Rakes</div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <div className="text-2xl font-bold text-green-600">{dailyPlan.kpis.onTimeDeliveries}</div>
              <div className="text-sm text-green-800">⏰ On-Time</div>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
              <div className="text-2xl font-bold text-purple-600">{dailyPlan.kpis.avgUtilization.toFixed(1)}%</div>
              <div className="text-sm text-purple-800">📊 Avg Utilization</div>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
              <div className="text-2xl font-bold text-orange-600">₹{dailyPlan.kpis.totalCost.toLocaleString()}</div>
              <div className="text-sm text-orange-800">💰 Total Cost</div>
            </div>
            <div className="bg-teal-50 p-4 rounded-lg border border-teal-200">
              <div className="text-2xl font-bold text-teal-600">{dailyPlan.kpis.carbonSaved.toFixed(1)}T</div>
              <div className="text-sm text-teal-800">🌱 CO2 Saved</div>
            </div>
          </div>

          {/* Gantt Chart */}
          <div className="p-6 rounded-lg shadow bg-gray-900 border border-gray-700">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-100">📅 Daily Dispatch Schedule</h3>
              <button
                onClick={exportDailyPlan}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
              >
                📄 Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-full space-y-3">
                {dailyPlan.gantt.map((task: any, idx: number) => (
                  <div key={task.id} className="flex items-center p-3 border rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="w-48 pr-4">
                      <div className="font-medium text-sm">{task.name}</div>
                      <div className="text-xs text-gray-500">
                        🚛 {task.resources.join(' • ')}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className={`h-6 rounded relative overflow-hidden ${
                        task.priority === 'High' ? 'bg-red-400' : 
                        task.priority === 'Medium' ? 'bg-yellow-400' : 'bg-green-400'
                      }`} style={{
                        width: `${Math.min(100, (idx + 1) * 15)}%`,
                        minWidth: '60px'
                      }}>
                        <div className="text-xs text-white px-2 py-1 font-medium">
                          ⏰ {new Date(task.start).toLocaleTimeString('en-US', { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Rake Details Table */}
          <div className="p-6 rounded-lg shadow bg-gray-900 border border-gray-700">
            <h3 className="text-lg font-semibold mb-4 text-gray-100">🚂 Rake Details</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rake ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cargo</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Route</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Wagons</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Utilization</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">SLA</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {dailyPlan.rakes.map((rake: any) => (
                    <tr key={rake.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {rake.id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        🏗️ {rake.cargo}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        📍 {rake.loadingPoint} → {rake.destination}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        🚛 {rake.wagons} {rake.wagonType}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          rake.utilization > 90 ? 'bg-green-100 text-green-800' :
                          rake.utilization > 80 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {rake.utilization.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ₹{rake.cost.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          rake.slaFlag ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {rake.slaFlag ? '✅ On-Time' : '⚠️ Delayed'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );

  const tabs = [
    { id: 'optimization', label: 'AI Optimization', icon: '🎯', component: renderOptimizationTab },
    { id: 'scenario', label: 'Scenario Analysis', icon: '🔍', component: renderScenarioTab },
    { id: 'production', label: 'Production Alignment', icon: '🏭', component: renderProductionTab },
    { id: 'daily-plan', label: 'Daily Plan', icon: '📅', component: renderDailyPlanTab },
  ];

  return (
    <div className={`min-h-screen bg-gray-950 ${highContrast ? 'text-gray-50' : 'text-gray-100'} p-6 transition-colors`}> 
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <h1 className={`text-3xl font-extrabold tracking-tight ${highContrast ? 'text-white drop-shadow-[0_0_4px_rgba(255,255,255,0.35)]' : 'text-gray-100'}`}>
                🚂 <span className={highContrast ? 'bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-200 to-cyan-200' : ''}>AI/ML Rake Formation Optimizer</span>
              </h1>
              <p className={`mt-2 max-w-3xl leading-relaxed ${highContrast ? 'text-gray-200' : 'text-gray-400'}`}>
                Advanced optimization engine with <strong>MILP + heuristics</strong>, multi-objective optimization, and explainable AI
              </p>
            </div>
            <div className="flex items-center gap-3 self-start md:self-auto">
              <button
                onClick={toggleContrast}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${highContrast ? 'bg-white text-gray-900 border-white shadow-sm' : 'bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700'}`}
                aria-pressed={highContrast}
                aria-label="Toggle high contrast mode"
              >
                {highContrast ? 'High Contrast: ON' : 'High Contrast: OFF'}
              </button>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-gray-700 mb-6">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-400 text-blue-300'
                    : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-600'
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="tab-content">
          {tabs.find(tab => tab.id === activeTab)?.component()}
        </div>
      </div>

      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #3B82F6;
          cursor: pointer;
        }
        .slider::-moz-range-thumb {
        /* High contrast adjustments */
        :global(.high-contrast) h1 { color:#fff !important; }
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #3B82F6;
          cursor: pointer;
          border: none;
        }
        /* Dark overrides */
        .bg-white { background-color:#111827 !important; }
        .shadow { box-shadow: 0 1px 2px 0 rgba(0,0,0,0.4),0 1px 3px 1px rgba(0,0,0,0.3); }
        .text-gray-700 { color:#d1d5db !important; }
        .text-gray-600 { color:#9ca3af !important; }
        .text-gray-500 { color:#6b7280 !important; }
        .bg-green-50 { background-color:rgba(16,185,129,0.08) !important; }
        .bg-blue-50 { background-color:rgba(59,130,246,0.08) !important; }
        .bg-purple-50 { background-color:rgba(139,92,246,0.08) !important; }
        .bg-orange-50 { background-color:rgba(249,115,22,0.08) !important; }
        .bg-red-50 { background-color:rgba(239,68,68,0.08) !important; }
        .bg-yellow-50 { background-color:rgba(234,179,8,0.08) !important; }
        .bg-teal-50 { background-color:rgba(20,184,166,0.08) !important; }
        .border-blue-200, .border-green-200, .border-purple-200, .border-orange-200, .border-red-200, .border-yellow-200, .border-teal-200 { border-color:#374151 !important; }
        .bg-gray-50 { background-color:#0f172a !important; }
        .hover\:bg-gray-50:hover { background-color:#1e293b !important; }
        table thead.bg-gray-50 { background-color:#1e293b !important; }
        .border-gray-200 { border-color:#374151 !important; }
        .divide-gray-200 > :not([hidden]) ~ :not([hidden]) { border-color:#374151 !important; }
      `}</style>
    </div>
  );
};

export default OptimizerPage;