"use client";
import Guard from "@/components/Guard";

export default function ForecastingPage(){
  return (
    <Guard allow={['manager'] as any}>
      <main className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Demand Forecasting</h1>
        <p className="text-sm text-gray-400">Sales and shipment projections with scenario overlays (placeholder).</p>
      </main>
    </Guard>
  );
}
