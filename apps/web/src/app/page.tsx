import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section
        className="relative overflow-hidden min-h-[85vh] bg-fixed bg-cover bg-center"
        style={{ backgroundImage: 'url(/brand/rail.jpeg)' }}
      >
  {/* Single subtle overlay to keep text readable; removed extra gradient layer */}
  <div className="absolute inset-0 bg-black/60" />

        <div className="relative z-10 mx-auto max-w-7xl px-6 pt-28 pb-20 text-center">
          {/* Glass panel for headline and CTA */}
          <div className="mx-auto max-w-3xl rounded-2xl bg-black/30 backdrop-blur-sm ring-1 ring-white/10 p-6 md:p-8">
            <h1
              className="text-4xl md:text-6xl font-semibold tracking-tight"
              style={{ textShadow: '0 6px 24px rgba(10, 10, 10, 0.91)' }}
            >
              QSTEEL – Smarter Steel Logistics, Powered by AI
            </h1>
            <p className="mt-4 text-lg text-gray-200">
              From Plant to Customer — Faster, Smarter, Greener.
            </p>
            <div className="mt-8 flex justify-center gap-3 flex-wrap">
              <Link href="/customer-auth" className="rounded-lg bg-brand-green px-6 py-3 font-medium text-black hover:opacity-90">Create Account</Link>
            </div>
          </div>

          {/* KPI cards */}
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <CardStat className="kpi-card" label="Total Active Rakes" value="18" />
            <CardStat className="kpi-card" label="Wagons in Operation" value="520" />
            <CardStat className="kpi-card" label="Carbon Saved Today" value={<span className="text-brand-green">3.2t</span>} />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-6 py-12">
        <h2 className="text-2xl font-semibold">Key Features</h2>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-5 gap-6">
          <FeatureCard icon={<IconAI />} title="AI Rake Optimizer" desc="Build optimal rakes, simulate what-if, and lock better KPIs." href="/optimizer" />
          <FeatureCard icon={<IconMap />} title="Live Tracking" desc="Realtime rake positions and station ETAs." href="/map" />
          <FeatureCard icon={<IconLeaf />} title="Carbon Analytics" desc="CO₂ per ton-km, route comparisons, and sustainability reporting." href="/customer/analytics" />
          <FeatureCard icon={<IconLedger />} title="Blockchain Ledger" desc="Tamper-evident audit trail for dispatch and yard events." href="/ledger" />
          <FeatureCard icon={<IconFactory />} title="Multi-Plant Ops" desc="Coordinate plants, yards, and suppliers with shared visibility." href="/planner" />
        </div>
        <div className="mt-6 text-sm text-gray-400">
          <span className="mr-2">Cargo Types:</span>
          <span className="inline-flex gap-2 flex-wrap">
            {['CEMENT','ORE','STEEL','COAL'].map((c) => (
              <span key={c} className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-gray-200">{c}</span>
            ))}
          </span>
        </div>
      </section>

      {/* Live Preview removed per request */}

      {/* Who It's For */}
      <section className="mx-auto max-w-7xl px-6 py-12">
        <h2 className="text-2xl font-semibold">Who It’s For</h2>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-6">
          <ModuleCard icon={<IconUser />} title="Customers" items={["Place Orders","Track & Invoices","Notifications","Support"]} href="/customer-auth" />
          <ModuleCard icon={<IconManager />} title="Managers" items={["Approvals","Simulator","KPI & Reports","Optimizer"]} href="/manager/approvals" />
          <ModuleCard icon={<IconYard />} title="Yard" items={["Wagon Health","Safety","Gate & Resources","Loading Analytics"]} href="/yard-actions" />
          <ModuleCard icon={<IconShield />} title="Admins" items={["RBAC","Ledger","Integrations","Audit"]} href="/admin/rbac" />
        </div>
      </section>

      {/* Impact */}
      <section className="mx-auto max-w-7xl px-6 py-12">
        <h2 className="text-2xl font-semibold">Impact</h2>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <CardStat className="kpi-card" label="Faster Dispatch" value={<><span className="text-4xl font-bold">30%</span> <span className="text-base font-medium text-gray-300 align-super">↑</span></>} />
          <CardStat className="kpi-card" label="Cost Savings" value={<><span className="text-4xl font-bold">20%</span> <span className="text-base font-medium text-gray-300 align-super">↓</span></>} />
          <CardStat className="kpi-card" label="Transparency" value={<span className="text-4xl font-bold">100%</span>} />
        </div>
      </section>

      {/* Signup/Login CTA */}
      <section className="mx-auto max-w-7xl px-6 py-12">
        <div className="rounded-xl border border-white/10 p-6 md:p-8 bg-white/5">
          <div className="md:flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold">Get Started</h3>
              <p className="text-sm text-gray-400">New to QSTEEL? Sign up as a customer or sign in to manage operations.</p>
            </div>
            <div className="mt-4 md:mt-0 flex gap-3">
              <Link href="/customer-auth" className="rounded-lg bg-brand-green px-5 py-2 font-medium text-black hover:opacity-90">Customer Signup/Login</Link>
              <Link href="/signin" className="rounded-lg border border-white/10 px-5 py-2 font-medium text-gray-100 hover:bg-white/10">Sign in</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials & Sustainability */}
      <section className="mx-auto max-w-7xl px-6 py-12 grid md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-white/10 p-6 bg-white/5">
          <h3 className="text-xl font-semibold">What our users say</h3>
          <ul className="mt-4 space-y-3 text-sm text-gray-300">
            <li>“Approvals and auto-transitions made our dispatch smoother.” — Operations Manager</li>
            <li>“Customer portal is simple and our invoices just work.” — Enterprise Customer</li>
            <li>“Eco-route overlay helped us communicate sustainability wins.” — Plant Lead</li>
          </ul>
        </div>
        <div className="rounded-xl border border-white/10 p-6 bg-white/5">
          <h3 className="text-xl font-semibold">Sustainability</h3>
          <p className="mt-2 text-sm text-gray-300">Data-backed ESG for rail logistics: measure CO₂ per ton-km, compare routes by emissions, and generate audit-ready reports—automatically. Reward greener choices with clear savings and proof.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <CardStat label="Avg EF" value={<span>0.98 tCO₂/rake</span>} />
            <CardStat label="Eco Savings" value={<span className="text-brand-green">12%</span>} />
          </div>
          <ul className="mt-4 text-sm text-gray-300 list-disc list-inside space-y-1">
            <li>Per-rake and per-order emissions</li>
            <li>Low-emission route recommendations</li>
            <li>Exportable ESG reports</li>
          </ul>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-7xl px-6 pb-12">
        <div className="rounded-xl border border-white/10 p-6 md:p-8 bg-gradient-to-r from-white/5 to-white/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="text-2xl font-semibold">Ready to move steel smarter?</h3>
            <p className="text-sm text-gray-400 mt-1">Start in minutes with the Customer Portal or talk to us about a tailored rollout.</p>
          </div>
          <div className="flex gap-3">
            <Link href="/customer-auth" className="rounded-lg bg-brand-green px-5 py-2 font-medium text-black hover:opacity-90">🚀 Get Started Now</Link>
            <a href="mailto:contact@qsteel.test" className="rounded-lg border border-white/10 px-5 py-2 font-medium text-gray-100 hover:bg-white/10">📞 Contact Us</a>
          </div>
        </div>
      </section>

      {/* Ledger Transparency */}
      <section className="mx-auto max-w-7xl px-6 py-12">
        <div className="rounded-xl border border-white/10 p-6 bg-white/5">
          <h3 className="text-xl font-semibold">Ledger Transparency</h3>
          <p className="mt-2 text-sm text-gray-300">Every dispatch and yard event is appended to a hash-chained ledger for auditability and tamper-evidence.</p>
          <div className="mt-3 text-sm">
            <Link href="/ledger" className="underline text-gray-200">Explore Ledger →</Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto max-w-7xl px-6 py-12 text-sm text-gray-400">
        <div className="grid md:grid-cols-4 gap-6">
          <div>
            <div className="font-semibold text-gray-200">QSTEEL</div>
            <p className="mt-2">Rail & yard logistics for steel—built for reliability, transparency, and sustainability.</p>
          </div>
          <div>
            <div className="font-semibold text-gray-200">Product</div>
            <ul className="mt-2 space-y-1">
              <li><Link href="/optimizer" className="hover:underline">Optimizer</Link></li>
              <li><Link href="/map" className="hover:underline">Live Map</Link></li>
              <li><Link href="/reports" className="hover:underline">Reports</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold text-gray-200">For Roles</div>
            <ul className="mt-2 space-y-1">
              <li><Link href="/customer-auth" className="hover:underline">Customer</Link></li>
              <li><Link href="/manager/approvals" className="hover:underline">Manager</Link></li>
              <li><Link href="/yard-actions" className="hover:underline">Yard</Link></li>
              <li><Link href="/admin/rbac" className="hover:underline">Admin</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold text-gray-200">Company</div>
            <ul className="mt-2 space-y-1">
              <li><a href="https://github.com/mohammadshezan/QSTEEL" target="_blank" rel="noreferrer" className="hover:underline">Docs</a></li>
              <li><Link href="/customer/support" className="hover:underline">Support</Link></li>
              <li><Link href="/signin" className="hover:underline">Sign in</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t border-white/10 pt-4 flex items-center justify-between">
          <span>© {new Date().getFullYear()} QSTEEL</span>
          <span className="text-xs">Built with Next.js</span>
        </div>
      </footer>
    </main>
  );
}

