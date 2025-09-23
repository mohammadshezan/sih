"use client";
import Guard from "@/components/Guard";

export default function YardOfflineModePage(){
  return (
    <Guard allow={['yard'] as any}>
      <main className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Offline Mode</h1>
        <p className="text-sm text-gray-400">Work offline; sync later (placeholder).</p>
      </main>
    </Guard>
  );
}
