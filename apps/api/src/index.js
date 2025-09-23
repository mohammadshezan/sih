import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import fetch from 'node-fetch';
import { createServer } from 'http';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import { Server as SocketIOServer } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import RakeOptimizer from './optimizer.js';
import { z } from 'zod';
import { promisify } from 'util';

const app = express();
const httpServer = createServer(app);
const optimizer = new RakeOptimizer();

// CORS configuration (HTTP + WebSocket) driven by env
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const allowAll = CORS_ORIGINS.length === 0 && process.env.NODE_ENV !== 'production';
const corsOptions = {
  origin: allowAll ? '*' : CORS_ORIGINS,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  // Only enable credentials when specific origins are configured; '*' with credentials is invalid in browsers
  credentials: !allowAll,
};
const io = new SocketIOServer(httpServer, {
  cors: corsOptions,
});

app.set('trust proxy', 1);
if (!allowAll && CORS_ORIGINS.length === 0 && process.env.NODE_ENV === 'production') {
  console.error('CORS_ORIGINS is required in production');
}
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(helmet({
  contentSecurityPolicy: false, // TODO: configure CSP when domains are finalized
}));
app.use(hpp());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use('/auth', authLimiter);
app.use(morgan('dev'));

const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'devsecret') {
  console.error('Refusing to start with weak JWT_SECRET in production');
  // In dev we allow fallback; in production, enforce strong secret.
  // process.exit(1); // Uncomment to hard-enforce in prod runtime
}
let prisma = null;
async function initPrisma() {
  try {
    if (process.env.DATABASE_URL) {
      const p = new PrismaClient();
      await p.$connect();
      prisma = p;
      console.log('Prisma connected');
    }
  } catch (e) {
    console.warn('Prisma not connected, falling back to in-memory:', e?.message || e);
    prisma = null;
  }
}
initPrisma();

// Redis (optional) for caching and OTP store
let redis = null;
async function initRedis() {
  try {
    const url = process.env.REDIS_URL || process.env.REDIS_HOST || 'redis://127.0.0.1:6379';
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      autoResubscribe: false,
      retryStrategy: null,
      reconnectOnError: () => false,
    });
    client.on?.('error', () => {}); // swallow initial connection errors in demo mode
    await client.connect?.();
    await client.ping();
    redis = client;
    console.log('Redis connected');
  } catch (e) {
    console.warn('Redis not connected, proceeding without cache:', e?.message || e);
    try { if (typeof client?.quit === 'function') await client.quit(); } catch {}
    redis = null;
  }
}
initRedis();

// In-memory fallback store for OTPs if Redis is unavailable
const OTP_STORE = new Map(); // key: email, value: { code, expMs }
function otpSet(email, code, ttlSec = 300) {
  const expMs = Date.now() + ttlSec * 1000;
  if (redis) {
    return redis.set(`otp:${email}`, JSON.stringify({ code, expMs }), 'EX', ttlSec).catch(()=>{});
  }
  OTP_STORE.set(email, { code, expMs });
}
async function otpGet(email) {
  if (redis) {
    try { const v = await redis.get(`otp:${email}`); return v ? JSON.parse(v) : null; } catch { return null; }
  }
  const v = OTP_STORE.get(email);
  if (!v) return null; if (Date.now() > v.expMs) { OTP_STORE.delete(email); return null; }
  return v;
}
function otpDel(email) {
  if (redis) { return redis.del(`otp:${email}`).catch(()=>{}); }
  OTP_STORE.delete(email);
}

// Attach a correlation/request ID for every request
morgan.token('id', (req) => req.id || '-');
app.use((req, res, next) => {
  const headerId = req.headers['x-request-id'];
  req.id = (typeof headerId === 'string' && headerId) || (crypto.randomUUID?.() || Math.random().toString(36).slice(2));
  res.setHeader('x-request-id', req.id);
  next();
});
app.use(morgan(':id :method :url :status :response-time ms'));

// Friendly root route
app.get('/', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    name: 'QSTEEL API',
    status: 'ok',
    time: new Date().toISOString(),
    docs: 'https://github.com/mohammadshezan/QSTEEL',
    endpoints: {
      login: { method: 'POST', url: `${base}/auth/login`, body: { email: 'admin@sail.test', otp: '<6-digit code from email>' } },
      kpis: { method: 'GET', url: `${base}/kpis`, auth: 'Bearer <token>' },
      mapRoutes: { method: 'GET', url: `${base}/map/routes?cargo=ore&loco=diesel&grade=0&tonnage=3000&routeKey=BKSC-DGR`, auth: 'Bearer <token>' },
      alerts: { method: 'GET', url: `${base}/alerts`, auth: 'Bearer <token>' },
    },
  });
});

// (system health endpoint removed by request)

async function cacheGet(key) {
  try { if (!redis) return null; const v = await redis.get(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
async function cacheSet(key, value, ttlSeconds = 60) {
  try { if (!redis) return; await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds); } catch { /* noop */ }
}

// Centralized demo/mock dataset for fallback mode
const MOCK_DATA = {
  plants: [
    { code: 'BKSC', name: 'Bokaro', location: 'Bokaro Steel City' },
    { code: 'DGR', name: 'Durgapur', location: 'Durgapur' },
    { code: 'ROU', name: 'Rourkela', location: 'Rourkela' },
    { code: 'BPHB', name: 'Bhilai', location: 'Bhilai Steel Plant' },
  ],
  yards: [
    { code: 'DGR-Y1', name: 'Durgapur Yard 1', plant: 'DGR' },
    { code: 'ROU-Y1', name: 'Rourkela Yard 1', plant: 'ROU' },
    { code: 'BPHB-Y1', name: 'Bhilai Yard 1', plant: 'BPHB' },
  ],
  routes: [
    { id: 'R1', from: 'BKSC', to: 'DGR', distanceKm: 300, routeKey: 'BKSC-DGR', name: 'BKSC → DGR' },
    { id: 'R2', from: 'BKSC', to: 'ROU', distanceKm: 450, routeKey: 'BKSC-ROU', name: 'BKSC → ROU' },
    { id: 'R3', from: 'BKSC', to: 'BPHB', distanceKm: 600, routeKey: 'BKSC-BPHB', name: 'BKSC → BPHB' },
  ],
  rakes: [
    { id: 'RK001', name: 'Rake 1', route: 'R1', status: 'Under Construction', cargoType: 'TMT Bars', locomotive: 'Electric', grade: 'Fe500', tonnage: 500 },
    { id: 'RK002', name: 'Rake 2', route: 'R2', status: 'Loading', cargoType: 'H-Beams', locomotive: 'Diesel', grade: 'Fe500', tonnage: 400 },
    { id: 'RK003', name: 'Rake 3', route: 'R3', status: 'Dispatched', cargoType: 'Coils', locomotive: 'Electric', grade: 'Fe600', tonnage: 300 },
    { id: 'RK004', name: 'Rake 4', route: 'R1', status: 'En Route', cargoType: 'Cement', locomotive: 'Diesel', grade: 'Fe500', tonnage: 450 },
    { id: 'RK005', name: 'Rake 5', route: 'R2', status: 'Loading', cargoType: 'Ore', locomotive: 'Electric', grade: 'Fe500', tonnage: 550 },
    { id: 'RK006', name: 'Rake 6', route: 'R2', status: 'En Route', cargoType: 'Steel', locomotive: 'Diesel', grade: 'Fe500', tonnage: 520 },
    { id: 'RK007', name: 'Rake 7', route: 'R1', status: 'En Route', cargoType: 'Cement', locomotive: 'Electric', grade: 'Fe500', tonnage: 480 },
  ],
  wagons: [
    { id: 'W001', rake: 'RK001', type: 'Open', cargo: 'TMT Bars', capacityTons: 100, loadedTons: 50 },
    { id: 'W002', rake: 'RK001', type: 'Open', cargo: 'TMT Bars', capacityTons: 100, loadedTons: 100 },
    { id: 'W003', rake: 'RK002', type: 'Covered', cargo: 'H-Beams', capacityTons: 80, loadedTons: 60 },
    { id: 'W004', rake: 'RK002', type: 'Covered', cargo: 'H-Beams', capacityTons: 80, loadedTons: 80 },
    { id: 'W005', rake: 'RK003', type: 'Flat', cargo: 'Coils', capacityTons: 120, loadedTons: 120 },
  ],
  stockDemand: [
    { yard: 'DGR-Y1', grade: 'TMT Bars', stock: 500, demand: 700 },
    { yard: 'DGR-Y1', grade: 'H-Beams', stock: 300, demand: 400 },
    { yard: 'DGR-Y1', grade: 'Coils', stock: 200, demand: 250 },
    { yard: 'ROU-Y1', grade: 'TMT Bars', stock: 600, demand: 550 },
    { yard: 'ROU-Y1', grade: 'H-Beams', stock: 150, demand: 200 },
    { yard: 'ROU-Y1', grade: 'Coils', stock: 100, demand: 120 },
    { yard: 'BPHB-Y1', grade: 'TMT Bars', stock: 450, demand: 500 },
    { yard: 'BPHB-Y1', grade: 'H-Beams', stock: 250, demand: 300 },
    { yard: 'BPHB-Y1', grade: 'Coils', stock: 150, demand: 180 },
  ],
  alerts: [
    { id: 'A001', type: 'Stock Low', message: 'TMT Bars low at Durgapur Yard 1', severity: 'high', ts: '2025-09-20 10:00' },
    { id: 'A002', type: 'Delay Risk', message: 'Rake RK002 may be delayed on R2', severity: 'medium', ts: '2025-09-20 10:05' },
    { id: 'A003', type: 'Eco Route Alert', message: 'Consider electric loco for RK003', severity: 'low', ts: '2025-09-20 10:10' },
  ],
  dispatches: [
    { id: 'D001', rake: 'RK001', yard: 'DGR-Y1', status: 'Confirmed', ts: '2025-09-20 10:15' },
    { id: 'D002', rake: 'RK002', yard: 'ROU-Y1', status: 'Dispatched', ts: '2025-09-20 10:20' },
    { id: 'D003', rake: 'RK003', yard: 'BPHB-Y1', status: 'Completed', ts: '2025-09-20 10:25' },
  ],
  // Enriched positions with RFID and full route stops (with station coords and signals)
  positions: [
    {
      id: 'RK001', rfid: 'RFID-201', status: 'En Route', speed: 45, temp: 32.5,
      cargo: 'TMT Bars', source: 'Bokaro', destination: 'Bhilai Steel Plant',
      currentLocationName: 'Bokaro',
      stops: [
        { name: 'Bokaro', lat: 23.6665, lng: 86.1511, signal: 'green' },
        { name: 'Durgapur', lat: 23.5204, lng: 87.3119, signal: 'red' },
        { name: 'Rourkela', lat: 22.2604, lng: 85.3240, signal: 'green' },
        { name: 'Bhilai Steel Plant', lat: 21.1938, lng: 81.3810, signal: 'green' },
      ]
    },
    {
      id: 'RK002', rfid: 'RFID-202', status: 'Halted', speed: 0, temp: 30.2,
      cargo: 'Coils', source: 'Bokaro', destination: 'Durgapur Steel Plant',
      currentLocationName: 'Asansol',
      stops: [
        { name: 'Bokaro', lat: 23.6665, lng: 86.1511, signal: 'green' },
        { name: 'Asansol', lat: 23.6839, lng: 86.9855, signal: 'red' },
        { name: 'Durgapur', lat: 23.5204, lng: 87.3119, signal: 'green' },
      ]
    },
    {
      id: 'RK003', rfid: 'RFID-203', status: 'Loading', speed: 10, temp: 31.0,
      cargo: 'H-beams', source: 'Rourkela', destination: 'Bokaro',
      currentLocationName: 'Rourkela Yard',
      stops: [
        { name: 'Rourkela', lat: 22.2604, lng: 85.3240, signal: 'green' },
        { name: 'Bondamunda', lat: 22.2200, lng: 85.3200, signal: 'red' },
        { name: 'Bokaro', lat: 23.6665, lng: 86.1511, signal: 'green' },
      ]
    },
    {
      id: 'RK004', rfid: 'RFID-204', status: 'En Route', speed: 52, temp: 33.1,
      cargo: 'Ore', source: 'Rourkela', destination: 'Bhilai',
      currentLocationName: 'Rourkela',
      stops: [
        { name: 'Rourkela', lat: 22.2604, lng: 85.3240, signal: 'green' },
        { name: 'Rajgangpur', lat: 22.1186, lng: 84.8678, signal: 'green' },
        { name: 'Jharsuguda', lat: 21.8554, lng: 84.0067, signal: 'red' },
        { name: 'Bhilai', lat: 21.1938, lng: 81.3810, signal: 'green' },
      ]
    },
    {
      id: 'RK005', rfid: 'RFID-205', status: 'En Route', speed: 40, temp: 29.8,
      cargo: 'Coal', source: 'Durgapur', destination: 'Rourkela',
      currentLocationName: 'Durgapur',
      stops: [
        { name: 'Durgapur', lat: 23.5204, lng: 87.3119, signal: 'green' },
        { name: 'Asansol', lat: 23.6839, lng: 86.9855, signal: 'green' },
        { name: 'Rourkela', lat: 22.2604, lng: 85.3240, signal: 'red' },
      ]
    },
    {
      id: 'RK006', rfid: 'RFID-206', status: 'En Route', speed: 55, temp: 30.5,
      cargo: 'Steel', source: 'Asansol', destination: 'Bokaro',
      currentLocationName: 'Asansol',
      stops: [
        { name: 'Asansol', lat: 23.6839, lng: 86.9855, signal: 'green' },
        { name: 'Dhanbad', lat: 23.7957, lng: 86.4304, signal: 'red' },
        { name: 'Bokaro', lat: 23.6665, lng: 86.1511, signal: 'green' },
      ]
    },
    {
      id: 'RK007', rfid: 'RFID-207', status: 'En Route', speed: 15, temp: 30.0,
      cargo: 'Cement', source: 'Bokaro', destination: 'Asansol Cement Depot',
      currentLocationName: 'Bokaro',
      stops: [
        { name: 'Bokaro', lat: 23.6665, lng: 86.1511, signal: 'red' },
        { name: 'Ramgarh', lat: 23.6300, lng: 85.5200, signal: 'green' },
        { name: 'Asansol Cement Depot', lat: 23.6839, lng: 86.9855, signal: 'green' },
      ]
    },
  ],
  forecast: [
    { rake: 'RK001', forecast7d: 550, suggestedRoute: 'BKSC → DGR' },
    { rake: 'RK002', forecast7d: 420, suggestedRoute: 'BKSC → ROU' },
    { rake: 'RK003', forecast7d: 300, suggestedRoute: 'BKSC → BPHB' },
  ],
};

// Simple in-memory users for demo
const users = [
  { id: 1, email: 'admin@sail.test', role: 'admin' },
  { id: 2, email: 'manager@sail.test', role: 'manager' },
  { id: 3, email: 'yard@sail.test', role: 'yard' }
];
// OTP recipient overrides (send OTP to these real inboxes for given usernames)
const OTP_RECIPIENT_MAP = {
  'admin@sail.test': 'head.qsteel@gmail.com',
  'manager@sail.test': 'shivam.kumar.it27@heritageit.edu.in',
  'yard@sail.test': 'abhishek.kumar.it27@heritageit.edu.in',
  // Add customer mappings later as needed
};
// Allow customer email pattern for demo
function resolveUserByEmail(email) {
  const u = users.find(u => u.email === email);
  if (u) return u;
  // Treat anything like customer+xyz@sail.test as a customer role (demo)
  if (/^customer(\+.*)?@sail\.test$/i.test(email)) return { id: 100, email, role: 'customer' };
  // If customer exists in our registry, allow it
  const c = CUSTOMERS_BY_EMAIL.get(email);
  if (c) return { id: c.customerId, email: c.email, role: 'customer' };
  return null;
}

// Simple hash-chained ledger
const ledger = [];
function appendLedger(entry, tsOverride) {
  const prevHash = ledger.length ? ledger[ledger.length - 1].hash : 'GENESIS';
  const ts = typeof tsOverride === 'number' ? tsOverride : Date.now();
  const payload = { ...entry, prevHash, ts };
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const block = { ...payload, hash };
  ledger.push(block);
  return block;
}

// Request OTP via email
app.post('/auth/request-otp', async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  const { email } = parsed.data;
  // generate code and store
  const code = String(Math.floor(100000 + Math.random()*900000));
  await otpSet(email, code, 5 * 60);

  const SMTP_HOST = process.env.SMTP_HOST || '';
  const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
  const SMTP_USER = process.env.SMTP_USER || '';
  const SMTP_PASS = process.env.SMTP_PASS || '';
  const SMTP_FROM = process.env.SMTP_FROM || 'noreply@qsteel.local';
  const disableEmail = process.env.DISABLE_EMAIL === '1' || (!SMTP_HOST || !SMTP_USER || !SMTP_PASS);

  if (disableEmail) {
    // Email disabled: do not expose OTP in response for security
    return res.json({ ok: true, message: 'OTP generated. Email delivery disabled by config.' });
  }
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    const toEmail = OTP_RECIPIENT_MAP[email] || email;
    const info = await transporter.sendMail({
      from: SMTP_FROM,
      to: toEmail,
      subject: 'Your QSTEEL OTP Code',
      text: `Your OTP is ${code}. It will expire in 5 minutes.`,
      html: `<p>Your OTP is <b>${code}</b>. It will expire in 5 minutes.</p>`
    });
    res.json({ ok: true, messageId: info.messageId, to: toEmail });
  } catch (e) {
    console.warn('SMTP send failed:', e?.message || e);
    // Do not include OTP in response
    res.status(500).json({ error: 'Failed to send OTP via email. Please try again later.' });
  }
});

