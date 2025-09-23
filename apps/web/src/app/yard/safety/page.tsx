"use client";
import Guard from "@/components/Guard";

export default function YardSafetyPage(){
  return (
    <Guard allow={['yard'] as any}>
      <main className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Yard Safety</h1>
        <p className="text-sm text-gray-400">Safety checklists, incidents, compliance (demo placeholder).</p>
      </main>
    </Guard>
  );
}
