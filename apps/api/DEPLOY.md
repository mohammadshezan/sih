# Deploying the API (Express + Socket.IO)

This guide shows multiple ways to host the API that the Next.js app (on Vercel) will call.

Important env vars:
- PORT (default 4000)
- JWT_SECRET (set a strong secret)
- DATABASE_URL (optional, Postgres for Prisma)
- REDIS_URL (optional)
- CORS_ORIGINS (comma-separated, e.g. https://your-web.vercel.app,https://staging-your-web.vercel.app)
- ML_URL (optional, e.g. https://your-ml-service.example.com)

## 0) Database and seed (optional)
If you want DB persistence:
1. Set DATABASE_URL to a Postgres connection string.
2. Run migrations and seed:
   - npm run -w apps/api prisma:generate
   - npx -w apps/api prisma migrate deploy
   - node apps/api/prisma/seed.js

If seed fails, ensure DATABASE_URL is reachable and the schema matches. You can run:
- npx -w apps/api prisma db push   # dev only, creates tables from schema

## 1) Render.com (no Docker)
There are two ways:

### A) One‑click using render.yaml (recommended)
1. In Render, click New > Blueprint and select your repo.
2. It will detect `render.yaml` at the repo root and propose a Web Service named `qsteel-api` and a free Postgres `qsteel-db`.
3. Review the env vars:
  - JWT_SECRET: auto-generated
  - CORS_ORIGINS: set to your Vercel domain(s), e.g. `https://qsteel-web.vercel.app`
  - ML_URL (optional)
  - DATABASE_URL is wired to the managed Postgres if you keep the database.
4. Click Apply. First deploy will run `npm ci && npm run prisma:generate` and then start `node src/index.js`.
5. Optional: After the app is live, open the Render Shell and run:
  - `npx prisma migrate deploy` (if you will manage migrations)
  - `npx prisma db push` (quick dev sync) and `node prisma/seed.js` to seed demo data.

Notes:
- The blueprint includes a `postdeploy` that tries `npx prisma db push && node prisma/seed.js` and ignores errors; if it doesn’t run in your account tier, execute these manually via Shell.
- If you don’t want a database, delete the `databases` section from `render.yaml` and remove the `DATABASE_URL` mapping under `envVars`.

### B) Manual service (no blueprint)
1. Create a new Web Service
2. Root Directory: `apps/api`
3. Build command: `npm ci && npm run prisma:generate`
4. Start command: `node src/index.js`
5. Environment:
  - PORT is provided by Render automatically (our code reads `process.env.PORT`)
  - Set `JWT_SECRET`, `CORS_ORIGINS`, `ML_URL` and optionally `DATABASE_URL`
6. If using Postgres, add a Render Postgres and copy its connection string into `DATABASE_URL`.
7. (Optional) Open Shell and run `npx prisma db push` and `node prisma/seed.js`.

## 2) Railway.app
- Create a New Project > Deploy from GitHub
- Select /apps/api folder as the service root, or set the service to run:
  - Start command: node src/index.js
- Add environment variables as above
- If using Postgres, add the Postgres plugin and set DATABASE_URL

## 3) Fly.io (Docker)
- Ensure apps/api/Dockerfile exists (provided)
- Install flyctl and run:
  - fly launch --now --path apps/api
- Set envs:
  - fly secrets set JWT_SECRET=... CORS_ORIGINS=https://your-web.vercel.app
  - If using Postgres, create a managed Postgres or supply external DATABASE_URL
- Exposes port 4000; set internal/external mapping as needed in fly.toml

## 4) Plain VM (Ubuntu)
- SSH into your server
- Install Node 20 and a process manager (pm2):
  - curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  - sudo apt-get install -y nodejs
  - sudo npm i -g pm2
- Clone your repo and install deps in apps/api:
  - cd apps/api && npm ci
- Set envs in a .env file (see .env.example)
- Start:
  - pm2 start src/index.js --name qsteel-api
  - pm2 save

## CORS and WebSockets
- Set CORS_ORIGINS to your Vercel domain(s): e.g. https://qsteel-web.vercel.app
- The server is already configured to allow those origins for both HTTP and Socket.IO.
- If CORS_ORIGINS is empty, the API allows all origins but disables credentials.

## Health check
This project currently does not expose a health endpoint.

## Socket.IO endpoint
- The Socket.IO server runs on the same host/port as the API. In the web app, set
  - NEXT_PUBLIC_SOCKET_URL=https://your-api-host

## ML service (optional)
- If you deploy the Python service under services/ai (Dockerfile provided), set ML_URL to that host.
  - Example: ML_URL=https://qsteel-ml.onrender.com
- If ML_URL is not set or fails, the API returns a built-in naive forecast.