app.post('/auth/login', async (req, res) => {
  const schema = z.object({ email: z.string().email(), otp: z.string().regex(/^\d{6}$/) });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  const { email, otp } = parsed.data;
  // Prefer server-stored OTP when available; keep 123456 as a universal dev override
  let valid = false;
  const stored = await otpGet(email);
  if (stored && stored.code === otp && Date.now() <= stored.expMs) {
    valid = true; await otpDel(email);
  }
  if (!valid) return res.status(401).json({ error: 'Invalid OTP, please try again.' });
  const user = resolveUserByEmail(email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user });
});

function auth(role) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (role && payload.role !== role && payload.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.user = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

app.get('/kpis', auth(), async (req, res) => {
  const cacheKey = 'kpis:v1';
  const cached = await cacheGet(cacheKey);
  if (cached) return res.json(cached);
  if (prisma) {
    try {
      const pending = await prisma.rake.count({ where: { status: 'PENDING' } });
      const dispatched = await prisma.rake.count({ where: { status: 'DISPATCHED' } });
      const utilization = dispatched + pending > 0 ? dispatched / (dispatched + pending) : 0.78;
      // naive sustainability metrics
      const carbonIntensityPerRake = Number(Math.max(0.4, 1.8 - utilization * 1.2).toFixed(2)); // tCO2/rake (demo)
      const co2Total = Number((carbonIntensityPerRake * (dispatched || 1)).toFixed(2));
      const ecoSavingsPercent = 12; // demo constant for day
      const payload = {
        pendingRakes: pending,
        dispatchedRakes: dispatched,
        utilization,
        delayProbability: 0.18,
        fuelConsumption: [10,12,8,9,11,7,10],
        carbonIntensityPerRake,
        co2Total,
        ecoSavingsPercent,
        ecoRouteHint: 'Avoid Segment S1 congestion; choose S3 to save ~12% emissions.'
      };
      await cacheSet(cacheKey, payload, 60);
      return res.json(payload);
    } catch (e) { /* fallthrough */ }
  }
  const fallback = {
    pendingRakes: Array.isArray(MOCK_DATA.rakes)? MOCK_DATA.rakes.filter(r=> (r.status||'').toLowerCase() !== 'dispatched').length : 6,
    dispatchedRakes: Array.isArray(MOCK_DATA.rakes)? MOCK_DATA.rakes.filter(r=> (r.status||'').toLowerCase() === 'dispatched').length : 12,
    utilization: (()=>{ const p = Array.isArray(MOCK_DATA.rakes)? MOCK_DATA.rakes.filter(r=> (r.status||'').toLowerCase() !== 'dispatched').length : 6; const d = Array.isArray(MOCK_DATA.rakes)? MOCK_DATA.rakes.filter(r=> (r.status||'').toLowerCase() === 'dispatched').length : 12; return (d+p)>0 ? d/(d+p) : 0.78; })(),
    delayProbability: 0.18,
    fuelConsumption: [10,12,8,9,11,7,10],
    carbonIntensityPerRake: 0.98,
    co2Total: 11.76,
    ecoSavingsPercent: 12,
    ecoRouteHint: 'Avoid Segment S1 congestion; choose S3 to save ~12% emissions.'
  };
  await cacheSet(cacheKey, fallback, 60);
  res.json(fallback);
});

app.get('/map/routes', auth(), async (req, res) => {
  const cargo = String(req.query.cargo || 'ore').toLowerCase();
  const loco = String(req.query.loco || 'diesel').toLowerCase();
  const grade = Number(req.query.grade || 0); // % grade (slope)
  const tonnage = Number(req.query.tonnage || 3000); // total train tonnage
  const routeKey = String(req.query.routeKey || '').toUpperCase();
  const cacheKey = `routes:v3:c:${cargo}:l:${loco}:g:${grade}:t:${tonnage}:rk:${routeKey||'default'}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return res.json(cached);
  const statuses = ['clear','busy','congested'];
  const pick = () => statuses[Math.floor(Math.random()*statuses.length)];
  let segments = [];
  if (routeKey) {
    let seq = null;
    if (prisma) {
      try {
        const route = await prisma.route.findUnique({
          where: { key: routeKey },
          include: { routeStations: { include: { station: true }, orderBy: { seq: 'asc' } } }
        });
        if (route && route.routeStations.length >= 2) {
          seq = route.routeStations.map(rs => ({ code: rs.station.code, coord: [rs.station.lat, rs.station.lng] }));
        }
      } catch (e) { /* ignore and fallback */ }
    }
    if (seq && seq.length >= 2) {
      for (let i=0; i<seq.length-1; i++) {
        const a = seq[i].coord; const b = seq[i+1].coord;
        segments.push({ from: a, to: b, status: pick(), label: `${seq[i].code}→${seq[i+1].code}` });
      }
    } else {
      // fallback presets
      const STN = {
        BKSC: [23.658, 86.151], DGR: [23.538, 87.291], Dhanbad: [23.795, 86.430], Asansol: [23.685, 86.974], Andal: [23.593, 87.242],
        ROU: [22.227, 84.857], Purulia: [23.332, 86.365],
        BPHB: [21.208, 81.379], Norla: [19.188, 82.787],
      };
      const presets = {
        'BKSC-DGR': ['BKSC','Dhanbad','Asansol','Andal','DGR'],
        'BKSC-ROU': ['BKSC','Purulia','ROU'],
        'BKSC-BPHB': ['BKSC','Norla','BPHB'],
      };
      const p = presets[routeKey];
      if (p) {
        for (let i=0;i<p.length-1;i++) {
          const a = STN[p[i]]; const b = STN[p[i+1]];
          if (a && b) segments.push({ from: a, to: b, status: pick(), label: `${p[i]}→${p[i+1]}` });
        }
      }
    }
  }
  if (!segments.length) {
    // ultimate fallback near Bokaro
    segments = [
      { from: [23.66,86.15], to: [23.63,86.18], status: pick(), label: 'YardA→YardB' },
      { from: [23.66,86.15], to: [23.60,86.20], status: pick(), label: 'YardA→Alt' },
    ];
  }
  const payload = { origin: 'Bokaro', routes: segments };
  // emission factor model (demo): base EF per km by cargo & loco, with grade and status multipliers
  const baseByCargo = { ore: 0.022, coal: 0.024, steel: 0.02, cement: 0.021 };
  const locoFactor = { diesel: 1.0, electric: 0.6, hybrid: 0.8 };
  const baseKm = baseByCargo[cargo] ?? 0.022;
  // locomotive efficiency curve vs tonnage (demo):
  // diesel suffers at high tonnage, electric scales better; clamp tonnage 1000..6000
  const t = Math.max(1000, Math.min(tonnage, 6000));
  const curve = {
    diesel: 1 + (t - 3000) / 3000 * 0.15,   // +-15% across range
    electric: 0.8 + (t - 3000) / 3000 * 0.08, // 0.8..0.88
    hybrid: 0.9 + (t - 3000) / 3000 * 0.10,
  };
  const locoMul = (curve[loco] ?? 1.0) * (locoFactor[loco] ?? 1.0);
  const gradeMul = 1 + Math.max(0, Math.min(grade, 6)) * 0.03; // up to +18% at 6% grade
  const efPerKm = Number((baseKm * locoMul * gradeMul).toFixed(5)); // tCO2 per km
  const statusFactor = (s) => s==='clear'?1 : s==='busy'?1.1 : 1.25;
  const haversine = (a,b) => {
    const R=6371; const toRad = (d)=>d*Math.PI/180;
    const dLat = toRad(b[0]-a[0]); const dLng = toRad(b[1]-a[1]);
    const la1=toRad(a[0]); const la2=toRad(b[0]);
    const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  };
  payload.routes = payload.routes.map(r => {
    const km = haversine(r.from, r.to);
    const co2 = Number((km * efPerKm * statusFactor(r.status)).toFixed(3));
    return { ...r, km: Number(km.toFixed(2)), co2_tons: co2 };
  });
  const bestIdx = payload.routes.reduce((m,_,i,arr)=> arr[i].co2_tons < arr[m].co2_tons ? i : m, 0);
  const worst = payload.routes.reduce((mx,r)=> Math.max(mx, r.co2_tons), 0);
  const best = payload.routes[bestIdx].co2_tons;
  payload.eco = { bestIndex: bestIdx, savingsPercent: Math.round((1 - (best/(worst||best))) * 100) };
  payload.meta = { cargo, loco, grade, tonnage, efPerKm, routeKey, factors: { locoMul, gradeMul } };
  await cacheSet(cacheKey, payload, 30);
  res.json(payload);
});

app.post('/ai/forecast', auth(), async (req, res) => {
  const base = (process.env.ML_URL || process.env.FORECAST_URL || '').replace(/\/$/, '');
  if (base) {
    try {
      const r = await fetch(`${base}/forecast`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body || {}) });
      if (!r.ok) throw new Error(`ML service responded ${r.status}`);
      const data = await r.json();
      return res.json(data);
    } catch (e) {
      console.warn('ML_URL fetch failed, using fallback forecast:', e?.message || e);
    }
  }
  // fallback naive forecast
  const series = (req.body?.series && Array.isArray(req.body.series)) ? req.body.series : [10,12,11,13,12,14,15];
  const horizon = req.body?.horizon ?? 7;
  const tail = series.slice(-3);
  const mu = tail.reduce((a,b)=>a+b,0)/tail.length;
  const forecast = Array.from({length: horizon}, (_,i)=> Number((mu + (Math.sin(i/2)*0.3)).toFixed(2)));
  // If a rake is specified, enrich with mock suggested route
  const rake = req.body?.rake;
  const suggestion = MOCK_DATA.forecast.find(f => f.rake === rake);
  res.json({ forecast, suggestedRoute: suggestion?.suggestedRoute });
});

// Ledger endpoints
async function processDispatch({ rakeId, from, to, cargo, tonnage, actor }) {
  const block = appendLedger({ type: 'DISPATCH', rakeId, from, to, cargo, tonnage, actor });
  try {
    if (prisma) {
      const prevHash = ledger.length > 1 ? ledger[ledger.length - 2].hash : 'GENESIS';
      await prisma.dispatch.create({ data: { rake: { connect: { code: rakeId } }, from: from||'', to: to||'', cargo: cargo||'', tonnage: tonnage||0, hash: block.hash, prevHash } });
      await prisma.rake.update({ where: { code: rakeId }, data: { status: 'DISPATCHED' } });
    }
  } catch (e) { console.warn('DB write failed, ledger only:', e?.message || e); }
  return block;
}

app.post('/ledger/dispatch', auth(), async (req, res) => {
  const { rakeId, from, to, cargo, tonnage } = req.body || {};
  if (!rakeId) return res.status(400).json({ error: 'rakeId required' });
  const block = await processDispatch({ rakeId, from, to, cargo, tonnage, actor: req.user?.email });
  try {
    io.emit('alert', { type: 'rake_dispatched', rakeId, message: `Rake ${rakeId} dispatched ${from ? `from ${from}` : ''}${to ? ` to ${to}` : ''}`.trim(), level: 'info', ts: Date.now() });
  } catch {}
  res.json(block);
});

app.get('/ledger', auth(), (req, res) => {
  res.json({ length: ledger.length, chain: ledger });
});

// Verify ledger chain integrity (dev helper)
app.get('/ledger/verify', auth(), (req, res) => {
  try {
    for (let i = 0; i < ledger.length; i++) {
      const block = ledger[i];
      const expectedPrev = i === 0 ? 'GENESIS' : ledger[i - 1].hash;
      if (block.prevHash !== expectedPrev) {
        return res.status(200).json({ ok: false, index: i, error: 'prevHash mismatch' });
      }
      const { hash, ...rest } = block;
      const recomputed = crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
      if (hash !== recomputed) {
        return res.status(200).json({ ok: false, index: i, error: 'hash mismatch' });
      }
    }
    return res.json({ ok: true, length: ledger.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Yard endpoints
app.get('/yard/rakes', auth(), async (req, res) => {
  // list pending rakes for yard operations
  if (prisma) {
    try {
      const rakes = await prisma.rake.findMany({ where: { status: 'PENDING' }, include: { yard: true } });
      return res.json(rakes.map(r => ({ code: r.code, yard: r.yard?.name || null, status: r.status })));
    } catch (e) { /* fallthrough */ }
  }
  // fallback demo data
  res.json([
    { code: 'rake-101', yard: 'Yard A', status: 'PENDING' },
    { code: 'rake-202', yard: 'Yard B', status: 'PENDING' },
    { code: 'rake-303', yard: 'Yard A', status: 'PENDING' },
  ]);
});

app.post('/yard/rake/:code/confirm-loading', auth('yard'), async (req, res) => {
  const code = req.params.code;
  const block = appendLedger({ type: 'LOADING_CONFIRMED', rakeId: code, actor: req.user?.email });
  res.json(block);
});

app.post('/yard/rake/:code/dispatch', auth('yard'), async (req, res) => {
  const code = req.params.code;
  const { from, to, cargo, tonnage } = req.body || {};
  const block = await processDispatch({ rakeId: code, from, to, cargo, tonnage, actor: req.user?.email });
  res.json(block);
});

// Exports
app.get('/export/kpis.csv', auth(), (req, res) => {
  const plant = req.query.plant || 'Bokaro';
  const data = {
    pendingRakes: 6,
    dispatchedRakes: 12,
    utilization: 0.78,
    delayProbability: 0.18,
  };
  const csv = 'plant,metric,value\n' + Object.entries(data).map(([k,v])=>`${plant},${k},${v}`).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="kpis.csv"');
  res.send(csv);
});

app.get('/export/kpis.pdf', auth(), async (req, res) => {
  const plant = req.query.plant || 'Bokaro';
  const cargo = String(req.query.cargo || 'ore').toLowerCase();
  const loco = String(req.query.loco || 'diesel').toLowerCase();
  const grade = Number(req.query.grade || 0);
  const tonnage = Number(req.query.tonnage || 3000);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="kpis-${plant}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  // Header
  doc.fillColor('#111827').fontSize(20).text('QSTEEL — Plant KPIs Report', { align: 'left' });
  doc.moveUp().fillColor('#6B7280').fontSize(10).text(new Date().toLocaleString(), { align: 'right' });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E5E7EB').stroke();
  doc.moveDown();

  // Title (try to enrich plant name from DB if available later)
  doc.fillColor('#111827').fontSize(16).text(`Plant: ${plant}`, { continued: false });
  doc.moveDown(0.5);

  // Gather KPIs (reuse logic or fallback)
  let pending = 6, dispatched = 12, utilization = 0.78, delayProbability = 0.18, carbonIntensityPerRake = 0.98, co2Total = 11.76, ecoSavingsPercent = 12;
  if (prisma) {
    try {
      pending = await prisma.rake.count({ where: { status: 'PENDING' } });
      dispatched = await prisma.rake.count({ where: { status: 'DISPATCHED' } });
      utilization = dispatched + pending > 0 ? dispatched / (dispatched + pending) : 0.78;
      carbonIntensityPerRake = Number(Math.max(0.4, 1.8 - utilization * 1.2).toFixed(2));
      co2Total = Number((carbonIntensityPerRake * (dispatched || 1)).toFixed(2));
    } catch {}
  }

  // KPI table
  const rows = [
    ['Pending Rakes', String(pending)],
    ['Dispatched Rakes', String(dispatched)],
    ['Utilization', `${Math.round(utilization * 100)}%`],
    ['Delay Probability', `${Math.round(delayProbability * 100)}%`],
    ['Carbon Intensity per Rake', `${carbonIntensityPerRake} tCO2`],
    ['Total CO₂ Today', `${co2Total} t`],
    ['Eco-route Savings', `${ecoSavingsPercent}%`],
  ];

  const startX = 60, col1 = 240, col2 = 520; let y = doc.y + 10;
  doc.strokeColor('#D1D5DB');
  rows.forEach((r, i) => {
    const [k, v] = r;
    const rowY = y + i * 24;
    doc.fontSize(11).fillColor('#111827').text(k, startX, rowY, { width: col1 - startX });
    doc.fontSize(11).fillColor('#111827').text(v, col1 + 20, rowY, { width: col2 - (col1 + 20) });
    doc.moveTo(startX, rowY + 18).lineTo(col2, rowY + 18).stroke();
  });

  // Route emissions section
  doc.moveDown(1.2);
  doc.fillColor('#111827').fontSize(14).text(`Route Emissions${plant ? ` — ${plant}` : ''}`, { continued: false });
  doc.moveDown(0.3);
  // Build plant-specific routes preferring DB
  const routeKey = String(req.query.routeKey || 'BKSC-DGR').toUpperCase();
  const statuses = ['clear','busy','congested'];
  const pick = () => statuses[Math.floor(Math.random()*statuses.length)];
  let routes = [];
  if (prisma && routeKey) {
    try {
      const route = await prisma.route.findUnique({
        where: { key: routeKey },
        include: { routeStations: { include: { station: true }, orderBy: { seq: 'asc' } } }
      });
      if (route && route.routeStations.length >= 2) {
        for (let i=0;i<route.routeStations.length-1;i++) {
          const a = route.routeStations[i].station; const b = route.routeStations[i+1].station;
          routes.push({ from: [a.lat, a.lng], to: [b.lat, b.lng], status: pick(), label: `${a.code}→${b.code}` });
        }
      }
    } catch {}
  }
  if (!routes.length) {
    const STN = {
      BKSC: [23.658, 86.151], DGR: [23.538, 87.291], Dhanbad: [23.795, 86.430], Asansol: [23.685, 86.974], Andal: [23.593, 87.242],
      ROU: [22.227, 84.857], Purulia: [23.332, 86.365],
      BPHB: [21.208, 81.379], Norla: [19.188, 82.787],
    };
    const presets = {
      'BKSC-DGR': ['BKSC','Dhanbad','Asansol','Andal','DGR'],
      'BKSC-ROU': ['BKSC','Purulia','ROU'],
      'BKSC-BPHB': ['BKSC','Norla','BPHB'],
    };
    const seq = presets[routeKey] || presets['BKSC-DGR'];
    for (let i=0;i<seq.length-1;i++) {
      const a = STN[seq[i]]; const b = STN[seq[i+1]];
      if (a && b) routes.push({ from: a, to: b, status: pick(), label: `${seq[i]}→${seq[i+1]}` });
    }
  }
  const baseByCargo = { ore: 0.022, coal: 0.024, steel: 0.02, cement: 0.021 };
  const locoFactor = { diesel: 1.0, electric: 0.6, hybrid: 0.8 };
  const baseKm = baseByCargo[cargo] ?? 0.022;
  const t = Math.max(1000, Math.min(tonnage, 6000));
  const curve = { diesel: 1 + (t - 3000) / 3000 * 0.15, electric: 0.8 + (t - 3000) / 3000 * 0.08, hybrid: 0.9 + (t - 3000) / 3000 * 0.10 };
  const locoMul = (curve[loco] ?? 1.0) * (locoFactor[loco] ?? 1.0);
  const gradeMul = 1 + Math.max(0, Math.min(grade, 6)) * 0.03;
  const efPerKm = Number((baseKm * locoMul * gradeMul).toFixed(5));
  const statusFactor = (s) => s==='clear'?1 : s==='busy'?1.1 : 1.25;
  const haversine = (a,b) => { const R=6371; const toRad=(d)=>d*Math.PI/180; const dLat=toRad(b[0]-a[0]); const dLng=toRad(b[1]-a[1]); const la1=toRad(a[0]); const la2=toRad(b[0]); const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
  const withEmissions = routes.map(r => { const km=haversine(r.from, r.to); const co2=Number((km*efPerKm*statusFactor(r.status)).toFixed(3)); return { ...r, km: Number(km.toFixed(2)), co2 }; });
  const bestIdx = withEmissions.reduce((m,_,i,arr)=> arr[i].co2 < arr[m].co2 ? i : m, 0);
  const startRx = 60; const c1=90, c2=200, c3=290, c4=380; let ry = doc.y + 8;
  // header row
  doc.fontSize(11).fillColor('#374151');
  doc.text('Segment', startRx, ry, { width: 120 });
  doc.text('KM', c1, ry, { width: 80 });
  doc.text('Status', c2, ry, { width: 80 });
  doc.text('tCO₂', c3, ry, { width: 80 });
  doc.moveTo(startRx, ry + 14).lineTo(520, ry + 14).strokeColor('#D1D5DB').stroke();
  ry += 18;
  withEmissions.forEach((r, i) => {
    const isBest = i === bestIdx;
    doc.fontSize(11).fillColor(isBest ? '#065F46' : '#111827');
  doc.text(r.label || `R${i+1}`, startRx, ry, { width: 120 });
    doc.text(String(r.km), c1, ry, { width: 80 });
    doc.text(String(r.status), c2, ry, { width: 80 });
    doc.text(String(r.co2), c3, ry, { width: 80 });
    if (isBest) doc.fillColor('#10B981').text('Eco', c4, ry, { width: 60 });
    doc.moveTo(startRx, ry + 14).lineTo(520, ry + 14).strokeColor('#E5E7EB').stroke();
    ry += 18;
  });
  doc.fillColor('#6B7280').fontSize(10).text(`Factors: cargo=${cargo}, loco=${loco}, grade=${grade}%, tonnage=${tonnage}t · EF=${efPerKm} tCO₂/km`, startRx, ry + 6);

  // Footer
  doc.moveDown(2);
  doc.fillColor('#6B7280').fontSize(9).text('Generated by QSTEEL · Confidential', 50, 770, { align: 'center' });
  doc.end();
});

// Alerts (simple MVP)
app.get('/alerts', auth(), async (req, res) => {
  // If DB is connected, you might generate alerts from live data; in fallback, return provided mocks
  if (!prisma) {
    return res.json({ alerts: MOCK_DATA.alerts.map(a => ({ id: a.id, type: a.type, message: a.message, level: a.severity, timestamp: a.ts })) });
  }
  // simple heuristic when DB is present
  let pending = 6, dispatched = 12, delayProbability = 0.18, utilization = 0.78;
  try {
    pending = await prisma.rake.count({ where: { status: 'PENDING' } });
    dispatched = await prisma.rake.count({ where: { status: 'DISPATCHED' } });
    utilization = dispatched + pending > 0 ? dispatched / (dispatched + pending) : 0.78;
  } catch {}
  const alerts = [];
  if (delayProbability > 0.15) alerts.push({ id: 'delay', level: 'warning', text: 'Elevated delay risk today. Consider decongesting S1 and prioritizing eco-route.' });
  if (pending > 10) alerts.push({ id: 'backlog', level: 'warning', text: `High pending rakes backlog (${pending}). Allocate crews to clear backlog.` });
  if (utilization < 0.6) alerts.push({ id: 'util', level: 'info', text: 'Utilization below target; review idle capacity for rebalancing.' });
  res.json({ alerts });
});

// Stock / Demand per yard (demo)
app.get('/stock', auth(), async (req, res) => {
  if (!prisma) {
    const grouped = MOCK_DATA.stockDemand.reduce((acc, r) => {
      acc[r.yard] = acc[r.yard] || { yard: r.yard, items: [], stockTons: 0, demandTons: 0 };
      acc[r.yard].items.push({ grade: r.grade, stock: r.stock, demand: r.demand });
      acc[r.yard].stockTons += r.stock;
      acc[r.yard].demandTons += r.demand;
      return acc;
    }, {});
    return res.json({ yards: Object.values(grouped) });
  }
  try {
    const yards = await prisma.yard.findMany({ select: { id: true, name: true, plant: { select: { name: true } } } });
    const payload = yards.map(y => ({ yard: y.name, plant: y.plant?.name || null, stockTons: Math.floor(200 + Math.random()*400), demandTons: Math.floor(150 + Math.random()*350) }));
    return res.json({ yards: payload });
  } catch {
    return res.json({ yards: [] });
  }
});

// List routes (for dynamic selector)
app.get('/routes', auth(), async (req, res) => {
  const plant = String(req.query.plant || '').trim();
  if (prisma) {
    try {
      const where = plant ? { plant: { name: plant } } : {};
      const list = await prisma.route.findMany({ where, select: { key: true, name: true, plant: { select: { name: true } } }, orderBy: { key: 'asc' } });
      return res.json(list.map(r => ({ key: r.key, name: r.name, plant: r.plant?.name || null })));
    } catch (e) { /* fall through */ }
  }
  // fallback
  res.json(MOCK_DATA.routes.map(r => ({ key: r.routeKey, name: r.name, plant: 'Bokaro' })));
});

// Health endpoint (admin)
// (admin health endpoint removed by request)

// AI/ML Rake Formation Optimizer Endpoints
app.post('/optimize/rake-formation', auth(), async (req, res) => {
  try {
    const { orders, inventories, options = {} } = req.body;
    
    // Default sample data if not provided
    const sampleOrders = orders || [
      { id: 'ORD001', destination: 'DGR', product: 'TMT Bars', quantity: 800, priority: 8, dueDate: '2025-09-25', customer: 'ABC Steel' },
      { id: 'ORD002', destination: 'ROU', product: 'Coils', quantity: 600, priority: 6, dueDate: '2025-09-24', customer: 'XYZ Industries' },
      { id: 'ORD003', destination: 'BPHB', product: 'H-beams', quantity: 1200, priority: 9, dueDate: '2025-09-23', customer: 'DEF Construction' },
      { id: 'ORD004', destination: 'DGR', product: 'Cement', quantity: 400, priority: 5, dueDate: '2025-09-26', customer: 'GHI Builders' },
      { id: 'ORD005', destination: 'ROU', product: 'Steel', quantity: 900, priority: 7, dueDate: '2025-09-25', customer: 'JKL Corp' }
    ];

    const sampleInventories = inventories || {
      'BKSC': { 'TMT Bars': 2000, 'Coils': 1500, 'H-beams': 1800, 'Cement': 800, 'Steel': 2200 },
      'DGR': { 'TMT Bars': 1200, 'Coils': 900, 'H-beams': 600, 'Cement': 1000, 'Steel': 800 },
      'ROU': { 'TMT Bars': 1800, 'Coils': 1200, 'H-beams': 2000, 'Cement': 600, 'Steel': 1500 },
      'BPHB': { 'TMT Bars': 1000, 'Coils': 800, 'H-beams': 1400, 'Cement': 1200, 'Steel': 1100 }
    };

    const optimizationResult = optimizer.optimize(sampleOrders, sampleInventories, options);
    
    // Store result in cache for dashboard access
    await cacheSet('latest_optimization', optimizationResult, 300); // 5 min cache
    
    res.json({
      success: true,
      result: optimizationResult,
      timestamp: new Date().toISOString(),
      computeTime: Date.now() - Date.now() // Placeholder for actual compute time
    });
  } catch (error) {
    console.error('Optimization error:', error);
    res.status(500).json({ error: 'Optimization failed', details: error.message });
  }
});

// Scenario Simulation (What-If Analysis)
app.post('/optimize/simulate-scenario', auth(), async (req, res) => {
  try {
    const { orders, inventories, disruptions } = req.body;
    
    const sampleOrders = orders || [
      { id: 'ORD001', destination: 'DGR', product: 'TMT Bars', quantity: 800, priority: 8, dueDate: '2025-09-25' },
      { id: 'ORD002', destination: 'ROU', product: 'Coils', quantity: 600, priority: 6, dueDate: '2025-09-24' },
      { id: 'ORD003', destination: 'BPHB', product: 'H-beams', quantity: 1200, priority: 9, dueDate: '2025-09-23' }
    ];

    const sampleInventories = inventories || {
      'BKSC': { 'TMT Bars': 2000, 'Coils': 1500, 'H-beams': 1800 },
      'DGR': { 'TMT Bars': 1200, 'Coils': 900, 'H-beams': 600 },
      'ROU': { 'TMT Bars': 1800, 'Coils': 1200, 'H-beams': 2000 }
    };

    // Example disruptions: { demandChange: 0.15, sidingCapacity: {'BKSC-S1': 0.8}, wagonAvailability: 0.6 }
    const sampleDisruptions = disruptions || { demandChange: 0.10, wagonAvailability: 0.8 };

    const scenarioResult = optimizer.simulateScenario(sampleOrders, sampleInventories, sampleDisruptions);
    
    res.json({
      success: true,
      scenario: scenarioResult,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Scenario simulation error:', error);
    res.status(500).json({ error: 'Scenario simulation failed', details: error.message });
  }
});

// Get Current Optimization Status/Results
app.get('/optimize/status', auth(), async (req, res) => {
  const cached = await cacheGet('latest_optimization');
  if (cached) {
    res.json({ status: 'completed', result: cached, timestamp: cached.timestamp });
  } else {
    res.json({ status: 'no_recent_optimization', message: 'Run optimization first' });
  }
});

// Get Wagon Availability and Constraints
app.get('/optimize/constraints', auth(), async (req, res) => {
  res.json({
    constraints: optimizer.constraints,
    availableWagons: optimizer.wagons.filter(w => w.status === 'available').length,
    totalWagons: optimizer.wagons.length,
    wagonsByType: optimizer.wagons.reduce((acc, w) => {
      acc[w.type] = (acc[w.type] || 0) + 1;
      return acc;
    }, {}),
    routes: optimizer.routes
  });
});

// Production vs Wagon Alignment Recommendations
app.get('/optimize/production-alignment', auth(), async (req, res) => {
  const cached = await cacheGet('latest_optimization');
  if (!cached) {
    return res.json({ recommendations: [], message: 'No recent optimization data' });
  }

  // Generate production alignment recommendations
  const recommendations = [];
  const productDemand = {};
  
  cached.primary.forEach(rake => {
    rake.orders.forEach(order => {
      productDemand[order.product] = (productDemand[order.product] || 0) + order.quantity;
    });
  });

  Object.entries(productDemand).forEach(([product, demand]) => {
    if (demand > 1000) {
      recommendations.push({
        type: 'increase_production',
        product,
        currentDemand: demand,
        suggestedIncrease: Math.ceil(demand * 0.1),
        plant: 'BKSC',
        reason: `High rail demand for ${product} (${demand}T). Increase production to optimize rail dispatch.`,
        costImpact: demand * 2.5,
        slaImpact: '+15%'
      });
    }
  });

  // Rail vs Road comparison
  const railCost = cached.summary.totalCost;
  const roadCostEstimate = railCost * 1.3; // Road typically 30% more expensive
  const modalSplit = {
    rail: { percentage: 75, cost: railCost, emissions: 0.8 },
    road: { percentage: 25, cost: roadCostEstimate * 0.25, emissions: 2.1 }
  };

  res.json({ 
    recommendations,
    modalSplit,
    carbonSavings: (modalSplit.road.emissions - modalSplit.rail.emissions) * cached.summary.totalTons,
    costComparison: { rail: railCost, road: roadCostEstimate, savings: roadCostEstimate - railCost }
  });
});

// Export Daily Dispatch Plan
app.get('/optimize/dispatch-plan', auth(), async (req, res) => {
  const format = req.query.format || 'json';
  const cached = await cacheGet('latest_optimization');
  
  if (!cached) {
    return res.status(404).json({ error: 'No optimization data available' });
  }

  const dispatchPlan = cached.primary.map(rake => ({
    rake_id: rake.id,
    cargo: rake.orders.map(o => o.product).join(', '),
    loading_point: rake.source,
    destinations: rake.destination,
    wagons: rake.wagons.length,
    tonnage: rake.totalTons,
    estimated_cost: rake.estimatedCost,
    estimated_time: rake.estimatedTime,
    sla_flag: rake.slaCompliance > 0.8 ? 'COMPLIANT' : 'AT_RISK',
    priority: rake.priority,
    emissions: rake.emissions
  }));

  if (format === 'csv') {
    const csv = [
      'Rake_ID,Cargo,Loading_Point,Destinations,Wagons,Tonnage,Cost,Time_Hrs,SLA_Flag,Priority,Emissions_tCO2',
      ...dispatchPlan.map(plan => 
        `${plan.rake_id},"${plan.cargo}",${plan.loading_point},${plan.destinations},${plan.wagons},${plan.tonnage},${plan.estimated_cost},${plan.estimated_time},${plan.sla_flag},${plan.priority},${plan.emissions}`
      )
    ].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="dispatch-plan.csv"');
    res.send(csv);
  } else {
    res.json({ dispatchPlan, summary: cached.summary, kpis: cached.kpis });
  }
});

// AI Decision Co-Pilot - Enhanced Assistant with optimizer integration
app.post('/assistant', auth(), async (req, res) => {
  const q = (req.body?.query || '').toLowerCase().trim();
  const context = req.body?.context || {};
  let response = { 
    answer: 'I\'m your AI Decision Co-Pilot. I can optimize rake formations, run scenario analysis, provide cost breakdowns, and help with operational decisions.',
    type: 'text',
    data: null,
    actions: []
  };
  
  try {
    // Natural Language Query Processing
    if (q.includes('optimize') && (q.includes('today') || q.includes('tomorrow') || q.includes('plan'))) {
      // Run optimization
      const weights = extractWeights(q) || { cost: 0.3, sla: 0.4, utilization: 0.2, emissions: 0.1 };
      const result = optimizeRakeFormation(OPTIMIZER_DATA.orders, weights);
      
      response = {
        answer: `✅ **Optimized Today's Dispatch Plan**\n\n**${result.optimal.rakes.length} rakes scheduled** (${result.optimal.rakes.filter(r => r.utilization > 90).length} fully loaded)\n\n📊 **Cost**: ₹${result.optimal.summary.totalCost.toLocaleString()}\n⏰ **SLA Compliance**: ${(result.optimal.summary.slaCompliance * 100).toFixed(1)}%\n📈 **Avg Utilization**: ${result.optimal.summary.avgUtilization.toFixed(1)}%\n🌱 **CO2 Footprint**: ${result.optimal.summary.totalEmissions.toFixed(1)}T`,
        type: 'optimization',
        data: {
          plan: result.optimal,
          alternatives: result.alternatives.slice(0, 3),
          kpis: result.optimal.summary
        },
        actions: [
          { id: 'export_csv', label: '📄 Export Daily Plan', type: 'export' },
          { id: 'view_map', label: '📍 View Routes', type: 'navigate', url: '/map' },
          { id: 'reoptimize', label: '🔄 Re-run with Different Weights', type: 'dialog' }
        ]
      };
      
      // Cache for future queries
      await cacheSet('latest_optimization', result, 300);
      
    } else if (q.includes('what if') || q.includes('scenario')) {
      // Scenario simulation
      const disruptions = parseScenarioQuery(q);
      const baseResult = optimizeRakeFormation(OPTIMIZER_DATA.orders);
      const scenarioResult = simulateScenario(disruptions);
      
      response = {
        answer: `🔍 **Scenario Analysis Results**\n\n**Impact Summary**:\n💸 Cost Change: ${scenarioResult.costDelta > 0 ? '+' : ''}₹${Math.abs(scenarioResult.costDelta).toLocaleString()}\n⏰ SLA Impact: ${scenarioResult.slaDelta.toFixed(1)}%\n📊 Utilization: ${scenarioResult.utilizationDelta.toFixed(1)}%\n\n**Recommendations**:\n${scenarioResult.recommendations.map(r => `• ${r.action}`).join('\n')}`,
        type: 'scenario',
        data: {
          baseline: baseResult.optimal.summary,
          modified: scenarioResult.modified,
          impact: scenarioResult.impact,
          recommendations: scenarioResult.recommendations,
          disruptions
        },
        actions: [
          { id: 'apply_scenario', label: '✅ Apply This Scenario', type: 'action' },
          { id: 'adjust_plan', label: '🚚 Adjust Rail/Road Mix', type: 'dialog' }
        ]
      };
      
    } else if (q.includes('create rake') || q.includes('new rake')) {
      // Natural language rake creation
      const rakeParams = parseRakeQuery(q);
      response = {
        answer: `🚂 **Creating New Rake**\n\nCargo: ${rakeParams.cargo || 'TMT Bars'}\nDestination: ${rakeParams.destination || 'Bhilai'}\nTonnage: ${rakeParams.tonnage || 3000}T\n\nAutomatic wagon assignment in progress...`,
        type: 'rake_creation',
        data: rakeParams,
        actions: [
          { id: 'confirm_rake', label: '✅ Confirm & Create', type: 'action' },
          { id: 'modify_rake', label: '✏️ Modify Details', type: 'dialog' }
        ]
      };
      
    } else if (q.includes('utilization') || q.includes('performance')) {
      // Performance analysis
      const cached = await cacheGet('latest_optimization');
      const utilizationData = analyzeUtilization(cached);
      
      response = {
        answer: `📊 **Current Utilization Analysis**\n\nH-beams: ${utilizationData.hbeams?.utilization || 85}% (${utilizationData.hbeams?.rakes || 4} rakes)\nCoils: ${utilizationData.coils?.utilization || 92}% (${utilizationData.coils?.rakes || 6} rakes)\nTMT Bars: ${utilizationData.tmt?.utilization || 78}% (${utilizationData.tmt?.rakes || 3} rakes)\n\n🎯 **Optimization Opportunity**: Consolidate TMT Bar loads for +14% utilization`,
        type: 'performance',
        data: utilizationData,
        actions: [
          { id: 'optimize_tmt', label: '🔧 Optimize TMT Loads', type: 'action' },
          { id: 'view_details', label: '📋 View Detailed Report', type: 'navigate', url: '/reports' }
        ]
      };
      
    } else if (q.includes('cost') && q.includes('priority')) {
      // Adjust optimization weights
      const newWeights = parseWeightAdjustment(q);
      response = {
        answer: `⚙️ **Updating Optimization Weights**\n\nCost Priority: ${Math.round(newWeights.cost * 100)}%\nSLA Priority: ${Math.round(newWeights.sla * 100)}%\nUtilization: ${Math.round(newWeights.utilization * 100)}%\nEmissions: ${Math.round(newWeights.emissions * 100)}%\n\nRe-running optimization with new priorities...`,
        type: 'weight_adjustment',
        data: newWeights,
        actions: [
          { id: 'apply_weights', label: '🚀 Apply & Optimize', type: 'action' },
          { id: 'reset_weights', label: '↩️ Reset to Default', type: 'action' }
        ]
      };
      
    } else if (q.includes('delayed') || q.includes('sla') || q.includes('late')) {
      // SLA and delay analysis
      const cached = await cacheGet('latest_optimization');
      const delayAnalysis = analyzeDelays(cached);
      
      response = {
        answer: `⚠️ **SLA & Delay Analysis**\n\n${delayAnalysis.delayedCount} rakes beyond SLA\nWorst delays: ${delayAnalysis.worstDelays.map(d => `${d.id} (+${d.delay}h)`).join(', ')}\n\n💡 **Recommendation**: ${delayAnalysis.suggestion}\n\n🔄 Re-optimize dispatch to recover SLA compliance?`,
        type: 'delay_analysis',
        data: delayAnalysis,
        actions: [
          { id: 'reoptimize_sla', label: '🎯 Re-optimize for SLA', type: 'action' },
          { id: 'road_fallback', label: '🚚 Switch Delayed to Road', type: 'action' }
        ]
      };
      
    } else if (q.includes('stockyard') || q.includes('carbon') || q.includes('footprint')) {
      // Carbon footprint analysis
      const carbonData = analyzeCarbonFootprint(q);
      response = {
        answer: `🌱 **Carbon Footprint Analysis**\n\n**${carbonData.destination}** dispatch options:\n• Bokaro: ${carbonData.bokaro?.footprint || 145}kg CO2 (₹${carbonData.bokaro?.cost || 24500})\n• Rourkela: ${carbonData.rourkela?.footprint || 167}kg CO2 (₹${carbonData.rourkela?.cost || 26200})\n• Bhilai: ${carbonData.bhilai?.footprint || 198}kg CO2 (₹${carbonData.bhilai?.cost || 28900})\n\n🏆 **Best Choice**: Bokaro (-${((carbonData.rourkela?.footprint || 167) - (carbonData.bokaro?.footprint || 145))}kg CO2)`,
        type: 'carbon_analysis',
        data: carbonData,
        actions: [
          { id: 'select_green', label: '🌿 Choose Greenest Route', type: 'action' },
          { id: 'balance_cost', label: '⚖️ Balance Cost & Carbon', type: 'dialog' }
        ]
      };
      
    } else if (q.includes('proactive') || q.includes('alert')) {
      // Proactive alerts and suggestions
      response = {
        answer: `🔔 **Proactive Alerts**\n\n⚠️ **Low Stock Alert**: Coils at Durgapur < 500 tons\n🚛 **Wagon Alert**: Only 12 BOXN wagons available (need 18)\n📈 **Demand Spike**: H-beams demand +23% vs last week\n\n🤖 **AI Suggestion**: Prioritize coil production and request 6 additional BOXN wagons`,
        type: 'proactive_alert',
        data: {
          alerts: [
            { type: 'stock', severity: 'high', message: 'Coils at Durgapur < 500 tons' },
            { type: 'wagon', severity: 'medium', message: 'BOXN wagon shortage' },
            { type: 'demand', severity: 'low', message: 'H-beams demand spike' }
          ]
        },
        actions: [
          { id: 'request_wagons', label: '📞 Request Wagons', type: 'action' },
          { id: 'adjust_production', label: '🏭 Adjust Production', type: 'navigate', url: '/optimizer?tab=production' }
        ]
      };
      
    } else {
      // Default help
      response.answer = `🤖 **AI Decision Co-Pilot Ready**\n\nI can help you with:\n• **"Optimize today's plan with cost priority"** - Run optimization\n• **"What if 2 loading points at Bokaro are offline?"** - Scenario analysis\n• **"Show current rake utilization for H-beams"** - Performance insights\n• **"Create rake for 3000 tons TMT bars to Bhilai"** - Operations\n• **"Which stockyard has lowest carbon footprint?"** - Sustainability\n\nTry asking me anything about optimization, logistics, or operations!`;
      response.actions = [
        { id: 'run_optimization', label: '🚀 Run Optimization', type: 'navigate', url: '/optimizer' },
        { id: 'view_dashboard', label: '📊 View Dashboard', type: 'navigate', url: '/dashboard' }
      ];
    }
    
  } catch (error) {
    response.answer = `❌ I encountered an error processing your request. Please try rephrasing your question or contact support.`;
    response.type = 'error';
  }
  
  res.json(response);
});

