# Deploying the Web (Next.js) to Vercel

This app is Vercel-ready. Follow these steps:

1) Prereqs
- You have the API (Express/Socket.IO) running somewhere publicly (Render/Fly/Railway/EC2/etc.)
- You know its base URL, e.g. https://qsteel-api.onrender.com

2) Environment variables
In the Vercel Project Settings → Environment Variables, add:
- NEXT_PUBLIC_API_URL = https://qsteel-api.onrender.com
- NEXT_PUBLIC_SOCKET_URL = https://qsteel-api.onrender.com  (or leave empty to fall back to NEXT_PUBLIC_API_URL)

Notes:
- These are NEXT_PUBLIC_ variables, so they’re available client-side. Do NOT put secrets here.
- If you don’t have a Socket.IO server, set NEXT_PUBLIC_SOCKET_URL blank and consider disabling the live widgets or using polling.

3) Create the Vercel Project
- Import your GitHub repo in Vercel.
- If this is a monorepo, set Root Directory to apps/web (important).
- Build Command: (leave default) `next build`
- Output Directory: (leave default) `.next`
- Install Command: (leave default) `npm install` or as per your package manager

4) CORS
Ensure your API allows CORS from your Vercel domain for HTTP and WebSocket (if using Socket.IO).
In apps/api you can control this via the CORS_ORIGINS env var (comma-separated). Example:
```
CORS_ORIGINS=https://your-web.vercel.app,https://staging-your-web.vercel.app
```

5) Realtime (Socket.IO) note on Vercel
Vercel’s serverless functions aren’t intended for long-lived WebSocket connections. Host Socket.IO on a persistent Node server (Render/Fly/Railway/EC2/Koyeb/etc.). Point NEXT_PUBLIC_SOCKET_URL to that host.

6) Optional ML/Forecast service
If you have a separate ML microservice, set ML_URL in the API environment so /ai/forecast proxies there:
```
ML_URL=https://your-ml-service.example.com
```
If not set, the API will respond with a built-in naive forecast.

7) Local testing
Create `apps/web/.env.local` with:
```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
```
Run `npm run dev` from the web app and verify data loads and toasts/positions update.

Troubleshooting
- 404s: Re-check NEXT_PUBLIC_API_URL and that your API routes exist.
- CORS errors: Update API CORS policy to allow your Vercel domain and WebSocket upgrade requests.
- No live updates: Confirm Socket.IO server is reachable at NEXT_PUBLIC_SOCKET_URL and not blocked by firewalls.
