"use client";
import { useEffect, useMemo, useState } from "react";
import { withBase } from "@/lib/config";
import Link from "next/link";

type Project = { id: string; name: string; city: string; lat: number; lng: number; nearestCMO?: string; products?: string[]; sources?: string[]; route?: string };

export default function ProjectsTrackerPage(){
  const [projects, setProjects] = useState<Project[]>([]);
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [product, setProduct] = useState("");
  useEffect(()=>{
    const load = async ()=>{
      try {
        const token = localStorage.getItem('token')||'';
        const r = await fetch(withBase('/projects/major'), { headers: { Authorization: `Bearer ${token}` } });
        const j = await r.json();
        setProjects(Array.isArray(j.projects)? j.projects: []);
      } catch { setProjects([]); }
    };
    load();
  },[]);
  const filtered = useMemo(()=>{
    return projects.filter(p => {
      const text = (p.name + ' ' + (p.products||[]).join(' ') + ' ' + p.city + ' ' + (p.nearestCMO||'')).toLowerCase();
      const okQ = !q || text.includes(q.toLowerCase());
      const okCity = !city || p.city.toLowerCase().includes(city.toLowerCase());
      const okProd = !product || (p.products||[]).some(x => x.toLowerCase().includes(product.toLowerCase()));
      return okQ && okCity && okProd;
    });
  },[projects,q,city,product]);
  return (
    <main className="p-6 space-y-4">
      <h2 className="text-2xl font-semibold">Major Projects Tracker</h2>
      <div className="flex flex-wrap gap-2 text-sm">
        <input placeholder="Search…" className="bg-transparent border border-white/20 rounded px-2 py-1" value={q} onChange={e=>setQ(e.target.value)} />
        <input placeholder="City" className="bg-transparent border border-white/20 rounded px-2 py-1" value={city} onChange={e=>setCity(e.target.value)} />
        <input placeholder="Product" className="bg-transparent border border-white/20 rounded px-2 py-1" value={product} onChange={e=>setProduct(e.target.value)} />
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(p => (
          <div key={p.id} className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-gray-400">{p.city} · CMO {p.nearestCMO}</div>
            {(p.products && p.products.length>0) && (
              <div className="text-xs mt-1">Products: {p.products.join(', ')}</div>
            )}
            {p.route && <div className="text-xs text-gray-400 mt-1">Route: {p.route}</div>}
            <div className="mt-2 flex items-center gap-2 text-xs">
              <a className="underline" href="#" onClick={(e)=>{ e.preventDefault(); try { localStorage.setItem('map:focus', JSON.stringify({ lat: p.lat, lng: p.lng, zoom: 10 })); } catch{}; location.href='/map'; }}>Pin to Map</a>
              <Link className="underline" href={`/orders/status?destination=${encodeURIComponent(p.city)}`}>Orders to City</Link>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
