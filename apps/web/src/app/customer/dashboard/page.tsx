"use client";
import Guard from "@/components/Guard";
import { useEffect, useState } from "react";
import { withBase } from "@/lib/config";

export default function CustomerDashboard() {
  return (
    <Guard allow={['customer'] as any}>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="space-y-3">
          <WelcomeLine />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <a href="/customer/orders/new" className="rounded bg-brand-green text-black px-3 py-3 text-center">Place New Order</a>
            <a href="/customer/orders" className="rounded border border-white/20 px-3 py-3 text-center">Track Orders</a>
            <a href="/customer/invoices" className="rounded border border-white/20 px-3 py-3 text-center">Invoices & Payments</a>
            <a href="/customer/notifications" className="rounded border border-white/20 px-3 py-3 text-center">Notifications</a>
          </div>
        </header>
        <ProfileCard />
  <OrdersPreview />
  <MoreOptions />
      </div>
    </Guard>
  );
}

function WelcomeLine() {
  const [name, setName] = useState<string>("");
  useEffect(() => {
    const token = localStorage.getItem('token')||'';
    fetch(withBase('/customer/profile'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then(d=>setName(d.profile?.name||''))
      .catch(()=>{});
  }, []);
  return (
    <h1 className="text-2xl font-semibold">{`Hi${name?`, ${name}`:''} 👋`}</h1>
  );
}

function ProfileCard() {
  const [profile, setProfile] = useState<any>(null);
  useEffect(() => {
    const token = localStorage.getItem('token')||'';
    fetch(withBase('/customer/profile'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then(d=>setProfile(d.profile)).catch(()=>{});
  }, []);
  if (!profile) return <div className="border border-white/10 rounded p-4">Loading profile…</div>;
  return (
    <div className="border border-white/10 rounded p-4">
      <div className="font-medium mb-2">Welcome, {profile.name}</div>
      <div className="text-sm text-gray-400">Company: {profile.company} · GSTIN: {profile.gstin}</div>
    </div>
  );
}

function OrdersPreview() {
  const [orders, setOrders] = useState<any[]>([]);
  useEffect(() => {
    const token = localStorage.getItem('token')||'';
    fetch(withBase('/customer/orders'), { headers: { Authorization: `Bearer ${token}` } })
      .then(r=>r.json()).then(d=>setOrders(d.orders||[])).catch(()=>{});
  }, []);
  return (
    <div>
      <div className="font-medium mb-2">Recent Orders</div>
      <div className="grid gap-3">
        {(orders||[]).slice(0,5).map((o:any)=> (
          <a key={o.orderId} href={`/customer/orders/${o.orderId}`} className="block border border-white/10 rounded p-3 hover:bg-white/5">
            <div className="flex items-center justify-between">
              <div>#{o.orderId.slice(0,8)} · {o.cargo} · {o.quantityTons}T</div>
              <div className="text-sm text-gray-400">{o.status}</div>
            </div>
            <div className="text-xs text-gray-400">{o.sourcePlant} → {o.destination} · ETA {new Date(o.estimate?.eta).toLocaleString()}</div>
          </a>
        ))}
        {orders.length === 0 && <div className="text-gray-400 text-sm">No orders yet. Place your first order.</div>}
      </div>
    </div>
  );
}

function Tile({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <a href={href} className="block rounded-lg border border-white/10 p-4 hover:bg-white/5">
      <div className="font-medium">{title}</div>
      <div className="text-sm text-gray-400">{desc}</div>
    </a>
  );
}

function MoreOptions() {
  const items = [
    { title: 'Support / Helpdesk', desc: 'Raise tickets or chat with support', href: '/customer/support' },
    { title: 'Order History Analytics', desc: 'Trends, average delivery time, spend', href: '/customer/analytics' },
    { title: 'Carbon Credits', desc: 'Track emissions saved and rewards', href: '/customer/carbon-credits' },
    { title: 'Saved Templates', desc: 'Quick re-order with saved forms', href: '/customer/templates' },
    { title: 'Multi-User Accounts', desc: 'Manage access under same GSTIN', href: '/customer/accounts' },
    { title: 'Loyalty / Discounts', desc: 'Credits and discounts for bulk', href: '/customer/loyalty' },
  ];
  return (
    <div>
      <div className="font-medium mb-2">More Options</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {items.map(i => <Tile key={i.title} {...i} />)}
      </div>
    </div>
  );
}