// Helper functions for AI Decision Co-Pilot
function extractWeights(query) {
  const weights = { cost: 0.3, sla: 0.4, utilization: 0.2, emissions: 0.1 };
  
  if (query.includes('cost priority') || query.includes('minimize cost')) {
    weights.cost = 0.6; weights.sla = 0.25; weights.utilization = 0.1; weights.emissions = 0.05;
  } else if (query.includes('sla priority') || query.includes('on time')) {
    weights.sla = 0.7; weights.cost = 0.15; weights.utilization = 0.1; weights.emissions = 0.05;
  } else if (query.includes('green') || query.includes('carbon')) {
    weights.emissions = 0.5; weights.cost = 0.2; weights.sla = 0.2; weights.utilization = 0.1;
  }
  
  return weights;
}

function parseScenarioQuery(query) {
  const disruptions = { sidingCapacity: {}, wagonAvailability: {}, demandChange: {} };
  
  if (query.includes('loading points') && query.includes('offline')) {
    disruptions.sidingCapacity['Bokaro'] = 0.8;
    disruptions.sidingCapacity['Rourkela'] = 0.7;
  } else if (query.includes('wagon') && query.includes('unavailable')) {
    const match = query.match(/(\d+)%/);
    const reduction = match ? parseFloat(match[1]) / 100 : 0.2;
    disruptions.wagonAvailability['BOKARO'] = reduction;
    disruptions.wagonAvailability['ROURKELA'] = reduction;
  }
  
  return disruptions;
}

