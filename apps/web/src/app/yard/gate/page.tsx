"use client";
import Guard from "@/components/Guard";

export default function YardGatePage(){
  return (
    <Guard allow={['yard'] as any}>
      <main className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Gate Management</h1>
        <p className="text-sm text-gray-400">In/Out logs and vehicle flows (placeholder).</p>
      </main>
    </Guard>
  );
}
