import dynamic from "next/dynamic";
const MapLive = dynamic(() => import("@/components/MapLive"), { ssr: false });

export default function MapPage() {
  return (
    <main className="p-6 space-y-6">
      <h2 className="text-2xl font-semibold">Map & Route Visualization</h2>
      <div className="rounded-xl overflow-hidden border border-white/10">
        <MapLive />
      </div>
    </main>
  );
}
