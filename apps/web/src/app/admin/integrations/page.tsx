"use client";
import Guard from "@/components/Guard";

export default function AdminIntegrations() {
  return (
    <Guard allow={['admin'] as any}>
      <div className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">System Integrations</h1>
        <div className="text-sm text-gray-400">ERP/SAP and payment gateway integration (demo placeholder).</div>
      </div>
    </Guard>
  );
}
