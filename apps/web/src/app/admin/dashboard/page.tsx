export default function AdminDashboard() {
  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Global Dashboard</h1>
      <p className="opacity-80">Total orders (plant-wise & stockyard-wise), rake utilization, cost KPIs, pending deliveries, forecast demand.</p>
      {/* TODO: Wire actual KPIs/charts */}
    </main>
  );
}
