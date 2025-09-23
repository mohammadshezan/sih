"use client";
import Guard from "@/components/Guard";

export default function CustomerAccounts() {
  return (
    <Guard allow={['customer'] as any}>
      <div className="max-w-4xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Multi-User Accounts</h1>
        <div className="text-sm text-gray-400">Manage multiple logins under the same GSTIN (demo placeholder).</div>
      </div>
    </Guard>
  );
}
