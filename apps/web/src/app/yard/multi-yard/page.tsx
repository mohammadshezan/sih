"use client";
import Guard from "@/components/Guard";

export default function MultiYardPage(){
  return (
    <Guard allow={['yard'] as any}>
      <main className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Multi-Yard Overview</h1>
        <p className="text-sm text-gray-400">Aggregate view of multiple yards (placeholder).</p>
      </main>
    </Guard>
  );
}
