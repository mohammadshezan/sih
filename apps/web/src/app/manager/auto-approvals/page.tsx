"use client";
import Guard from "@/components/Guard";

export default function AutoApprovalsPage(){
  return (
    <Guard allow={['manager'] as any}>
      <main className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Auto-Approvals</h1>
        <p className="text-sm text-gray-400">Rules for automatic order approvals (placeholder).</p>
      </main>
    </Guard>
  );
}