function CardStat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl bg-white/5 p-6 border border-white/10 ${className ?? ""}`}>
      <p className="text-sm text-gray-400">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
    </div>
  );
}

function FeatureCard({ icon, title, desc, href }: { icon?: React.ReactNode; title: string; desc: string; href: string }) {
  return (
    <Link href={href} className="rounded-xl bg-white/5 p-6 border border-white/10 hover:bg-white/10 transition-colors block">
      <div className="flex items-center gap-2 text-lg font-medium">{icon}<span>{title}</span></div>
      <div className="text-sm text-gray-400 mt-1">{desc}</div>
      <div className="text-sm text-gray-300 mt-3 underline">Learn more →</div>
    </Link>
  );
}

function ModuleCard({ icon, title, items, href }: { icon?: React.ReactNode; title: string; items: string[]; href: string }) {
  return (
    <Link href={href} className="rounded-xl bg-white/5 p-6 border border-white/10 hover:bg-white/10 transition-colors block">
      <div className="flex items-center gap-2 text-lg font-medium">{icon}<span>{title}</span></div>
      <ul className="mt-2 text-sm text-gray-300 space-y-1">
        {items.map((i) => (<li key={i}>• {i}</li>))}
      </ul>
    </Link>
  );
}

// Inline icons (simple, no external deps)
function IconAI() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-brand-green">
      <path d="M12 2l2.5 4.5L20 8l-3.5 3 1 4.5-4-2-4 2 1-4.5L4 8l5.5-1.5L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
function IconMap() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-brand-green">
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
function IconLeaf() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-brand-green">
      <path d="M20 4c-7 0-12 5-12 12 0 2 1 4 3 4 7 0 12-5 12-12 0-2-1-4-3-4z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 16c2-1 5-3 8-6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function IconLedger() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-brand-green">
      <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function IconFactory() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-brand-green">
      <path d="M3 21V9l6 3V9l6 3V5l6 3v13H3z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 21v-4m4 4v-4m4 4v-4m4 4v-4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-brand-green">
      <circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 20c0-3.314 3.134-6 7-6s7 2.686 7 6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function IconManager() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-brand-green">
      <path d="M4 17h16M7 13l5-6 5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IconYard() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-brand-green">
      <rect x="3" y="10" width="18" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 10V7a2 2 0 012-2h8a2 2 0 012 2v3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-brand-green">
      <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.5 12.5l1.5 1.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
