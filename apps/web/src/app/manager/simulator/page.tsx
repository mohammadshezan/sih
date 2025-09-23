"use client";
import Guard from "@/components/Guard";

export default function SimulatorPage(){
  return (
    <Guard allow={['manager'] as any}>
      <main className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Operations Simulator</h1>
        <p className="text-sm text-gray-400">What-if simulator for rake allocation and ETAs (placeholder).</p>
      </main>
    </Guard>
  );
}
