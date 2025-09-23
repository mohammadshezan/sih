# Production Readiness Report — QSTEEL

Date: 2025-09-23
Scope: Web (Next.js) + API (Express + Socket.IO)

## Executive summary
- Status: Not yet production-ready. Core gaps remain in security hardening, persistence (DB), rate limiting, and observability.
- Quick wins (today): Lock CORS, set strong secrets, connect Postgres, enable HTTPS and basic security headers, and add a process manager.
- Next sprints: Input validation, rate limiting, structured logs/metrics, error tracking, CI/CD with tests.

---

## Findings by area

### 1) Security
- API CORS: Defaults to allow-all when `CORS_ORIGINS` is unset (`apps/api/src/index.js`). Action: Set `CORS_ORIGINS` to your exact web domains.
- Secrets: `JWT_SECRET` has a dev fallback (`devsecret`). Action: Set a strong secret in all environments; fail-fast if missing in production.
- HTTPS: No forced HTTPS behind proxies and no `trust proxy` set. Action: set `app.set('trust proxy', 1)` and redirect HTTP→HTTPS at the edge/proxy.
- Headers: Helmet not enabled. Action: Add Helmet (CSP, HSTS, noSniff, frameguard, referrerPolicy).
- CSRF/XSS/HPP: No CSRF protection (if forms/cookies are used); no XSS/hpp hardening middleware. Action: Add `hpp`, sanitize inputs, leverage frameworks’ escaping.
- Auth tokens: JWT likely stored in localStorage; consider HttpOnly cookies if feasible; otherwise tighten token TTL/rotation and use refresh tokens.

### 2) Data & persistence
- Prisma: Not connected; API runs with in-memory fallback. Action: Configure Postgres `DATABASE_URL`, run `prisma generate` + migrations, and seed if needed.
- Redis: Optional; useful for caching/session/rate limits. Action: Add `REDIS_URL` (managed Redis) if you’ll cache or throttle.
- Backups & migrations: Define migration plan and retention (e.g., daily logical backups), verify restore procedure.

### 3) Reliability & performance
- Rate limiting: Absent. Action: Add `express-rate-limit` or Redis-backed limiter per route group (auth/export/optimizer).
- Body limits: `express.json()` has default size; enforce stricter `limit` and reject oversized payloads.
- Compression: Not enabled. Action: Add `compression` for text responses (CSV, JSON).
- Timeouts: No explicit request timeouts. Action: set server and proxy timeouts; handle abort signals.
- Next.js: Ensure production build (`next build`) and run `next start` behind a reverse proxy (or Vercel). Add cache headers for static assets and images.

### 4) Observability
- Logs: Morgan dev logs only. Action: Use structured logs (pino/winston), include request IDs, and log levels.
- Tracing/metrics: No OpenTelemetry/metrics. Action: Add basic Prometheus metrics or a SaaS APM; instrument critical paths (auth, optimizer, exports).
- Error tracking: None. Action: Add Sentry (web + API) to capture exceptions.

### 5) Operations
- Deploy: Render blueprint present for API; Web has Vercel guide. Good starting point.
- Processes: Use a manager (PM2/systemd) if not on managed PaaS. Ensure zero-downtime restarts.
- Health checks: Currently not exposed. Consider adding internal readiness probes and lightweight DB/Redis pings when DB is enabled.
- CI/CD: No tests in repo. Action: Add smoke tests and minimal e2e (sign-in, dashboard load, assistant action, CSV export).

---

## Priority actions (checklist)

Must-do before go-live (P0)
- [ ] Set production env vars:
  - API: `JWT_SECRET`, `CORS_ORIGINS`, `PORT`, `DATABASE_URL` (Postgres), `REDIS_URL` (optional), `ML_URL` (optional)
  - Web: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL`
- [ ] Connect Postgres (Prisma):
  - `npm run -w apps/api prisma:generate`
  - `npx -w apps/api prisma migrate deploy` (or `db push` for dev)
  - Seed if required: `node apps/api/prisma/seed.js`
- [ ] Enforce CORS allowlist (exact domains only) and disable allow-all in production.
- [ ] Run behind HTTPS (proxy/edge) and set `app.set('trust proxy', 1)`.
- [ ] Add security headers (Helmet) and enable `compression`.
- [ ] Add lightweight rate limiting on auth and export endpoints.

Strongly recommended (P1)
- [ ] Structured logging with request IDs; centralize logs.
- [ ] Basic metrics (Prometheus/OpenTelemetry) and uptime alerts.
- [ ] Error tracking (Sentry) for both web and API.
- [ ] Input validation (zod/joi) for all POST/PATCH routes.
- [ ] Set explicit JSON body size limits.

Nice-to-have (P2)
- [ ] Cache frequently requested data with Redis.
- [ ] Background jobs (queue) for heavy tasks.
- [ ] Canary/staging environment with automated smoke tests.

---

## Example snippets (for later implementation)

API hardening (Express):
```js
// apps/api/src/index.js (additions)
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 200 });
app.use('/auth', authLimiter);
```

Next.js security headers (Vercel or self-hosted):
```js
// apps/web/next.config.js
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(), camera=()' },
];

module.exports = {
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
    ];
  },
};
```

---

## Deployment pointers
- API (Render): see `apps/api/DEPLOY.md` and `render.yaml` (already included).
- Web (Vercel): see `apps/web/DEPLOY.md`; set NEXT_PUBLIC_API_URL to your API’s public URL.
- Monitoring: Use a hosted log + uptime provider initially; add APM as you grow.

## Acceptance criteria for “industry-ready”
- [ ] All P0 items completed and verified in staging.
- [ ] Load test passes baseline (e.g., 200 RPS on read endpoints, 20 RPS on writes; adjust to your target).
- [ ] Error rate < 1% over 7 days; p95 latency within target SLOs.
- [ ] On-call runbook exists; alerts wired to your team channels.
- [ ] Security review passed (CORS locked, HTTPS, secrets managed, headers set).

---

If you want, I can implement the P0 changes now (done for headers/limits); next I can add input validation and a small healthcheck that pings DB when configured.
