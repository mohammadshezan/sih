'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
// lightweight icon replacements (no external deps)
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Label } from './ui/label';
import { Slider } from './ui/slider';
import { useRouter } from 'next/navigation';
import { withBase } from '@/lib/config';

interface AssistantMessage {
  id: string;
  text: string;
  type: 'user' | 'assistant';
  timestamp: Date;
  data?: any;
  responseType?: string;
  actions?: Array<{
    id: string;
    label: string;
    type: 'action' | 'navigate' | 'export' | 'dialog';
    url?: string;
  }>;
}

interface ActionDialogProps {
  action: any;
  isOpen: boolean;
  onClose: () => void;
  onExecute: (params: any) => void;
}

function ActionDialog({ action, isOpen, onClose, onExecute }: ActionDialogProps) {
  const [weights, setWeights] = useState({ cost: 30, sla: 40, utilization: 20, emissions: 10 });
  const [rakeParams, setRakeParams] = useState({ cargo: 'TMT Bars', destination: 'Bhilai', tonnage: 3000 });

  const handleExecute = () => {
    if (action.id === 'reoptimize') {
      onExecute({ weights: weights });
    } else if (action.id === 'modify_rake') {
      onExecute({ rakeParams });
    }
    onClose();
  };

  if (action.id === 'reoptimize') {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>🔄 Re-optimize with Custom Weights</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Cost Priority: {weights.cost}%</Label>
              <Slider
                value={[weights.cost]}
                onValueChange={(vals: number[]) => setWeights(prev => ({ ...prev, cost: vals[0] }))}
                max={100}
                step={5}
                className="w-full"
              />
            </div>
            <div>
              <Label>SLA Priority: {weights.sla}%</Label>
              <Slider
                value={[weights.sla]}
                onValueChange={(vals: number[]) => setWeights(prev => ({ ...prev, sla: vals[0] }))}
                max={100}
                step={5}
                className="w-full"
              />
            </div>
            <div>
              <Label>Utilization: {weights.utilization}%</Label>
              <Slider
                value={[weights.utilization]}
                onValueChange={(vals: number[]) => setWeights(prev => ({ ...prev, utilization: vals[0] }))}
                max={100}
                step={5}
                className="w-full"
              />
            </div>
            <div>
              <Label>Emissions: {weights.emissions}%</Label>
              <Slider
                value={[weights.emissions]}
                onValueChange={(vals: number[]) => setWeights(prev => ({ ...prev, emissions: vals[0] }))}
                max={100}
                step={5}
                className="w-full"
              />
            </div>
            <Button onClick={handleExecute} className="w-full">
              🚀 Run Optimization
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}

function MessageContent({ message, onAction }: { message: AssistantMessage; onAction: (action: any, payload?: any) => void }) {
  const router = useRouter();
  const [dialogAction, setDialogAction] = useState<any>(null);

  if (message.type === 'user') {
    return <div className="text-gray-800">{message.text}</div>;
  }

  const handleAction = (action: any) => {
    switch (action.type) {
      case 'navigate':
        if (action.url) router.push(action.url);
        break;
      case 'export':
        // Trigger CSV export
        const csvData = generateCSV(message.data);
        downloadCSV(csvData, 'optimization_plan.csv');
        break;
      case 'dialog':
        setDialogAction(action);
        break;
      case 'action':
        // Execute inline action via parent
        onAction(action, message.data);
        break;
    }
  };

  const renderDataVisualization = () => {
    if (!message.data) return null;

    switch (message.responseType) {
      case 'optimization':
        return (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 p-3 rounded-lg">
                <div className="text-sm text-blue-600 font-medium">Total Rakes</div>
                <div className="text-xl font-bold text-blue-900">{message.data.plan?.rakes?.length || 0}</div>
              </div>
              <div className="bg-green-50 p-3 rounded-lg">
                <div className="text-sm text-green-600 font-medium">Cost Savings</div>
                <div className="text-xl font-bold text-green-900">₹{(message.data.kpis?.totalCost || 0).toLocaleString()}</div>
              </div>
            </div>
            {message.data.alternatives && (
              <div className="bg-gray-50 p-3 rounded-lg">
                <div className="text-sm font-medium mb-2">Alternative Plans Available</div>
                <div className="flex gap-2">
                  {message.data.alternatives.map((alt: any, idx: number) => (
                    <Button key={idx} variant="outline" size="sm" className="text-xs">
                      Plan {idx + 1} (₹{alt.summary?.totalCost?.toLocaleString()})
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case 'scenario':
        return (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className={`p-2 rounded text-center ${message.data.impact?.costDelta > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                <div className="text-xs font-medium">Cost Impact</div>
                <div className="font-bold">{message.data.impact?.costDelta > 0 ? '+' : ''}₹{Math.abs(message.data.impact?.costDelta || 0).toLocaleString()}</div>
              </div>
              <div className={`p-2 rounded text-center ${message.data.impact?.slaDelta < 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                <div className="text-xs font-medium">SLA Change</div>
                <div className="font-bold">{message.data.impact?.slaDelta > 0 ? '+' : ''}{message.data.impact?.slaDelta?.toFixed(1)}%</div>
              </div>
              <div className={`p-2 rounded text-center ${message.data.impact?.utilizationDelta < 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                <div className="text-xs font-medium">Utilization</div>
                <div className="font-bold">{message.data.impact?.utilizationDelta > 0 ? '+' : ''}{message.data.impact?.utilizationDelta?.toFixed(1)}%</div>
              </div>
            </div>
          </div>
        );

      case 'proactive_alert':
        return (
          <div className="mt-4 space-y-2">
            {message.data.alerts?.map((alert: any, idx: number) => (
              <div key={idx} className={`p-3 rounded-lg border-l-4 ${
                alert.severity === 'high' ? 'border-red-500 bg-red-50' :
                alert.severity === 'medium' ? 'border-yellow-500 bg-yellow-50' :
                'border-blue-500 bg-blue-50'
              }`}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{alert.severity === 'high' ? '⚠️' : alert.severity === 'medium' ? '📈' : '✅'}</span>
                  <span className="text-sm font-medium">{alert.message}</span>
                </div>
              </div>
            ))}
          </div>
        );

      case 'performance':
        return (
          <div className="mt-4">
            <div className="space-y-3">
              {Object.entries(message.data).map(([product, data]: [string, any]) => (
                <div key={product} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="font-medium capitalize">{product.replace(/([A-Z])/g, ' $1').trim()}</div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm text-gray-600">{data.rakes} rakes</div>
                    <div className={`px-2 py-1 rounded text-xs font-medium ${
                      data.utilization >= 90 ? 'bg-green-100 text-green-800' :
                      data.utilization >= 80 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {data.utilization}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <div 
        className="text-gray-800 whitespace-pre-line"
        dangerouslySetInnerHTML={{ __html: message.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }}
      />
      
      {renderDataVisualization()}
      
      {message.actions && message.actions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
          {message.actions.map((action) => (
            <Button
              key={action.id}
              onClick={() => handleAction(action)}
              variant={action.type === 'action' ? 'default' : 'outline'}
              size="sm"
              className="text-xs"
            >
              <span className="mr-1">{action.type === 'export' ? '⬇️' : action.type === 'navigate' ? '🔗' : action.type === 'dialog' ? '⚙️' : '🔄'}</span>
              {action.label}
            </Button>
          ))}
        </div>
      )}

      {dialogAction && (
        <ActionDialog
          action={dialogAction}
          isOpen={!!dialogAction}
          onClose={() => setDialogAction(null)}
          onExecute={(params) => {
            onAction(dialogAction, params);
          }}
        />
      )}
    </div>
  );
}

function generateCSV(data: any): string {
  if (!data?.plan?.rakes) return 'No data available';
  
  const headers = ['Rake ID', 'Product', 'Origin', 'Destination', 'Tonnage', 'Utilization', 'Cost'];
  const rows = data.plan.rakes.map((rake: any) => [
    rake.id || '',
    rake.product || '',
    rake.origin || '',
    rake.destination || '',
    rake.tonnage || 0,
    `${(rake.utilization || 0).toFixed(1)}%`,
    `₹${(rake.cost || 0).toLocaleString()}`
  ]);
  
  return [headers, ...rows].map(row => row.join(',')).join('\n');
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export default function Assistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: '1',
      text: '🤖 **AI Decision Co-Pilot Ready**\n\nI can help you with:\n• **"Optimize today\'s plan with cost priority"** - Run optimization\n• **"What if 2 loading points at Bokaro are offline?"** - Scenario analysis\n• **"Show current rake utilization for H-beams"** - Performance insights\n• **"Create rake for 3000 tons TMT bars to Bhilai"** - Operations\n• **"Which stockyard has lowest carbon footprint?"** - Sustainability\n\nTry asking me anything about optimization, logistics, or operations!',
      type: 'assistant',
      timestamp: new Date(),
      responseType: 'welcome',
      actions: [
        { id: 'run_optimization', label: '🚀 Run Optimization', type: 'navigate', url: '/optimizer' },
        { id: 'view_dashboard', label: '📊 View Dashboard', type: 'navigate', url: '/dashboard' }
      ]
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: AssistantMessage = {
      id: Date.now().toString(),
      text: input.trim(),
      type: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (!token) {
        // If not authenticated, nudge user to sign in
        setMessages(prev => [...prev, { id: (Date.now() + 2).toString(), text: '🔒 Please sign in to use the AI Co-Pilot.', type: 'assistant', timestamp: new Date() }]);
        setLoading(false);
        return;
      }

      const response = await fetch(withBase('/assistant'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ query: userMessage.text })
      });

      if (response.status === 401) {
        setMessages(prev => [...prev, { id: (Date.now() + 3).toString(), text: '🔑 Session expired. Redirecting to sign-in…', type: 'assistant', timestamp: new Date() }]);
        window.location.href = '/signin';
        return;
      }

      const data = await response.json();
      
      const assistantMessage: AssistantMessage = {
        id: (Date.now() + 1).toString(),
        text: data.answer || 'Sorry, I encountered an error processing your request.',
        type: 'assistant',
        timestamp: new Date(),
        data: data.data,
        responseType: data.type,
        actions: data.actions || []
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: AssistantMessage = {
        id: (Date.now() + 1).toString(),
        text: '❌ Connection error. Please check if the API server is running and try again.',
        type: 'assistant',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    }

    setLoading(false);
  };

  // Handle action buttons like Apply & Optimize, Apply Scenario, etc.
  const runAction = async (action: any, payload?: any) => {
    if (loading) return;
    try {
      setLoading(true);
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      if (!token) {
        setMessages(prev => [...prev, { id: (Date.now() + 4).toString(), text: '🔒 Please sign in to perform this action.', type: 'assistant', timestamp: new Date() }]);
        setLoading(false);
        return;
      }

      // Determine API call by action id
      if (action.id === 'apply_weights' || action.id === 'reoptimize') {
        // Handle either percent-based or normalized 0..1 weights
        let wInput = payload?.weights || payload || { cost: 0.3, sla: 0.4, utilization: 0.2, emissions: 0.1 };
        // If values look like percentages (>1), convert; otherwise use as-is
        const values = [wInput.cost, wInput.sla, wInput.utilization, wInput.emissions];
        const isPercent = values.some((v: number) => v > 1);
        let w: any;
        if (isPercent) {
          const sum = values.reduce((a: number, b: number) => a + b, 0) || 100;
          w = {
            cost: (wInput.cost / sum),
            sla: (wInput.sla / sum),
            utilization: (wInput.utilization / sum),
            emissions: (wInput.emissions / sum)
          };
        } else {
          // Already normalized; ensure sums to 1
          const sum = values.reduce((a: number, b: number) => a + b, 0) || 1;
          w = {
            cost: wInput.cost / sum,
            sla: wInput.sla / sum,
            utilization: wInput.utilization / sum,
            emissions: wInput.emissions / sum
          };
        }
        const resp = await fetch(withBase('/optimizer/rake-formation'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ weights: w })
        });
        const data = await resp.json();
        const plan = data?.optimization?.optimal;
        const msg: AssistantMessage = {
          id: (Date.now() + 5).toString(),
          text: plan ? `✅ Optimization complete. Total rakes: ${plan.rakes?.length || 0}. Cost: ₹${plan.summary?.totalCost?.toLocaleString?.()}` : 'Optimization finished.',
          type: 'assistant',
          timestamp: new Date(),
          data: plan ? { plan, alternatives: data?.optimization?.alternatives?.slice?.(0, 3), kpis: plan.summary } : undefined,
          responseType: 'optimization',
          actions: [
            { id: 'export_csv', label: '📄 Export Daily Plan (API)', type: 'export' },
            { id: 'view_map', label: '📍 View Routes', type: 'navigate', url: '/map' }
          ]
        };
        setMessages(prev => [...prev, msg]);
      } else if (action.id === 'apply_scenario') {
        const disruptions = payload?.disruptions || payload || {};
        const resp = await fetch(withBase('/optimizer/scenario-analysis'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ scenario: 'Applied from chat', disruptions })
        });
        const data = await resp.json();
        const impact = data?.impact || {};
        const uiData = {
          baseline: data?.baseline,
          modified: data?.modified,
          impact: {
            costDelta: impact.costDelta,
            slaDelta: (impact.slaDelta ?? 0) * 100,
            utilizationDelta: impact.utilizationDelta
          },
          recommendations: data?.recommendations
        };
        const msg: AssistantMessage = {
          id: (Date.now() + 6).toString(),
          text: '🔍 Scenario applied. Here is the impact summary.',
          type: 'assistant',
          timestamp: new Date(),
          data: uiData,
          responseType: 'scenario'
        };
        setMessages(prev => [...prev, msg]);
      } else if (action.id === 'reset_weights') {
        // Reset to default and re-run
        const resp = await fetch(withBase('/optimizer/rake-formation'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ weights: { cost: 0.3, sla: 0.4, utilization: 0.2, emissions: 0.1 } })
        });
        const data = await resp.json();
        const plan = data?.optimization?.optimal;
        const msg: AssistantMessage = {
          id: (Date.now() + 8).toString(),
          text: '🔄 Weights reset to defaults. Optimization updated.',
          type: 'assistant',
          timestamp: new Date(),
          data: plan ? { plan, alternatives: data?.optimization?.alternatives?.slice?.(0, 3), kpis: plan.summary } : undefined,
          responseType: 'optimization'
        };
        setMessages(prev => [...prev, msg]);
      } else if (action.type === 'navigate') {
        // No-op here, handled in MessageContent
      } else if (action.type === 'export') {
        // Export via API: fetch CSV and force download
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        const resp = await fetch(withBase('/optimizer/export/daily-plan.csv'), {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!resp.ok) throw new Error('Export failed');
        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'daily-rake-plan.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (e) {
      setMessages(prev => [...prev, { id: (Date.now() + 7).toString(), text: '❌ Action failed. Please try again.', type: 'assistant', timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const quickActions = [
    { text: "Optimize today's plan with cost priority", icon: "🚀" },
    { text: "What if 2 loading points at Bokaro are offline?", icon: "🔍" },
    { text: "Show current rake utilization for H-beams", icon: "📊" },
    { text: "Create rake for 3000 tons TMT bars to Bhilai", icon: "🚂" },
    { text: "Which stockyard has lowest carbon footprint?", icon: "🌱" }
  ];

  return (
    <div className="fixed bottom-4 right-4">
      {open && (
        <Card className="w-[500px] h-[600px] mb-3 flex flex-col">
          <div className="p-4 border-b bg-gradient-to-r from-blue-50 to-green-50">
            <h3 className="font-bold text-gray-900">🤖 AI Decision Co-Pilot</h3>
            <p className="text-xs text-gray-600 mt-1">Your intelligent logistics assistant</p>
          </div>
          
          <CardContent className="flex-1 flex flex-col p-0">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((message) => (
                <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-3 rounded-lg text-sm ${
                    message.type === 'user' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-50 border border-gray-200'
                  }`}>
                    <MessageContent message={message} onAction={runAction} />
                    <div className="text-xs opacity-70 mt-2">
                      {message.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              
              {loading && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] p-3 rounded-lg bg-gray-50 border border-gray-200">
                    <div className="flex items-center gap-2">
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                      </div>
                      <span className="text-sm text-gray-600">AI is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {messages.length <= 1 && (
              <div className="px-4 py-3 border-t border-b bg-gray-50">
                <div className="text-xs font-medium text-gray-700 mb-2">Quick Actions:</div>
                <div className="flex flex-wrap gap-1">
                  {quickActions.slice(0, 3).map((action, idx) => (
                    <Button
                      key={idx}
                      variant="outline"
                      size="sm"
                      onClick={() => setInput(action.text)}
                      className="text-xs bg-white hover:bg-blue-50 h-8"
                    >
                      {action.icon}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            
            <div className="p-4 border-t">
              <div className="flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask me about optimization, scenarios, performance..."
                  className="flex-1 min-h-[50px] resize-none text-sm"
                  disabled={loading}
                />
                <Button 
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                  size="sm"
                  className="px-4"
                >
                  ➤
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <button 
        onClick={() => setOpen(v => !v)} 
        className="rounded-full bg-gradient-to-r from-blue-500 to-green-500 text-white px-6 py-3 shadow-lg hover:shadow-xl transition-shadow font-medium"
      >
        🤖 AI Co-Pilot
      </button>
    </div>
  );
}
