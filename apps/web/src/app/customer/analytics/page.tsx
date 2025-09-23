"use client";
import Guard from "@/components/Guard";

export default function CustomerAnalytics() {
  return (
    <Guard allow={['customer'] as any}>
      <div className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Order History Analytics</h1>
        <div className="text-sm text-gray-400">Trends, average delivery time, spend reports (demo placeholder).</div>
      </div>
    </Guard>
  );
}
