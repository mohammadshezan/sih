# QSTEEL Logistics Platform (Hackathon Edition)

A demo-grade, production-lean full-stack platform for AI-driven logistics: planning rakes, forecasting demand, live tracking, and transparent dispatch logging.

## Stack
- Web: Next.js (React), Tailwind CSS, shadcn/ui, Recharts, Leaflet, PWA
- API: Node.js + Express, Prisma + PostgreSQL, Redis, Socket.IO
- AI: FastAPI (Python) with forecasting/optimization stubs
- Infra: Docker Compose (Postgres, Redis, AI service)

## Quick start
1. Install Node.js 18+, Python 3.10+
2. `npm install`
3. Start infra: `docker compose up -d`
4. Start web: `npm run -w apps/web dev`
5. Start API: `npm run -w apps/api dev`

Demo users (seeded):
- admin@sail.test / OTP 123456 (Admin)
- manager@sail.test / OTP 123456 (Logistics Manager)
- yard@sail.test / OTP 123456 (Yard Supervisor)

## Notes
- This repo is a scaffold optimized for demos with progressive enhancement paths to production.

## Database migrations (Prisma)

- Use descriptive migration names, e.g. `routes_schema`, `add_plant_relation_to_route`.
- Local development:
	- Ensure Postgres is running (see docker-compose) and create `apps/api/.env` with `DATABASE_URL=postgresql://qsteel:qsteel@localhost:5432/qsteel?schema=public`.
	- From `apps/api`:
		- `prisma generate`
		- `prisma migrate dev --name <migration_name>`
		- `npm run prisma:seed`
- Multiple environments:
	- Keep `.env` per environment (or inject `DATABASE_URL` from secrets in CI/CD).
	- Prefer `prisma migrate deploy` on deploy to apply pending migrations.
	- Optionally use `prisma migrate diff` to review SQL when promoting between envs.