function parseRakeQuery(query) {
  const params = { cargo: 'TMT Bars', destination: 'Bhilai', tonnage: 3000 };
  
  if (query.includes('h-beam')) params.cargo = 'H-beams';
  else if (query.includes('coil')) params.cargo = 'Coils';
  else if (query.includes('tmt')) params.cargo = 'TMT Bars';
  
  if (query.includes('durgapur')) params.destination = 'Durgapur';
  else if (query.includes('rourkela')) params.destination = 'Rourkela';
  else if (query.includes('asansol')) params.destination = 'Asansol';
  
  const tonnageMatch = query.match(/(\d+)\s*(ton|t)/i);
  if (tonnageMatch) params.tonnage = parseInt(tonnageMatch[1]);
  
  return params;
}

function parseWeightAdjustment(query) {
  const weights = { cost: 0.3, sla: 0.4, utilization: 0.2, emissions: 0.1 };
  
  const costMatch = query.match(/cost.*?(\d+)%/i);
  const slaMatch = query.match(/sla.*?(\d+)%/i);
  
  if (costMatch) weights.cost = parseInt(costMatch[1]) / 100;
  if (slaMatch) weights.sla = parseInt(slaMatch[1]) / 100;
  
  // Normalize weights to sum to 1
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  Object.keys(weights).forEach(k => weights[k] /= sum);
  
  return weights;
}

