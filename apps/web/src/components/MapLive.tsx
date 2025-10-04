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

export default function MapLive({ selectedAltRoute }: { selectedAltRoute?: { name: string; lat: number; lng: number }[] }) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [prev, setPrev] = useState<Record<string, Position>>({});
  const [routes, setRoutes] = useState<any[]>([]);
  const [eco, setEco] = useState<{ bestIndex?: number } | null>(null);
  const [meta, setMeta] = useState<any | null>(null);
  const [highlightEco, setHighlightEco] = useState<boolean>(true);
  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [network, setNetwork] = useState<any[]>([]);
  const [majorProjects, setMajorProjects] = useState<any[]>([]);

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

    // Fetch customer project sites (role-gated, but server allows any auth role)
    fetch(withBase('/customer/projects'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=> r.ok ? r.json() : Promise.reject())
      .then(d => setProjects(Array.isArray(d.projects) ? d.projects : []))
      .catch(()=> setProjects([]));

    // Fetch SAIL network points
    fetch(withBase('/network/sail'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=> r.ok ? r.json() : Promise.reject())
      .then(d => setNetwork(Array.isArray(d.points) ? d.points : []))
      .catch(()=> setNetwork([]));

    // Fetch major projects
    fetch(withBase('/projects/major'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=> r.ok ? r.json() : Promise.reject())
      .then(d => setMajorProjects(Array.isArray(d.projects) ? d.projects : []))
      .catch(()=> setMajorProjects([]));

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

  const center = useMemo(() => {
    try {
      const saved = localStorage.getItem('map:focus');
      if (saved) { const f = JSON.parse(saved); return [f.lat, f.lng] as [number,number]; }
    } catch {}
    if (selectedAltRoute && selectedAltRoute.length>0) return [selectedAltRoute[0].lat, selectedAltRoute[0].lng] as [number,number];
    return [23.64, 86.16] as [number, number];
  }, [selectedAltRoute]);

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
  const projectIcon = (label: string) => L.divIcon({
    className: 'project-icon',
    html: `<div class="flex items-center justify-center w-6 h-6 rounded-full bg-purple-500/90 text-white shadow"><span style="font-size:12px">📍</span></div>`,
    iconSize: [24,24], iconAnchor: [12,12]
  });
  const iconByType = (type?: string) => {
    const map: Record<string,{bg:string,emoji:string,title:string}> = {
      corporate: { bg: '#2dd4bf', emoji: '🏢', title: 'Corporate Office' },
      integrated_plant: { bg: '#fb923c', emoji: '🏭', title: 'Integrated Steel Plant' },
      alloy_special: { bg: '#f59e0b', emoji: '🧱', title: 'Alloy & Special Steel' },
      ferro_alloy: { bg: '#374151', emoji: '🔺', title: 'Ferro Alloy Plant' },
      unit: { bg: '#fbbf24', emoji: '🏭', title: 'Unit' },
      cmo_hq: { bg: '#60a5fa', emoji: '🏢⚙️', title: 'CMO HQ' },
      regional_office: { bg: '#60a5fa', emoji: '🏢', title: 'Regional Office' },
      spu: { bg: '#94a3b8', emoji: '🧷', title: 'Steel Processing Unit' },
      dept_wh: { bg: '#22c55e', emoji: '⭐', title: 'Departmental Warehouse' },
      consignment: { bg: '#111827', emoji: '⭐', title: 'Consignment/CHA Yard' },
      srm: { bg: '#16a34a', emoji: '🟩', title: 'Sales Resident Manager' },
      customer_contact: { bg: '#fb923c', emoji: '🟧', title: 'Customer Contact Office' },
      refractory: { bg: '#a855f7', emoji: '🟪', title: 'SAIL Refractory Unit' },
      logistics: { bg: '#1f2937', emoji: '🚉', title: 'Logistics & Infrastructure' },
      bso_nr: { bg: '#facc15', emoji: '🚩', title: 'Branch Sales Office (NR)' },
      bso_er: { bg: '#fb923c', emoji: '🚩', title: 'Branch Sales Office (ER)' },
      bso_wr: { bg: '#22c55e', emoji: '🚩', title: 'Branch Sales Office (WR)' },
      bso_sr: { bg: '#60a5fa', emoji: '🚩', title: 'Branch Sales Office (SR)' },
    };
    const m = map[String(type||'').toLowerCase()] || { bg: '#64748b', emoji: '📍', title: 'Location' };
    return L.divIcon({
      className: 'sail-icon',
      html: `<div style="width:24px;height:24px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:${m.bg};color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${m.emoji}</div>`,
      iconSize: [24,24], iconAnchor: [12,12]
    });
  };
  const majorIcon = L.divIcon({
    className: 'major-icon',
    html: '<div style="width:26px;height:26px;border-radius:13px;display:flex;align-items:center;justify-content:center;background:#eab308;color:#111;box-shadow:0 1px 4px rgba(0,0,0,.4)">📣</div>',
    iconSize: [26,26], iconAnchor: [13,13]
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
        {/* optional selected alt route polyline */}
        {Array.isArray(selectedAltRoute) && selectedAltRoute.length>1 && (
          <>
            <AnyPolyline positions={selectedAltRoute.map(p => [p.lat, p.lng])} pathOptions={{ color: '#F59E0B', weight: 4, opacity: 0.9, dashArray: '6 4' }} />
            {selectedAltRoute.map((s, idx) => (
              <AnyMarker key={`alt-${idx}`} position={[s.lat, s.lng]} icon={stationIcon('green' as any)}>
                <Popup>
                  <div className="text-sm">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-gray-400">Alt route waypoint</div>
                  </div>
                </Popup>
              </AnyMarker>
            ))}
          </>
        )}

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
        {/* Major Projects markers */}
        {majorProjects.map((m:any) => (
          <AnyMarker key={m.id} position={[m.lat, m.lng]} icon={majorIcon}>
            <Popup>
              <div className="text-sm min-w-[260px]">
                <div className="font-semibold">{m.name}</div>
                <div className="text-xs text-gray-400">{m.city} · Nearest CMO: {m.nearestCMO}</div>
                <div className="text-xs mt-1">Products: {(m.products||[]).join(', ')}</div>
                <div className="text-xs">Sources: {(m.sources||[]).join(', ')}</div>
                {m.route && <div className="text-xs mt-1 text-gray-400">Route: {m.route}</div>}
                {m.contact && (
                  <div className="text-xs mt-2">
                    <div className="text-gray-400">Contact</div>
                    {m.contact.name && <div>{m.contact.name}</div>}
                    {m.contact.email && <div><a className="underline" href={`mailto:${m.contact.email}`}>{m.contact.email}</a></div>}
                    {m.contact.phone && <div>{m.contact.phone}</div>}
                  </div>
                )}
                {m.kpis && (
                  <div className="text-xs mt-2 grid grid-cols-3 gap-2">
                    <div><div className="text-gray-400">Qty</div><div className="font-medium">{m.kpis.quantityTons ?? '-'}</div></div>
                    <div><div className="text-gray-400">ETA</div><div className="font-medium">{m.kpis.eta ?? '-'}</div></div>
                    <div><div className="text-gray-400">CO₂</div><div className="font-medium">{m.kpis.co2 ?? '-'}</div></div>
                  </div>
                )}
              </div>
            </Popup>
          </AnyMarker>
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
        {/* Project site markers */}
        {projects.map((p:any) => (
          <AnyMarker key={p.id} position={[p.lat, p.lng]} icon={projectIcon(p.city)}>
            <Popup>
              <div className="text-sm">
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-gray-400">{p.city}, {p.state} · CMO: {p.nearestCMO}</div>
                <div className="text-xs mt-1">Products: {(p.products||[]).join(', ')}</div>
                <div className="mt-2">
                  <a href={`/orders/status?destination=${encodeURIComponent(p.city)}`} className="text-indigo-300 underline text-xs">View orders to this city</a>
                </div>
              </div>
            </Popup>
          </AnyMarker>
        ))}
        {/* SAIL Network markers */}
        {network.map((n:any) => (
          <AnyMarker key={n.id} position={[n.lat, n.lng]} icon={iconByType(n.type)}>
            <Popup>
              <div className="text-sm min-w-[220px]">
                <div className="font-semibold">{n.name}</div>
                <div className="text-xs text-gray-400">{n.city}, {n.state} · {String(n.type||'').replace(/_/g,' ')}</div>
                {n.description && (<div className="text-xs mt-1">{n.description}</div>)}
                {n.stats && (
                  <div className="text-xs mt-1 text-gray-300">
                    {n.stats.products ? (<div>Products: {(n.stats.products||[]).join(', ')}</div>) : null}
                    {n.stats.category ? (<div>Category: {n.stats.category}</div>) : null}
                  </div>
                )}
                {n.contact && (
                  <div className="text-xs mt-2">
                    {n.contact.email && (<div>Email: <a className="underline" href={`mailto:${n.contact.email}`}>{n.contact.email}</a></div>)}
                    {n.contact.phone && (<div>Phone: {n.contact.phone}</div>)}
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
