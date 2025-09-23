"use client";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import io from "socket.io-client";
import { withBase, SOCKET_URL } from "@/lib/config";
import { useEffect, useMemo, useRef, useState, Fragment } from "react";

const rakeIcon = L.divIcon({
  className: "rake-icon",
  html: '<div class="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/90 text-white shadow"><span style="font-size:12px">🚆</span></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

type Position = {
  id: string; lat: number; lng: number; speed: number;
  temp?: number; rfid?: string; status?: string;
  cargo?: string; source?: string; destination?: string;
  currentLocationName?: string;
  stops?: { name: string; lat: number; lng: number; signal?: 'red'|'green' }[];
};

export default function MapLive() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [prev, setPrev] = useState<Record<string, Position>>({});
  const [routes, setRoutes] = useState<any[]>([]);
  const [eco, setEco] = useState<{ bestIndex?: number } | null>(null);
  const [meta, setMeta] = useState<any | null>(null);
  const [highlightEco, setHighlightEco] = useState<boolean>(true);
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Subscribe to live socket positions
  const s = (window as any).io?.(SOCKET_URL || undefined) || (awaitSocket());
    function onPos(data: Position[]) {
      // interpolate towards new positions over 1s
      const mapPrev: Record<string, Position> = {};
      positions.forEach(p => { mapPrev[p.id] = p; });
      setPrev(mapPrev);
      const start = performance.now();
      const duration = 1000;
      const from = mapPrev;
      const to: Record<string, Position> = {};
      data.forEach(p => to[p.id] = p);
      function step(now: number) {
        const t = Math.min(1, (now - start) / duration);
        const blended: Position[] = data.map(p => {
          const a = from[p.id] || p;
          return { ...p, lat: a.lat + (p.lat - a.lat)*t, lng: a.lng + (p.lng - a.lng)*t };
        });
        setPositions(blended);
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    s.on("positions", onPos);

    // HTTP polling fallback helpers
    function startPolling(token: string) {
      if (pollerRef.current) return;
      pollerRef.current = setInterval(() => {
        fetch(withBase('/positions'), { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : Promise.reject())
          .catch(() => fetch(withBase('/positions/public')).then(r => r.ok ? r.json() : Promise.reject()))
          .then((d: Position[]) => { if (Array.isArray(d)) onPos(d); })
          .catch(() => {});
      }, 3000);
    }
    function stopPolling() {
      if (pollerRef.current) { clearInterval(pollerRef.current as any); pollerRef.current = null; }
    }
    // Fetch routes with filters and eco metadata
    const token = localStorage.getItem('token')||'';
    let role = 'guest';
    try { const p = token? JSON.parse(atob(token.split('.')[1])): null; role = p?.role || 'guest'; } catch {}
  const saved = localStorage.getItem(`routeFilters:${role}`);
  const f = saved? JSON.parse(saved): { cargo: 'ore', loco: 'diesel', grade: 0, tonnage: 3000, routeKey: 'BKSC-DGR' };
  const qs = new URLSearchParams({ cargo: f.cargo, loco: f.loco, grade: String(f.grade ?? 0), tonnage: String(f.tonnage ?? 3000), routeKey: String(f.routeKey || 'BKSC-DGR') }).toString();
  fetch(withBase(`/map/routes?${qs}`), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json())
      .then(d=>{ setRoutes(d.routes||[]); setEco(d.eco||null); setMeta(d.meta||null); })
      .catch(()=>{ setRoutes([]); setEco(null); setMeta(null); });

    // Initial positions fetch so markers appear even before socket connects
    fetch(withBase('/positions'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .catch(() => fetch(withBase('/positions/public')).then(r => r.ok ? r.json() : Promise.reject()))
      .then((d: Position[]) => { if (Array.isArray(d)) onPos(d); })
      .catch(() => {});

    // Manage polling fallback based on socket connectivity
    const onConnect = () => { stopPolling(); };
    const onDisconnect = () => { startPolling(token); };
    const onError = () => { startPolling(token); };
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onError);
    const onApply = (e:any) => {
      const det = e?.detail || {};
  const q = new URLSearchParams({ cargo: det.cargo || f.cargo, loco: det.loco || f.loco, grade: String(det.grade ?? f.grade ?? 0), tonnage: String(det.tonnage ?? f.tonnage ?? 3000), routeKey: det.routeKey || f.routeKey || 'BKSC-DGR' }).toString();
  fetch(withBase(`/map/routes?${q}`), { headers: { Authorization: `Bearer ${localStorage.getItem('token')||''}` } })
        .then(r=>r.json()).then(d=>{ setRoutes(d.routes||[]); setEco(d.eco||null); setMeta(d.meta||null); }).catch(()=>{});
    };
    window.addEventListener('routeFilters:apply', onApply as any);
    return () => { s.off("positions", onPos); s.off('connect', onConnect); s.off('disconnect', onDisconnect); s.off('connect_error', onError); stopPolling(); window.removeEventListener('routeFilters:apply', onApply as any); };
  }, []);

  const center = useMemo(() => [23.64, 86.16] as [number, number], []);

  const AnyMap = MapContainer as any;
  const AnyTile = TileLayer as any;
  const AnyMarker = Marker as any;
  const AnyPolyline = Polyline as any;
  const stationIcon = (signal: 'red'|'green'|undefined) => L.divIcon({
    className: 'station-icon',
    html: `<div class="flex items-center gap-1">
      <span style="font-size:12px">🏢</span>
      <span style="font-size:10px; ${signal==='red'?'color:#ef4444;':'color:#10b981;'}">${signal==='red'?'🔴':'🟢'}</span>
    </div>`,
    iconSize: [20, 16], iconAnchor: [10, 8]
  });

  return (
    <div className="h-[70vh]">
      <AnyMap center={center} zoom={12} scrollWheelZoom={true} className="h-full">
        <AnyTile
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {/* legacy eco-route preview */}
        {routes.map((r, i) => {
          const isEco = i === (eco?.bestIndex ?? -1);
          const color = isEco && highlightEco ? '#22C55E' : statusColor(r.status);
          const weight = isEco && highlightEco ? 7 : 5;
          return <AnyPolyline key={i} positions={r.from && r.to ? [r.from, r.to] : []} pathOptions={{ color, weight, opacity: 0.9 }} />;
        })}
        {/* draw per-rake routes with stations */}
        {positions.map(p => (
          <Fragment key={`rk-${p.id}`}>
            {p.stops && p.stops.length > 1 && (
              <AnyPolyline key={`route-${p.id}`} positions={p.stops.map(s => [s.lat, s.lng])} pathOptions={{ color: '#3B82F6', weight: 3, opacity: 0.8 }} />
            )}
            {p.stops?.map((s, idx) => (
              <AnyMarker key={`st-${p.id}-${idx}`} position={[s.lat, s.lng]} icon={stationIcon((s.signal||'green') as any)}>
                <Popup>
                  <div className="text-sm">
                    <div className="font-medium">{s.name}</div>
                    <div>Signal: {s.signal==='red' ? '🔴 Red' : '🟢 Green'}</div>
                  </div>
                </Popup>
              </AnyMarker>
            ))}
          </Fragment>
        ))}
        {positions.map(p => (
          <AnyMarker key={p.id} position={[p.lat, p.lng]} icon={rakeIcon}>
            <Popup>
              <div className="text-sm min-w-[220px]">
                <div className="font-semibold flex items-center gap-2 mb-1">
                  <span role="img" aria-label="train">🚆</span>
                  <span>Rake: {p.id.replace('RK','')}</span>
                </div>
                {p.currentLocationName && <div>📍 Current: {p.currentLocationName}</div>}
                {p.destination && <div>🎯 Destination: {p.destination}</div>}
                {p.temp !== undefined && <div>🌡 Temp: {p.temp} °C</div>}
                <div>⚡ Speed: {p.speed} km/h</div>
                {p.rfid && <div>🔖 RFID: {p.rfid}</div>}
                {p.cargo && <div>📦 Cargo: {p.cargo}</div>}
                {p.source && <div>🏭 Source: {p.source}</div>}
                {p.stops && p.stops.length > 0 && (
                  <div className="mt-1">
                    <div className="text-xs text-gray-400">Route:</div>
                    <div className="text-xs">{p.stops.map(s => s.name).join(' → ')}</div>
                  </div>
                )}
              </div>
            </Popup>
          </AnyMarker>
        ))}
      </AnyMap>
      <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 bg-black/60 border border-white/10 rounded-md px-3 py-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={highlightEco} onChange={e=>setHighlightEco(e.target.checked)} />
          Highlight eco-route
        </label>
        {meta && (
          <span className="text-xs text-gray-300">EF {meta.efPerKm} tCO₂/km · {meta.cargo}/{meta.loco} · {meta.grade}% · {meta.tonnage}t</span>
        )}
      </div>
    </div>
  );
}

function statusColor(status?: string) {
  switch(status) {
    case 'congested': return '#F87171'; // red
    case 'busy': return '#F59E0B'; // amber
    default: return '#10B981'; // green
  }
}

function awaitSocket() { return SOCKET_URL ? io(SOCKET_URL) : io(); }
