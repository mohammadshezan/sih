"use client";
import Guard from "@/components/Guard";

export default function Loyalty() {
  return (
    <Guard allow={['customer'] as any}>
      <div className="max-w-4xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Loyalty / Discounts</h1>
        <div className="text-sm text-gray-400">Track credits and discounts for bulk customers (demo placeholder).</div>
      </div>
    </Guard>
  );
}