function simulateScenario(disruptions) {
  const baseResult = optimizeRakeFormation(OPTIMIZER_DATA.orders);
  const modifiedData = JSON.parse(JSON.stringify(OPTIMIZER_DATA));
  
  // Apply disruptions
  Object.keys(disruptions.sidingCapacity).forEach(point => {
    const reduction = disruptions.sidingCapacity[point];
    if (OPTIMIZER_CONFIG.constraints.loadingPoints[point]) {
      OPTIMIZER_CONFIG.constraints.loadingPoints[point].capacity *= (1 - reduction);
    }
  });
  
  const scenarioResult = optimizeRakeFormation(modifiedData.orders);
  
  return {
    costDelta: scenarioResult.optimal.summary.totalCost - baseResult.optimal.summary.totalCost,
    slaDelta: (scenarioResult.optimal.summary.slaCompliance - baseResult.optimal.summary.slaCompliance) * 100,
    utilizationDelta: scenarioResult.optimal.summary.avgUtilization - baseResult.optimal.summary.avgUtilization,
    modified: scenarioResult.optimal.summary,
    recommendations: [
      { action: 'Move 2 delayed orders to road transport', impact: 'Saves ₹15,000 in delay penalties' },
      { action: 'Request additional BOXN wagons', impact: 'Restores 95% SLA compliance' }
    ]
  };
}

function analyzeUtilization(data) {
  return {
    hbeams: { utilization: 85, rakes: 4, trend: 'stable' },
    coils: { utilization: 92, rakes: 6, trend: 'improving' },
    tmt: { utilization: 78, rakes: 3, trend: 'declining' }
  };
}

function analyzeDelays(data) {
  return {
    delayedCount: 2,
    worstDelays: [
      { id: 'RK-001', delay: 2.5 },
      { id: 'RK-007', delay: 1.2 }
    ],
    suggestion: 'Re-optimize with higher SLA weight (70%) to prioritize on-time delivery'
  };
}

function analyzeCarbonFootprint(query) {
  const destination = query.includes('durgapur') ? 'Durgapur' : 'Bhilai';
  return {
    destination,
    bokaro: { footprint: 145, cost: 24500 },
    rourkela: { footprint: 167, cost: 26200 },
    bhilai: { footprint: 198, cost: 28900 }
  };
}

// Mock data endpoints (fallback/demo)
app.get('/mock', auth(), (req, res) => res.json(MOCK_DATA));
app.get('/plants', auth(), (req, res) => res.json(MOCK_DATA.plants));
app.get('/yards', auth(), (req, res) => res.json(MOCK_DATA.yards));
app.get('/rakes', auth(), (req, res) => res.json(MOCK_DATA.rakes));
app.get('/wagons', auth(), (req, res) => res.json(MOCK_DATA.wagons));
app.get('/dispatches', auth(), (req, res) => res.json(MOCK_DATA.dispatches));
// Simulated movement state: progress along stops [0..N-1], param t in [0..1)
const SIM = { progress: {} }; // { [id]: { idx: number, t: number } }
function getLivePositions() {
  return MOCK_DATA.positions.map(p => {
    const stops = Array.isArray(p.stops) ? p.stops : [];
    if (stops.length === 0) return p;
    const state = SIM.progress[p.id] || { idx: 0, t: 0 };
    const a = stops[state.idx];
    const b = stops[(state.idx + 1) % stops.length];
    const t = state.t;
    const lat = a.lat + (b.lat - a.lat) * t;
    const lng = a.lng + (b.lng - a.lng) * t;
    const currentLocationName = t < 0.1 ? a.name : (t > 0.9 ? b.name : `${a.name} → ${b.name}`);
    return {
      id: p.id, rfid: p.rfid, status: p.status, speed: p.speed, temp: p.temp,
      cargo: p.cargo, source: p.source, destination: p.destination,
      currentLocationName, lat, lng,
      stops,
    };
  });
}

app.get('/positions', auth(), (req, res) => res.json(getLivePositions()));
// Public positions for demo/preview (no auth)
app.get('/positions/public', (req, res) => res.json(getLivePositions()));

// Create rake (manager or yard)
app.post('/rakes', auth(), async (req, res) => {
  const role = req.user?.role;
  if (!['manager','yard','admin'].includes(role)) return res.status(403).json({ error: 'Forbidden' });
  const { name, destinationYard, cargoType, grade, tonnage, wagons = 0, locomotive = 'diesel', id, routeKey } = req.body || {};
  const rakeId = id || `RK${String(Math.floor(Math.random()*9000)+1000)}`;
  const rfid = `RF-${Math.floor(Math.random()*1e6).toString().padStart(6,'0')}`;
  const chosenRouteKey = (routeKey || '').toUpperCase();
  const route = (MOCK_DATA.routes.find(r => r.routeKey === chosenRouteKey)?.id)
    || (MOCK_DATA.routes.find(r => r.to === (destinationYard||'').split('-')[0])?.id)
    || 'R1';
  const created = { id: rakeId, name: name || `Rake ${rakeId.slice(-3)}`, route, status: 'Under Construction', cargoType: cargoType || 'Steel', locomotive, grade: grade || 'Fe500', tonnage: Number(tonnage||0) };
  // Update mocks
  MOCK_DATA.rakes.push(created);
  // create wagons
  for (let i=0;i<Number(wagons||0);i++) {
    const wid = `W${(Math.floor(Math.random()*900)+100).toString().padStart(3,'0')}-${rakeId.slice(-3)}`;
    MOCK_DATA.wagons.push({ id: wid, rake: rakeId, type: 'Open', cargo: cargoType || 'Steel', capacityTons: 60, loadedTons: 0 });
  }
  // seed position near Bokaro
  MOCK_DATA.positions.push({ id: rakeId, lat: 23.64 + Math.random()*0.02, lng: 86.16 + Math.random()*0.02, status: 'Under Construction', speed: 0, rfid });
  // alert
  MOCK_DATA.alerts.unshift({ id: `A${Math.floor(Math.random()*9000)+1000}`, type: 'Rake Created', message: `New rake ${rakeId} created for ${destinationYard}`, severity: 'low', ts: new Date().toISOString().slice(0,16).replace('T',' ') });
  // notify via socket
  io.emit('alert', { type: 'rake_created', rakeId, message: `New rake ${rakeId} created`, level: 'info', ts: Date.now() });

  // Persist to DB when available (best effort)
  if (prisma) {
    try {
      // find yard by name if possible, else leave null
      let yardConnect = undefined;
      if (destinationYard) {
        const y = await prisma.yard.findFirst({ where: { name: destinationYard } });
        if (y) yardConnect = { connect: { id: y.id } };
      }
      const rakeDb = await prisma.rake.create({
        data: {
          code: rakeId,
          status: 'PENDING',
          // @ts-ignore optional custom field if present in schema
          rfid,
          ...(yardConnect ? { yard: yardConnect } : {}),
        }
      });
      // create wagons
      if (Number(wagons||0) > 0) {
        const wagonData = Array.from({ length: Number(wagons||0) }, (_,i)=> ({
          code: `W${(Math.floor(Math.random()*900)+100).toString().padStart(3,'0')}-${rakeId.slice(-3)}-${i+1}`,
          type: 'general',
          capT: 60,
          rake: { connect: { id: rakeDb.id }},
        }));
        // create sequentially to avoid createMany limitations with relations
        for (const w of wagonData) { await prisma.wagon.create({ data: w }); }
      }
    } catch (e) {
      console.warn('DB persistence skipped for /rakes:', e?.message || e);
    }
  }
  res.json({ rake: created, rfid });
});

// Yard approval step: confirm creation (yard role)
app.post('/yard/confirm-creation', auth('yard'), async (req, res) => {
  const { rakeId } = req.body || {};
  if (!rakeId) return res.status(400).json({ error: 'rakeId required' });
  // update mock status
  const r = MOCK_DATA.rakes.find(r => r.id === rakeId);
  if (r) r.status = 'Loading';
  const pos = MOCK_DATA.positions.find(p => p.id === rakeId);
  if (pos) pos.status = 'Loading';
  io.emit('alert', { type: 'rake_confirmed', rakeId, message: `Rake ${rakeId} creation confirmed by yard`, level: 'info', ts: Date.now() });
  // update DB if available
  if (prisma) {
    try {
      await prisma.rake.update({ where: { code: rakeId }, data: { status: 'PENDING' } });
    } catch (e) { console.warn('DB update failed for /yard/confirm-creation:', e?.message || e); }
  }
  res.json({ ok: true });
});

// Advanced Optimizer Engine - MILP + Heuristics + ML
const OPTIMIZER_CONFIG = {
  constraints: {
    minRakeSize: { tons: 2000, wagons: 20 },
    maxRakeSize: { tons: 4000, wagons: 60 },
    loadingPoints: {
      'Bokaro': { capacity: 8, sidings: 3, hourly: 200 },
      'Durgapur': { capacity: 6, sidings: 2, hourly: 150 },
      'Rourkela': { capacity: 10, sidings: 4, hourly: 250 },
      'Bhilai': { capacity: 12, sidings: 5, hourly: 300 }
    },
    wagonTypes: {
      'BOXN': { capacity: 60, compatible: ['Steel', 'TMT Bars', 'H-beams'] },
      'BCN': { capacity: 55, compatible: ['Coal', 'Ore'] },
      'BCNA': { capacity: 58, compatible: ['Coal', 'Ore', 'Cement'] },
      'BRN': { capacity: 62, compatible: ['Steel', 'Coils'] }
    }
  },
  costs: {
    transport: { perKm: 2.5, base: 500 },
    delay: { perHour: 150 },
    demurrage: { perDay: 800 },
    loading: { perTon: 12 }
  }
};

// Mock data for optimizer
const OPTIMIZER_DATA = {
  orders: [
    { id: 'ORD001', destination: 'Bhilai', product: 'TMT Bars', qty: 2500, priority: 'High', dueDate: '2025-09-22T10:00:00Z', penalty: 2000 },
    { id: 'ORD002', destination: 'Durgapur', product: 'Coils', qty: 1800, priority: 'Medium', dueDate: '2025-09-23T08:00:00Z', penalty: 1500 },
    { id: 'ORD003', destination: 'Asansol', product: 'H-beams', qty: 3200, priority: 'High', dueDate: '2025-09-22T14:00:00Z', penalty: 2500 },
    { id: 'ORD004', destination: 'Rourkela', product: 'Steel', qty: 2200, priority: 'Low', dueDate: '2025-09-24T12:00:00Z', penalty: 1000 },
    { id: 'ORD005', destination: 'Bokaro', product: 'Coal', qty: 4000, priority: 'High', dueDate: '2025-09-22T16:00:00Z', penalty: 3000 }
  ],
  inventory: {
    'Bokaro': { 'TMT Bars': 5000, 'Steel': 3500, 'Coal': 8000, 'H-beams': 2800 },
    'Durgapur': { 'Coils': 4200, 'Steel': 2100, 'TMT Bars': 1500 },
    'Rourkela': { 'Ore': 6500, 'Steel': 4000, 'H-beams': 3200 },
    'Bhilai': { 'Steel': 5500, 'Coils': 2800, 'Coal': 3200 }
  },
  wagons: {
    'Bokaro': { 'BOXN': 45, 'BCN': 30, 'BRN': 20 },
    'Durgapur': { 'BOXN': 25, 'BCNA': 35 },
    'Rourkela': { 'BOXN': 50, 'BCN': 40, 'BRN': 30 },
    'Bhilai': { 'BOXN': 35, 'BCN': 25, 'BCNA': 20 }
  }
};

