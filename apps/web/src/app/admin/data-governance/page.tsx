"use client";
import Guard from "@/components/Guard";

export default function DataGovernance() {
  return (
    <Guard allow={['admin'] as any}>
      <div className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Data Governance</h1>
        <div className="text-sm text-gray-400">Retention, privacy policies, and data export (demo placeholder).</div>
      </div>
    </Guard>
  );
}
