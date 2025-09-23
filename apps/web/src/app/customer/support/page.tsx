"use client";
import Guard from "@/components/Guard";

export default function CustomerSupport() {
  return (
    <Guard allow={['customer'] as any}>
      <div className="max-w-3xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Support / Helpdesk</h1>
        <div className="text-sm text-gray-400">Raise tickets and chat with support (demo placeholder).</div>
      </div>
    </Guard>
  );
}
