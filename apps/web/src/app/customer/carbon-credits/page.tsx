"use client";
import Guard from "@/components/Guard";

export default function CarbonCredits() {
  return (
    <Guard allow={['customer'] as any}>
      <div className="max-w-5xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Carbon Credits</h1>
        <div className="text-sm text-gray-400">Track emissions saved and rewards for eco-routes (demo placeholder).</div>
      </div>
    </Guard>
  );
}