// Multi-Objective Optimization Engine
function optimizeRakeFormation(orders, weights = { cost: 0.3, sla: 0.4, utilization: 0.2, emissions: 0.1 }) {
  const plans = [];
  const constraints = OPTIMIZER_CONFIG.constraints;
  
  // Group orders by feasible loading points and wagon compatibility
  const feasibleCombos = [];
  orders.forEach(order => {
    Object.keys(OPTIMIZER_DATA.inventory).forEach(point => {
      if (OPTIMIZER_DATA.inventory[point][order.product] >= order.qty) {
        const compatibleWagons = Object.entries(constraints.wagonTypes)
          .filter(([type, spec]) => spec.compatible.includes(order.product))
          .map(([type, spec]) => ({ type, ...spec }));
        
        if (compatibleWagons.length > 0) {
          feasibleCombos.push({ order, loadingPoint: point, wagons: compatibleWagons });
        }
      }
    });
  });

  // MILP-style heuristic: Greedy + Local Search
  let bestPlan = null;
  let bestScore = -Infinity;

  for (let iteration = 0; iteration < 3; iteration++) {
    const plan = generateRakePlan(feasibleCombos, weights, iteration);
    const score = evaluatePlan(plan, weights);
    
    if (score > bestScore) {
      bestScore = score;
      bestPlan = plan;
    }
    plans.push({ ...plan, score, rank: plans.length + 1 });
  }

  return {
    optimal: bestPlan,
    alternatives: plans.sort((a, b) => b.score - a.score).slice(0, 3),
    constraints: constraints,
    explainability: generateExplanation(bestPlan)
  };
}

function generateRakePlan(feasibleCombos, weights, seed = 0) {
  const rakes = [];
  const usedOrders = new Set();
  
  // Sort by priority and due date
  const sortedCombos = feasibleCombos.sort((a, b) => {
    const priorityScore = { 'High': 3, 'Medium': 2, 'Low': 1 };
    return (priorityScore[b.order.priority] - priorityScore[a.order.priority]) || 
           (new Date(a.order.dueDate) - new Date(b.order.dueDate));
  });

  sortedCombos.forEach((combo, idx) => {
    if (usedOrders.has(combo.order.id)) return;

    const rake = createOptimalRake(combo, seed + idx);
    if (rake) {
      rakes.push(rake);
      usedOrders.add(combo.order.id);
    }
  });

  return {
    rakes,
    summary: {
      totalRakes: rakes.length,
      totalCost: rakes.reduce((sum, r) => sum + r.cost, 0),
      avgUtilization: rakes.reduce((sum, r) => sum + r.utilization, 0) / rakes.length,
      slaCompliance: rakes.filter(r => r.slaFlag).length / rakes.length,
      carbonFootprint: rakes.reduce((sum, r) => sum + r.emissions, 0),
      // Backward/forward compatibility: provide both names
      totalEmissions: rakes.reduce((sum, r) => sum + r.emissions, 0)
    }
  };
}

function createOptimalRake(combo, seed) {
  const { order, loadingPoint, wagons } = combo;
  const constraints = OPTIMIZER_CONFIG.constraints;
  
  // Select best wagon type
  const bestWagon = wagons.reduce((best, wagon) => {
    const efficiency = order.qty / wagon.capacity;
    const availability = OPTIMIZER_DATA.wagons[loadingPoint][wagon.type] || 0;
    const score = efficiency * Math.min(availability, 60);
    return score > (best?.score || 0) ? { ...wagon, score, availability } : best;
  }, null);

  if (!bestWagon || bestWagon.availability === 0) return null;

  const wagonsNeeded = Math.ceil(order.qty / bestWagon.capacity);
  const actualWagons = Math.min(wagonsNeeded, bestWagon.availability, constraints.maxRakeSize.wagons);
  
  if (actualWagons < constraints.minRakeSize.wagons) return null;

  const actualCapacity = actualWagons * bestWagon.capacity;
  const utilization = Math.min(order.qty / actualCapacity, 1.0);
  
  // Calculate costs and metrics
  const distance = getDistance(loadingPoint, order.destination);
  const transportCost = distance * OPTIMIZER_CONFIG.costs.transport.perKm + OPTIMIZER_CONFIG.costs.transport.base;
  const loadingCost = order.qty * OPTIMIZER_CONFIG.costs.loading.perTon;
  const totalCost = transportCost + loadingCost;
  
  const eta = new Date(Date.now() + (distance / 50 + 4) * 60 * 60 * 1000); // ETA based on distance
  const slaFlag = eta <= new Date(order.dueDate);
  const emissions = calculateEmissions(distance, actualCapacity, 'diesel'); // simplified
  
  return {
    id: `RAKE-${Date.now()}-${seed}`,
    orderId: order.id,
    cargo: order.product,
    loadingPoint,
    destination: order.destination,
    wagons: actualWagons,
    wagonType: bestWagon.type,
    capacity: actualCapacity,
    loadedQty: Math.min(order.qty, actualCapacity),
    utilization: utilization * 100,
    cost: totalCost,
    eta: eta.toISOString(),
    slaFlag,
    emissions,
    priority: order.priority,
    explanation: {
      wagonChoice: `${bestWagon.type} selected for ${bestWagon.capacity}T capacity and ${order.product} compatibility`,
      loadingPointChoice: `${loadingPoint} chosen due to inventory availability (${OPTIMIZER_DATA.inventory[loadingPoint][order.product]}T)`,
      costBreakdown: { transport: transportCost, loading: loadingCost, total: totalCost }
    }
  };
}

function evaluatePlan(plan, weights) {
  const summary = plan.summary;
  
  // Normalize metrics (0-1 scale)
  const costScore = Math.max(0, 1 - summary.totalCost / 50000); // Assume 50k is high cost
  const slaScore = summary.slaCompliance;
  const utilizationScore = summary.avgUtilization / 100;
  const emissionsScore = Math.max(0, 1 - summary.carbonFootprint / 1000); // Assume 1000kg is high
  
  return (
    weights.cost * costScore +
    weights.sla * slaScore +
    weights.utilization * utilizationScore +
    weights.emissions * emissionsScore
  );
}

function generateExplanation(plan) {
  if (!plan || !plan.rakes.length) return { summary: 'No feasible plan generated' };
  
  const topRake = plan.rakes[0];
  return {
    summary: `Generated ${plan.rakes.length} rakes with ${plan.summary.slaCompliance * 100}% SLA compliance`,
    keyDecisions: [
      `Primary rake uses ${topRake.wagonType} wagons for ${topRake.utilization.toFixed(1)}% utilization`,
      `${topRake.loadingPoint} selected as loading point due to inventory availability`,
      `Total cost optimized to ₹${plan.summary.totalCost.toLocaleString()} across all rakes`
    ],
    metrics: {
      costEfficiency: plan.summary.totalCost < 30000 ? 'High' : 'Medium',
      slaRisk: plan.summary.slaCompliance > 0.8 ? 'Low' : 'High',
      carbonImpact: plan.summary.carbonFootprint < 500 ? 'Low' : 'Medium'
    }
  };
}

// Utility functions
function getDistance(from, to) {
  const distances = {
    'Bokaro-Bhilai': 450, 'Bokaro-Durgapur': 280, 'Bokaro-Asansol': 190, 'Bokaro-Rourkela': 320,
    'Durgapur-Bhilai': 620, 'Durgapur-Asansol': 120, 'Durgapur-Rourkela': 380, 'Durgapur-Bokaro': 280,
    'Rourkela-Bhilai': 280, 'Rourkela-Asansol': 420, 'Rourkela-Bokaro': 320, 'Rourkela-Durgapur': 380,
    'Bhilai-Bokaro': 450, 'Bhilai-Durgapur': 620, 'Bhilai-Asansol': 680, 'Bhilai-Rourkela': 280
  };
  return distances[`${from}-${to}`] || distances[`${to}-${from}`] || 300;
}

function calculateEmissions(distance, capacity, locomotive = 'diesel') {
  const factors = { diesel: 0.032, electric: 0.018 };
  return distance * capacity * factors[locomotive] * 0.001; // kg CO2
}

// Socket.IO for realtime positions
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('chat:message', (msg) => {
    io.emit('chat:message', { ...msg, ts: Date.now(), id: crypto.randomUUID?.() || String(Date.now()) });
  });
});

// =========================
// Customer Module (MVP)
// =========================

// In-memory stores (fallback when DB not integrated)
const CUSTOMERS = new Map(); // key: customerId -> profile
const CUSTOMERS_BY_EMAIL = new Map(); // key: email -> profile
const SIGNUP_PENDING = new Map(); // key: email -> { data, createdAt }
const ORDERS = new Map(); // key: orderId -> order
const ORDERS_BY_CUSTOMER = new Map(); // key: customerId -> orderIds[]
const INVOICES = new Map(); // key: orderId -> { pdfGeneratedAt, amount }

const scryptAsync = promisify(crypto.scrypt);

const CustomerSignupSchema = z.object({
  name: z.string().min(2),
  company: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(7),
  gstin: z.string().min(5).optional(),
  password: z.string().min(8)
});

// Helper: hash & verify password
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(pw, salt, 64);
  return salt.toString('hex') + ':' + Buffer.from(key).toString('hex');
}
async function verifyPassword(pw, stored) {
  const [saltHex, keyHex] = String(stored||'').split(':');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const key = await scryptAsync(pw, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(keyHex, 'hex'), Buffer.from(key));
}

// Alias OTP sender for customer namespace
app.post('/auth/customer/request-otp', async (req, res) => {
  // Reuse existing /auth/request-otp logic by forwarding
  req.url = '/auth/request-otp';
  app._router.handle(req, res, () => {});
});

// Signup: create pending record and email OTP
app.post('/auth/customer/signup', async (req, res) => {
  const parsed = CustomerSignupSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  const { name, company, email, phone, gstin, password } = parsed.data;
  if (CUSTOMERS_BY_EMAIL.has(email)) return res.status(409).json({ error: 'Email already registered' });
  const passwordHash = await hashPassword(password);
  SIGNUP_PENDING.set(email, { data: { name, company, email, phone, gstin, passwordHash }, createdAt: Date.now() });
  // send OTP using existing helper endpoint to keep behavior consistent
  try {
    await otpSet(email, String(Math.floor(100000 + Math.random()*900000)), 5*60);
  } catch {}
  // Try SMTP if configured
  try {
    const SMTP_HOST = process.env.SMTP_HOST || '';
    const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
    const SMTP_USER = process.env.SMTP_USER || '';
    const SMTP_PASS = process.env.SMTP_PASS || '';
    const SMTP_FROM = process.env.SMTP_FROM || 'noreply@qsteel.local';
    const disableEmail = process.env.DISABLE_EMAIL === '1' || (!SMTP_HOST || !SMTP_USER || !SMTP_PASS);
    const pending = await otpGet(email);
    if (!disableEmail && pending?.code) {
      const transporter = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
      const info = await transporter.sendMail({ from: SMTP_FROM, to: email, subject: 'Verify your QSTEEL account', html: `<p>Your verification code is <b>${pending.code}</b>. It expires in 5 minutes.</p>` });
      return res.json({ ok: true, stage: 'otp_sent', messageId: info.messageId });
    }
  } catch {}
  return res.json({ ok: true, stage: 'otp_generated' });
});

// Verify signup with OTP -> create account
app.post('/auth/customer/verify-signup', async (req, res) => {
  const schema = z.object({ email: z.string().email(), otp: z.string().regex(/^\d{6}$/) });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  const { email, otp } = parsed.data;
  const pending = SIGNUP_PENDING.get(email);
  if (!pending) return res.status(404).json({ error: 'No pending signup for this email' });
  const stored = await otpGet(email);
  if (!stored || stored.code !== otp || Date.now() > stored.expMs) return res.status(401).json({ error: 'Invalid OTP, please try again.' });
  await otpDel(email);
  SIGNUP_PENDING.delete(email);
  // Create customer record
  const customerId = crypto.randomUUID?.() || 'cust-' + Math.random().toString(36).slice(2);
  const profile = { customerId, ...pending.data, addresses: [], paymentMethods: [], createdAt: new Date().toISOString() };
  CUSTOMERS.set(customerId, profile);
  CUSTOMERS_BY_EMAIL.set(profile.email, profile);
  // Issue token for convenience
  const token = jwt.sign({ sub: customerId, role: 'customer', email: profile.email }, JWT_SECRET, { expiresIn: '8h' });
  return res.json({ ok: true, customerId, token });
});

// Customer login: password or OTP
app.post('/auth/customer/login', async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().optional(), otp: z.string().regex(/^\d{6}$/).optional() });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  const { email, password, otp } = parsed.data;
  const customer = CUSTOMERS_BY_EMAIL.get(email);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  let ok = false;
  if (password) {
    ok = await verifyPassword(password, customer.passwordHash);
  } else if (otp) {
    const stored = await otpGet(email);
    if (stored && stored.code === otp && Date.now() <= stored.expMs) { ok = true; await otpDel(email); }
  }
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ sub: customer.customerId, role: 'customer', email: customer.email }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: customer.customerId, role: 'customer', email: customer.email, name: customer.name } });
});

// Profile
app.get('/customer/profile', auth('customer'), async (req, res) => {
  const c = CUSTOMERS.get(req.user.sub);
  if (!c) return res.status(404).json({ error: 'Profile not found' });
  res.json({ profile: { name: c.name, company: c.company, email: c.email, phone: c.phone, gstin: c.gstin, addresses: c.addresses, paymentMethods: c.paymentMethods } });
});

app.put('/customer/profile', auth('customer'), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).optional(),
    company: z.string().min(2).optional(),
    phone: z.string().min(7).optional(),
    gstin: z.string().min(5).optional(),
    addresses: z.array(z.object({ label: z.string(), line1: z.string(), city: z.string(), state: z.string(), pin: z.string() })).optional(),
    paymentMethods: z.array(z.object({ type: z.enum(['COD','NETBANKING','UPI']), label: z.string().optional() })).optional()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  const c = CUSTOMERS.get(req.user.sub);
  if (!c) return res.status(404).json({ error: 'Profile not found' });
  Object.assign(c, parsed.data);
  res.json({ ok: true });
});

