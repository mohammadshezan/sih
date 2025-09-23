"use client";
import Guard from "@/components/Guard";

export default function CustomerNotifications() {
  return (
    <Guard allow={['customer'] as any}>
      <div className="max-w-3xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <div className="text-sm text-gray-400">Real-time updates will appear here. For now, watch status changes on your orders.</div>
      </div>
    </Guard>
  );
}
