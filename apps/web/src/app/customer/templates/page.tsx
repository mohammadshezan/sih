"use client";
import Guard from "@/components/Guard";

export default function SavedTemplates() {
  return (
    <Guard allow={['customer'] as any}>
      <div className="max-w-4xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Saved Templates</h1>
        <div className="text-sm text-gray-400">Quick re-order using pre-filled forms (demo placeholder).</div>
      </div>
    </Guard>
  );
}
