"use client";
import Guard from "@/components/Guard";

export default function CustomerInvoices() {
  return (
    <Guard allow={['customer'] as any}>
      <div className="max-w-3xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Invoices & Payments</h1>
        <div className="text-sm text-gray-400">Coming soon. You can download an invoice from any order detail page for now.</div>
      </div>
    </Guard>
  );
}