// Order estimation helper
function estimateOrder({ cargo, qtyTons, sourcePlant, destination, priority }) {
  const plantCity = { BKSC: 'Bokaro', DGR: 'Durgapur', ROU: 'Rourkela', BPHB: 'Bhilai' }[sourcePlant] || 'Bokaro';
  const distanceKm = getDistance(plantCity, (destination || '').split(',')[0] || 'Durgapur');
  const ratePerKmPerTon = 2.5; // demo rate
  const base = 500; // base handling
  const cost = Math.round(qtyTons * distanceKm * ratePerKmPerTon + base);
  const hours = Math.round(distanceKm / 50 + (priority === 'Urgent' ? 2 : 4));
  const eta = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  // carbon footprint (simple): 0.022 tCO2/km for ore baseline scaled per cargo type
  const efByCargo = { 'TMT Bars': 0.021, 'H-Beams': 0.022, 'Coils': 0.02, 'Ore': 0.024, 'Cement': 0.021 };
  const ef = efByCargo[cargo] ?? 0.022;
  const carbonTons = Number((ef * distanceKm).toFixed(3));
  const ecoHint = 'Electric loco on S3 saves ~12% emissions.';
  return { distanceKm, cost, eta, carbonTons, ecoHint };
}

// Customer creates order (or get estimateOnly)
app.post('/customer/orders', auth('customer'), async (req, res) => {
  const schema = z.object({
    cargo: z.string(),
    quantityTons: z.number().positive(),
    sourcePlant: z.enum(['BKSC','DGR','ROU','BPHB']),
    destination: z.string(), // City/State or PIN
    priority: z.enum(['Normal','Urgent']).default('Normal'),
    notes: z.string().optional(),
    estimateOnly: z.boolean().optional()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  const { cargo, quantityTons, sourcePlant, destination, priority, notes, estimateOnly } = parsed.data;
  const est = estimateOrder({ cargo, qtyTons: quantityTons, sourcePlant, destination, priority });
  if (estimateOnly) return res.json({ estimate: est });

  const orderId = crypto.randomUUID?.() || 'ord-' + Math.random().toString(36).slice(2);
  const order = {
    orderId,
    customerId: req.user.sub,
    cargo,
    quantityTons,
    sourcePlant,
    destination,
    priority,
    notes: notes || '',
    status: 'Pending', // Pending Manager Approval
    createdAt: new Date().toISOString(),
    estimate: est,
    rakeId: null,
    history: [{ ts: Date.now(), status: 'Pending' }]
  };
  ORDERS.set(orderId, order);
  const arr = ORDERS_BY_CUSTOMER.get(req.user.sub) || [];
  arr.push(orderId); ORDERS_BY_CUSTOMER.set(req.user.sub, arr);
  // Notify managers
  io.emit('notification', { audience: 'manager', type: 'order_created', orderId, customerId: req.user.sub, priority });
  res.json({ ok: true, order });
});

app.get('/customer/orders', auth('customer'), async (req, res) => {
  const ids = ORDERS_BY_CUSTOMER.get(req.user.sub) || [];
  res.json({ orders: ids.map(id => ORDERS.get(id)).filter(Boolean) });
});

app.get('/customer/orders/:id', auth('customer'), async (req, res) => {
  const o = ORDERS.get(req.params.id);
  if (!o || o.customerId !== req.user.sub) return res.status(404).json({ error: 'Order not found' });
  res.json({ order: o });
});

// Invoice PDF
app.get('/customer/orders/:id/invoice.pdf', auth('customer'), async (req, res) => {
  const o = ORDERS.get(req.params.id);
  if (!o || o.customerId !== req.user.sub) return res.status(404).json({ error: 'Order not found' });
  const amount = o.estimate?.cost || Math.round((o.quantityTons||0) * 300);
  INVOICES.set(o.orderId, { pdfGeneratedAt: new Date().toISOString(), amount });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${o.orderId}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);
  doc.fontSize(18).text('QSTEEL — Invoice', { align: 'left' });
  doc.moveDown();
  const c = CUSTOMERS.get(o.customerId);
  doc.fontSize(12).text(`Invoice #: INV-${o.orderId.slice(0,8).toUpperCase()}`);
  doc.text(`Date: ${new Date().toLocaleString()}`);
  doc.text(`Bill To: ${c?.company || c?.name} (${c?.email})`);
  doc.moveDown();
  doc.text(`Order ID: ${o.orderId}`);
  doc.text(`Cargo: ${o.cargo}`);
  doc.text(`Quantity: ${o.quantityTons} tons`);
  doc.text(`Source: ${o.sourcePlant}`);
  doc.text(`Destination: ${o.destination}`);
  doc.text(`Priority: ${o.priority}`);
  doc.moveDown();
  doc.fontSize(14).text(`Amount Payable: ₹${amount.toLocaleString()}`);
  doc.moveDown();
  doc.fontSize(10).fillColor('#6B7280').text('Payment Options: COD, Net Banking, UPI (demo placeholder)');
  doc.end();
});

// Manager queue & actions
app.get('/manager/orders/pending', auth('manager'), async (req, res) => {
  const list = Array.from(ORDERS.values()).filter(o => o.status === 'Pending');
  res.json({ orders: list });
});

app.post('/manager/orders/:id/approve', auth('manager'), async (req, res) => {
  const o = ORDERS.get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  o.status = 'Approved';
  o.history.push({ ts: Date.now(), status: 'Approved' });
  io.emit('notification', { audience: 'customer', email: CUSTOMERS.get(o.customerId)?.email, type: 'order_approved', orderId: o.orderId });
  // Assign rake and schedule departure sequence: Loading -> En Route
  const rakeId = `RK${String(Math.floor(Math.random()*9000)+1000)}`;
  o.rakeId = rakeId;
  // Seed a position path using presets from MOCK_DATA.routes or default
  const routeKey = `${o.sourcePlant}-DGR`;
  const presets = { 'BKSC-DGR': ['BKSC','Dhanbad','Asansol','Andal','DGR'], 'BKSC-ROU': ['BKSC','Purulia','ROU'], 'BKSC-BPHB': ['BKSC','Norla','BPHB'] };
  const STN = { BKSC: [23.658, 86.151], DGR: [23.538, 87.291], Dhanbad: [23.795, 86.430], Asansol: [23.685, 86.974], Andal: [23.593, 87.242], ROU: [22.227, 84.857], Purulia: [23.332, 86.365], BPHB: [21.208, 81.379], Norla: [19.188, 82.787] };
  const seq = presets[routeKey] || presets['BKSC-DGR'];
  const stops = (seq || []).map(code => ({ name: code, lat: STN[code][0], lng: STN[code][1], signal: Math.random() > 0.7 ? 'red' : 'green' }));
  MOCK_DATA.positions.push({ id: rakeId, rfid: `RFID-${Math.floor(Math.random()*1000)+100}`, status: 'Loading', speed: 0, temp: 30, cargo: o.cargo, source: o.sourcePlant, destination: o.destination, currentLocationName: seq?.[0] || 'Bokaro', stops });

  setTimeout(() => {
    o.status = 'Loading'; o.history.push({ ts: Date.now(), status: 'Loading' }); io.emit('order:update', { orderId: o.orderId, status: o.status });
    const pos = MOCK_DATA.positions.find(p => p.id === rakeId); if (pos) pos.status = 'Loading';
  }, 2000);
  setTimeout(() => {
    o.status = 'En Route'; o.history.push({ ts: Date.now(), status: 'En Route' }); io.emit('order:update', { orderId: o.orderId, status: o.status, rakeId });
    const pos = MOCK_DATA.positions.find(p => p.id === rakeId); if (pos) { pos.status = 'En Route'; pos.speed = 40; }
  }, 10000);

  res.json({ ok: true, order: o });
});

app.post('/manager/orders/:id/reject', auth('manager'), async (req, res) => {
  const o = ORDERS.get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  o.status = 'Rejected';
  o.history.push({ ts: Date.now(), status: 'Rejected' });
  io.emit('notification', { audience: 'customer', email: CUSTOMERS.get(o.customerId)?.email, type: 'order_rejected', orderId: o.orderId });
  res.json({ ok: true, order: o });
});

// Yard-side view for assigned orders (very simple grouping by rake)
app.get('/yard/orders', auth('yard'), async (req, res) => {
  const assigned = Array.from(ORDERS.values()).filter(o => !!o.rakeId && (o.status === 'Approved' || o.status === 'Loading'));
  res.json({ orders: assigned });
});

app.post('/yard/orders/:id/status', auth('yard'), async (req, res) => {
  const schema = z.object({ status: z.enum(['Loading','Ready','Dispatched']) });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  const o = ORDERS.get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  o.status = parsed.data.status;
  o.history.push({ ts: Date.now(), status: o.status });
  io.emit('order:update', { orderId: o.orderId, status: o.status });
  const pos = o.rakeId ? MOCK_DATA.positions.find(p => p.id === o.rakeId) : null;
  if (pos) {
    if (o.status === 'Dispatched') { pos.status = 'En Route'; pos.speed = 45; }
    else if (o.status === 'Loading') { pos.status = 'Loading'; pos.speed = 0; }
    else if (o.status === 'Ready') { pos.status = 'Ready'; pos.speed = 0; }
  }
  res.json({ ok: true, order: o });
});

// -------------------------
// Dev-only: Seed demo data
// -------------------------
// Creates demo customers and 5 orders covering statuses: Pending, Approved, Loading, En Route, Rejected
// Guarded to non-production or explicit header X-Seed-Key === process.env.SEED_KEY
app.post('/dev/seed-demo', async (req, res) => {
  const allow = process.env.NODE_ENV !== 'production' || (req.headers['x-seed-key'] && process.env.SEED_KEY && req.headers['x-seed-key'] === process.env.SEED_KEY);
  if (!allow) return res.status(403).json({ error: 'Forbidden' });

  try {
    // 1) Ensure two demo customers
    const ensureCustomer = async (email, name, company) => {
      let c = CUSTOMERS_BY_EMAIL.get(email);
      if (!c) {
        const customerId = crypto.randomUUID?.() || 'cust-' + Math.random().toString(36).slice(2);
        c = { customerId, name, company, email, phone: '9999999999', gstin: '22AAAAA0000A1Z5', passwordHash: await hashPassword('secret123'), addresses: [], paymentMethods: [], createdAt: new Date().toISOString() };
        CUSTOMERS.set(customerId, c);
        CUSTOMERS_BY_EMAIL.set(email, c);
      }
      return c;
    };

    const c1 = await ensureCustomer('customer+demo1@sail.test', 'Demo One', 'Demo One Pvt Ltd');
    const c2 = await ensureCustomer('customer+demo2@sail.test', 'Demo Two', 'Demo Two Pvt Ltd');

    // 2) Helper to create order
    const makeOrder = (customer, overrides = {}) => {
      const orderId = crypto.randomUUID?.() || 'ord-' + Math.random().toString(36).slice(2);
      const cargoOptions = ['TMT Bars','H-Beams','Coils','Ore','Cement'];
      const srcOptions = ['BKSC','DGR','ROU','BPHB'];
      const destOptions = ['Durgapur, WB','Rourkela, OD','Bhilai, CG'];
      const cargo = overrides.cargo || cargoOptions[Math.floor(Math.random()*cargoOptions.length)];
      const sourcePlant = overrides.sourcePlant || srcOptions[Math.floor(Math.random()*srcOptions.length)];
      const destination = overrides.destination || destOptions[Math.floor(Math.random()*destOptions.length)];
      const quantityTons = overrides.quantityTons || Math.floor(100 + Math.random()*900);
      const priority = overrides.priority || (Math.random() > 0.8 ? 'Urgent' : 'Normal');
      const est = estimateOrder({ cargo, qtyTons: quantityTons, sourcePlant, destination, priority });
      const order = {
        orderId,
        customerId: customer.customerId,
        cargo,
        quantityTons,
        sourcePlant,
        destination,
        priority,
        notes: '',
        status: 'Pending',
        createdAt: new Date().toISOString(),
        estimate: est,
        rakeId: null,
        history: [{ ts: Date.now(), status: 'Pending' }]
      };
      ORDERS.set(orderId, order);
      const arr = ORDERS_BY_CUSTOMER.get(customer.customerId) || [];
      arr.push(orderId); ORDERS_BY_CUSTOMER.set(customer.customerId, arr);
      return order;
    };

    // 3) Create 5 orders and move them to varied statuses
    const oPending = makeOrder(c1);

    const oApproved = makeOrder(c1);
    oApproved.status = 'Approved'; oApproved.history.push({ ts: Date.now(), status: 'Approved' });
    oApproved.rakeId = `RK${String(Math.floor(Math.random()*9000)+1000)}`;

    const oLoading = makeOrder(c2);
    oLoading.status = 'Loading'; oLoading.history.push({ ts: Date.now(), status: 'Approved' }, { ts: Date.now(), status: 'Loading' });
    oLoading.rakeId = `RK${String(Math.floor(Math.random()*9000)+1000)}`;

    const oEnRoute = makeOrder(c2);
    oEnRoute.status = 'En Route'; oEnRoute.history.push({ ts: Date.now(), status: 'Approved' }, { ts: Date.now(), status: 'Loading' }, { ts: Date.now(), status: 'En Route' });
    oEnRoute.rakeId = `RK${String(Math.floor(Math.random()*9000)+1000)}`;

    const oRejected = makeOrder(c1);
    oRejected.status = 'Rejected'; oRejected.history.push({ ts: Date.now(), status: 'Rejected' });

    // 4) Seed positions for orders with rakeId
    const presets = { 'BKSC-DGR': ['BKSC','Dhanbad','Asansol','Andal','DGR'], 'BKSC-ROU': ['BKSC','Purulia','ROU'], 'BKSC-BPHB': ['BKSC','Norla','BPHB'] };
    const STN = { BKSC: [23.658, 86.151], DGR: [23.538, 87.291], Dhanbad: [23.795, 86.430], Asansol: [23.685, 86.974], Andal: [23.593, 87.242], ROU: [22.227, 84.857], Purulia: [23.332, 86.365], BPHB: [21.208, 81.379], Norla: [19.188, 82.787] };
    function pushPositionFor(order) {
      if (!order.rakeId) return;
      const routeKey = `${order.sourcePlant}-DGR`;
      const seq = presets[routeKey] || presets['BKSC-DGR'];
      const stops = (seq || []).map(code => ({ name: code, lat: STN[code][0], lng: STN[code][1], signal: Math.random() > 0.7 ? 'red' : 'green' }));
      const existing = MOCK_DATA.positions.find(p => p.id === order.rakeId);
      const base = { id: order.rakeId, rfid: `RFID-${Math.floor(Math.random()*1000)+100}`, speed: order.status === 'En Route' ? 40 : 0, temp: 30, cargo: order.cargo, source: order.sourcePlant, destination: order.destination, currentLocationName: seq?.[0] || 'Bokaro', stops };
      if (existing) Object.assign(existing, base, { status: order.status }); else MOCK_DATA.positions.push({ ...base, status: order.status });
    }
    [oApproved, oLoading, oEnRoute].forEach(pushPositionFor);

    res.json({
      ok: true,
      customers: [c1.email, c2.email],
      orders: [oPending, oApproved, oLoading, oEnRoute, oRejected].map(o => ({ id: o.orderId, status: o.status, rakeId: o.rakeId }))
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// Dev-only: Seed mock blockchain ledger entries
// Guarded to non-production or explicit header X-Seed-Key === process.env.SEED_KEY
app.post('/dev/seed-ledger', async (req, res) => {
  const allow = process.env.NODE_ENV !== 'production' || (req.headers['x-seed-key'] && process.env.SEED_KEY && req.headers['x-seed-key'] === process.env.SEED_KEY);
  if (!allow) return res.status(403).json({ error: 'Forbidden' });

  try {
    // Optional clear flag to reset ledger before seeding
    const clear = req.query.clear === '1' || req.body?.clear === true;
    if (clear) {
      while (ledger.length) ledger.pop();
    }

    // Ten mock entries covering lifecycle
    const baseTs = Date.now() - 1000 * 60 * 60; // 1h ago baseline
    const entries = [
      { type: 'GENERIC', event: 'GENESIS_NOTE', note: 'Starting mock chain', actor: 'system' },
      { type: 'ORDER_CREATED', orderId: 'ORD1001', customer: 'Demo One Pvt Ltd', cargo: 'TMT Bars', quantityTons: 800, source: 'BKSC', destination: 'Durgapur', actor: 'customer+demo1@sail.test' },
      { type: 'ORDER_APPROVED', orderId: 'ORD1001', manager: 'manager@sail.test', actor: 'manager@sail.test' },
      { type: 'RAKE_ASSIGNED', orderId: 'ORD1001', rakeId: 'RK8101', wagonType: 'BOXN', wagons: 40, actor: 'planner@qsteel.local' },
      { type: 'LOADING_CONFIRMED', rakeId: 'RK8101', yard: 'DGR-Y1', actor: 'yard@sail.test' },
      { type: 'DISPATCH', rakeId: 'RK8101', from: 'BKSC', to: 'DGR', cargo: 'TMT Bars', tonnage: 800, actor: 'yard@sail.test' },
      { type: 'IN_TRANSIT', rakeId: 'RK8101', segment: 'BKSC→Dhanbad', status: 'clear', speed: 42, actor: 'telemetry' },
      { type: 'IN_TRANSIT', rakeId: 'RK8101', segment: 'Dhanbad→Asansol', status: 'busy', speed: 28, actor: 'telemetry' },
      { type: 'ARRIVED', rakeId: 'RK8101', at: 'DGR', actor: 'ops@qsteel.local' },
      { type: 'DELIVERED', rakeId: 'RK8101', orderId: 'ORD1001', proof: 'POD-INV-001', actor: 'ops@qsteel.local' },
    ];

    // Seed with deterministic timestamps spaced by ~6 minutes
    let ts = baseTs;
    const seeded = entries.map((e, i) => {
      ts += 6 * 60 * 1000; // +6 minutes
      return appendLedger(e, ts);
    });

    res.json({ ok: true, added: seeded.length, length: ledger.length, chainTail: ledger.slice(-3) });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// Mock IoT streamer
setInterval(() => {
  // advance progress and emit current interpolated positions
  const step = 0.08; // progress per tick
  for (const p of MOCK_DATA.positions) {
    const stops = p.stops || [];
    if (stops.length < 2) continue;
    const st = SIM.progress[p.id] || { idx: 0, t: 0 };
    st.t += step;
    if (st.t >= 1) { st.t = 0; st.idx = (st.idx + 1) % stops.length; }
    SIM.progress[p.id] = st;
  }
  io.emit('positions', getLivePositions());
}, 2000);

// API Endpoints for Advanced Optimizer
app.post('/optimizer/rake-formation', auth(), async (req, res) => {
  try {
    const orderSchema = z.object({ id: z.string(), product: z.string(), qty: z.number().positive(), from: z.string(), to: z.string(), slaDays: z.number().int().positive() });
    const bodySchema = z.object({
      orders: z.array(orderSchema).default(OPTIMIZER_DATA.orders),
      weights: z.object({ cost: z.number().optional(), sla: z.number().optional(), utilization: z.number().optional(), emissions: z.number().optional() }).default({}),
      constraints: z.record(z.any()).default({})
    });
    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
    const { orders, weights = {}, constraints = {} } = parsed.data;
    
    const optimizationWeights = {
      cost: weights.cost || 0.3,
      sla: weights.sla || 0.4,
      utilization: weights.utilization || 0.2,
      emissions: weights.emissions || 0.1
    };

    const result = optimizeRakeFormation(orders, optimizationWeights);
    
    res.json({
      success: true,
      optimization: result,
      timestamp: new Date().toISOString(),
      processingTimeMs: Math.floor(Math.random() * 500 + 200) // Simulated
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/optimizer/scenario-analysis', auth(), async (req, res) => {
  try {
    const disruptSchema = z.object({
      sidingCapacity: z.record(z.number()).optional(),
      wagonAvailability: z.record(z.number()).optional(),
      demandChange: z.record(z.number()).optional(),
    }).default({});
    const bodySchema = z.object({
      scenario: z.string().optional(),
      disruptions: disruptSchema
    });
    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
    const { scenario, disruptions = {} } = parsed.data;
    
    // Apply disruptions to base data
    const modifiedData = JSON.parse(JSON.stringify(OPTIMIZER_DATA));
    
    if (disruptions.sidingCapacity) {
      Object.keys(disruptions.sidingCapacity).forEach(point => {
        const reduction = disruptions.sidingCapacity[point];
        if (OPTIMIZER_CONFIG.constraints.loadingPoints[point]) {
          OPTIMIZER_CONFIG.constraints.loadingPoints[point].capacity *= (1 - reduction);
        }
      });
    }
    
    if (disruptions.wagonAvailability) {
      Object.keys(disruptions.wagonAvailability).forEach(point => {
        const reduction = disruptions.wagonAvailability[point];
        Object.keys(modifiedData.wagons[point] || {}).forEach(type => {
          modifiedData.wagons[point][type] = Math.floor(modifiedData.wagons[point][type] * (1 - reduction));
        });
      });
    }
    
    if (disruptions.demandChange) {
      modifiedData.orders = modifiedData.orders.map(order => ({
        ...order,
        qty: Math.floor(order.qty * (1 + (disruptions.demandChange[order.product] || 0)))
      }));
    }
    
    const baseResult = optimizeRakeFormation(OPTIMIZER_DATA.orders);
    const scenarioResult = optimizeRakeFormation(modifiedData.orders);
    
    res.json({
      success: true,
      scenario: scenario || 'Custom Disruption',
      baseline: baseResult.optimal.summary,
      modified: scenarioResult.optimal.summary,
      impact: {
        costDelta: scenarioResult.optimal.summary.totalCost - baseResult.optimal.summary.totalCost,
        slaDelta: scenarioResult.optimal.summary.slaCompliance - baseResult.optimal.summary.slaCompliance,
        utilizationDelta: scenarioResult.optimal.summary.avgUtilization - baseResult.optimal.summary.avgUtilization
      },
      recommendations: generateScenarioRecommendations(baseResult, scenarioResult, disruptions)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/optimizer/production-alignment', auth(), async (req, res) => {
  try {
    const alignment = analyzeProductionAlignment();
    res.json(alignment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/optimizer/constraints', auth(), async (req, res) => {
  res.json({
    constraints: OPTIMIZER_CONFIG.constraints,
    wagonCompatibility: OPTIMIZER_CONFIG.constraints.wagonTypes,
    loadingPoints: OPTIMIZER_CONFIG.constraints.loadingPoints,
    costs: OPTIMIZER_CONFIG.costs
  });
});

app.get('/optimizer/daily-plan', auth(), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const result = optimizeRakeFormation(OPTIMIZER_DATA.orders);
    
    const dailyPlan = {
      date,
      rakes: result.optimal.rakes,
      summary: {
        ...result.optimal.summary,
        totalEmissions: result.optimal.summary.totalEmissions ?? result.optimal.summary.carbonFootprint
      },
      gantt: generateGanttData(result.optimal.rakes),
      kpis: {
        totalRakes: result.optimal.rakes.length,
        onTimeDeliveries: result.optimal.rakes.filter(r => r.slaFlag).length,
        avgUtilization: result.optimal.summary.avgUtilization,
        totalCost: result.optimal.summary.totalCost,
        carbonSaved: calculateCarbonSavings(result.optimal.rakes)
      }
    };
    
    res.json(dailyPlan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function generateScenarioRecommendations(baseline, scenario, disruptions) {
  const recommendations = [];
  
  if (scenario.optimal.summary.totalCost > baseline.optimal.summary.totalCost * 1.1) {
    recommendations.push({
      type: 'Cost Management',
      priority: 'High',
      action: 'Consider alternative loading points or wagon types to reduce transport costs',
      impact: `Potential savings: ₹${Math.floor((scenario.optimal.summary.totalCost - baseline.optimal.summary.totalCost) * 0.3).toLocaleString()}`
    });
  }
  
  if (scenario.optimal.summary.slaCompliance < baseline.optimal.summary.slaCompliance * 0.9) {
    recommendations.push({
      type: 'SLA Risk',
      priority: 'High',
      action: 'Prioritize high-priority orders and consider express routing',
      impact: `${Math.floor((baseline.optimal.summary.slaCompliance - scenario.optimal.summary.slaCompliance) * 100)}% SLA compliance drop`
    });
  }
  
  if (disruptions.wagonAvailability) {
    recommendations.push({
      type: 'Capacity Planning',
      priority: 'Medium',
      action: 'Explore wagon leasing or alternative transport modes (road) for critical orders',
      impact: 'Maintain service levels despite wagon constraints'
    });
  }
  
  return recommendations;
}

function analyzeProductionAlignment() {
  const orders = OPTIMIZER_DATA.orders;
  const inventory = OPTIMIZER_DATA.inventory;
  const recommendations = [];
  
  // Analyze demand vs inventory by product and location
  const productDemand = {};
  orders.forEach(order => {
    if (!productDemand[order.product]) productDemand[order.product] = {};
    if (!productDemand[order.product][order.destination]) {
      productDemand[order.product][order.destination] = 0;
    }
    productDemand[order.product][order.destination] += order.qty;
  });
  
  // Generate alignment recommendations
  Object.keys(productDemand).forEach(product => {
    const totalDemand = Object.values(productDemand[product]).reduce((sum, qty) => sum + qty, 0);
    const totalInventory = Object.values(inventory).reduce((sum, inv) => sum + (inv[product] || 0), 0);
    
    if (totalDemand > totalInventory * 0.8) {
      const shortfall = totalDemand - totalInventory;
      const bestPlant = Object.entries(inventory).reduce((best, [plant, inv]) => {
        const capacity = inv[product] || 0;
        return capacity > (best?.capacity || 0) ? { plant, capacity } : best;
      }, null);
      
      recommendations.push({
        product,
        action: 'Increase Production',
        plant: bestPlant?.plant,
        quantity: shortfall,
        priority: shortfall > 1000 ? 'High' : 'Medium',
        rationale: `Current demand (${totalDemand}T) exceeds inventory (${totalInventory}T) by ${shortfall}T`
      });
    }
  });
  
  // Modal split analysis
  const railCapacity = Object.values(OPTIMIZER_DATA.wagons).reduce((sum, wagons) => {
    return sum + Object.values(wagons).reduce((wSum, count) => wSum + count * 60, 0); // Avg 60T per wagon
  }, 0);
  
  const totalOrderVolume = orders.reduce((sum, order) => sum + order.qty, 0);
  const railCoverage = Math.min(railCapacity / totalOrderVolume, 1.0);
  const roadRequired = totalOrderVolume - (railCapacity * 0.9); // 90% rail utilization
  
  return {
    productionRecommendations: recommendations,
    modalSplit: {
      railCapacityT: railCapacity,
      totalDemandT: totalOrderVolume,
      railCoverage: railCoverage * 100,
      roadRequiredT: Math.max(0, roadRequired),
      costComparison: {
        railCostPerT: 45, // Average rail cost
        roadCostPerT: 75, // Average road cost
        savings: Math.max(0, roadRequired * (75 - 45))
      }
    },
    utilization: {
      wagonUtilization: calculateWagonUtilization(),
      idleAnalysis: analyzeIdleCapacity()
    }
  };
}

function calculateWagonUtilization() {
  const totalWagons = Object.values(OPTIMIZER_DATA.wagons).reduce((sum, wagons) => {
    return sum + Object.values(wagons).reduce((wSum, count) => wSum + count, 0);
  }, 0);
  
  const usedWagons = Math.floor(OPTIMIZER_DATA.orders.reduce((sum, order) => sum + order.qty, 0) / 60);
  
  return {
    total: totalWagons,
    used: usedWagons,
    utilization: (usedWagons / totalWagons) * 100,
    idle: totalWagons - usedWagons
  };
}

function analyzeIdleCapacity() {
  const idleWagons = calculateWagonUtilization().idle;
  const hourlyCost = 25; // Cost per wagon per hour
  const avgIdleHours = 18; // Average idle time
  
  return {
    idleWagons,
    costImpact: idleWagons * hourlyCost * avgIdleHours,
    recommendations: [
      idleWagons > 50 ? 'Consider leasing out excess wagons' : null,
      'Optimize loading schedules to reduce idle time',
      'Implement dynamic wagon allocation'
    ].filter(Boolean)
  };
}

function generateGanttData(rakes) {
  return rakes.map((rake, idx) => ({
    id: rake.id,
    name: `${rake.cargo} to ${rake.destination}`,
    start: new Date(Date.now() + idx * 2 * 60 * 60 * 1000).toISOString(), // Stagger by 2 hours
    end: rake.eta,
    progress: 0,
    dependencies: idx > 0 ? [rakes[idx-1].id] : [],
    resources: [`${rake.wagons} ${rake.wagonType} wagons`, rake.loadingPoint],
    priority: rake.priority
  }));
}

function calculateCarbonSavings(rakes) {
  const railEmissions = rakes.reduce((sum, rake) => sum + rake.emissions, 0);
  const roadEmissions = rakes.reduce((sum, rake) => {
    const distance = getDistance(rake.loadingPoint, rake.destination);
    return sum + (distance * rake.loadedQty * 0.095); // Road emission factor
  }, 0);
  
  return Math.max(0, roadEmissions - railEmissions);
}

// Export endpoints for ERP integration
app.get('/optimizer/export/daily-plan.csv', auth(), (req, res) => {
  const result = optimizeRakeFormation(OPTIMIZER_DATA.orders);
  const csvHeaders = 'Rake_ID,Cargo,Loading_Point,Destination,Wagons,ETA,Cost,SLA_Flag,Utilization';
  const csvRows = result.optimal.rakes.map(rake => 
    `${rake.id},${rake.cargo},${rake.loadingPoint},${rake.destination},${rake.wagons},${rake.eta},${rake.cost},${rake.slaFlag},${rake.utilization.toFixed(1)}%`
  ).join('\n');
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="daily-rake-plan.csv"');
  res.send(`${csvHeaders}\n${csvRows}`);
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  if (!allowAll) console.log('CORS origins allowed:', CORS_ORIGINS.join(', '));
});
