export default function CustomerOrderTracking() {
  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Order Tracking</h1>
      <ul className="list-disc pl-5 opacity-90 text-sm">
        <li>Orders placed (product type, quantity)</li>
        <li>Expected delivery date</li>
        <li>Current rake location (via API)</li>
        <li>Invoice & payment details</li>
      </ul>
      {/* TODO: Integrate with /customer/orders and /map endpoints */}
    </main>
  );
}
