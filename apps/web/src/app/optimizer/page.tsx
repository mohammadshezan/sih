'use client';

import { useState, useEffect } from 'react';
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, 
  PieChart, Pie, Cell, ResponsiveContainer, ScatterChart, Scatter
} from 'recharts';

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
    setLoading(true);
    try {
      const data = await apiCall('/optimizer/rake-formation', {
        method: 'POST',
        body: JSON.stringify({ weights })
      });
      setOptimizationResult(data);
    } catch (error) {
      console.error('Optimization failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const runScenarioAnalysis = async () => {
    setLoading(true);
    try {
      const data = await apiCall('/optimizer/scenario-analysis', {
        method: 'POST',
        body: JSON.stringify({
          scenario: 'Custom Analysis',
          disruptions: scenarioConfig
        })
      });
      setScenarioResults(data);
    } catch (error) {
      console.error('Scenario analysis failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportDailyPlan = () => {
    const token = localStorage.getItem('token');
    window.open(`${API_BASE}/optimizer/export/daily-plan.csv?token=${token}`, '_blank');
  };

  const renderOptimizationTab = () => (
    <div className="space-y-6">
      {/* Multi-Objective Weight Controls */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4">🎯 Optimization Weights</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(weights).map(([key, value]) => (
            <div key={key} className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 capitalize">
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
          className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '🔄 Optimizing...' : '🚀 Run Optimization'}
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
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">🔄 Alternative Solutions</h3>
            <div className="space-y-4">
              {(optimizationResult.optimization.alternatives ?? []).map((alt: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-medium">{alt.name}</h4>
                    <span className="text-sm bg-gray-100 px-2 py-1 rounded">
                      Score: {alt.score.toFixed(3)}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>💰 Cost: ₹{alt.summary.totalCost.toLocaleString()}</div>
                    <div>⏰ SLA: {(() => {
                      const v = alt.summary.slaCompliance as number;
                      const pct = v <= 1 ? v * 100 : v;
                      return `${pct.toFixed(1)}%`;
                    })()}</div>
                    <div>📊 Util: {alt.summary.avgUtilization.toFixed(1)}%</div>
                    <div>🌱 CO2: {(() => {
                      const s = alt.summary as any;
                      const emissions = (s.totalEmissions ?? s.carbonFootprint ?? 0) as number;
                      return `${emissions.toFixed(1)}T`;
                    })()}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Explainable AI - Decision Reasoning */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">🧠 Decision Reasoning (Explainable AI)</h3>
            {(() => {
              const exp: any = optimizationResult.optimization.explanation ?? optimizationResult.optimization.explainability ?? {};
              const decisions: any[] = exp.decisions ?? [];
              const keyDecisions: any[] = exp.keyDecisions ?? [];
              const hasDecisions = Array.isArray(decisions) && decisions.length > 0;
              const items = hasDecisions ? decisions : keyDecisions.map((d: any) => ({ decision: d, reasoning: '', impact: '' }));
              if (!items || items.length === 0) {
                return (
                  <div className="text-gray-600">No explanation details available.</div>
                );
              }
              return (
                <div className="space-y-3">
                  {items.map((decision: any, idx: number) => (
                    <div key={idx} className="border-l-4 border-blue-500 pl-4 hover:bg-blue-50 transition-colors p-3 rounded-r-lg">
                      <div className="font-medium text-blue-900">✅ {decision.decision || decision}</div>
                      {decision.reasoning && (
                        <div className="text-sm text-gray-600 mt-1">📝 {decision.reasoning}</div>
                      )}
                      {decision.impact && (
                        <div className="text-xs text-gray-500 mt-1">🎯 Impact: {decision.impact}</div>
                      )}
                    </div>
                  ))}
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
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4">🎛️ Scenario Configuration</h3>
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

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">💡 Recommendations</h3>
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
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">🏭 Production Recommendations</h3>
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
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-lg font-semibold mb-4">🚂 Modal Split Analysis</h3>
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

            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-lg font-semibold mb-4">🚛 Wagon Utilization</h3>
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
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">📅 Daily Dispatch Schedule</h3>
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
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">🚂 Rake Details</h3>
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
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            🚂 AI/ML Rake Formation Optimizer
          </h1>
          <p className="text-gray-600 mt-2">
            Advanced optimization engine with <strong>MILP + heuristics</strong>, multi-objective optimization, and explainable AI
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #3B82F6;
          cursor: pointer;
          border: none;
        }
      `}</style>
    </div>
  );
};

export default OptimizerPage;