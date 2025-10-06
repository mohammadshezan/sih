// Load environment variables from .env and .env.local (local overrides)
import dotenv from 'dotenv';
import path from 'path';
// Load app-local envs first, then allow root-level .env to override for monorepo single-env setup
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });
// Root .env (../../.env) will override duplicates so you can manage all envs in one place
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env.local'), override: true });
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
// Lightweight analytics (in-memory, optional Prisma persistence)
const ROUTE_STATS = new Map(); // key: path -> { count, byRole: Map(role->count), last: number }
const EVENTS = []; // bounded event log
const MAX_EVENTS = 10000;
const WS_STATS = {
  totalConnections: 0,
  currentConnections: 0,
  byNamespace: {}, // ns -> { total, current }
  durationsMs: [], // recent session durations
};

// CORS configuration (HTTP + WebSocket) driven by env
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const allowAll = CORS_ORIGINS.length === 0 && process.env.NODE_ENV !== 'production';
const prodNoOrigins = CORS_ORIGINS.length === 0 && process.env.NODE_ENV === 'production';
if (prodNoOrigins) {
  console.warn('CORS_ORIGINS is not set in production; temporarily allowing all origins (no credentials). Set CORS_ORIGINS to lock down.');
}
const corsOptions = {
  origin: (allowAll || prodNoOrigins) ? '*' : CORS_ORIGINS,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  // Only enable credentials when specific origins are configured; '*' with credentials is invalid in browsers
  credentials: !(allowAll || prodNoOrigins),
};
const io = new SocketIOServer(httpServer, {
  cors: corsOptions,
});

// Namespace for alignment dashboard realtime push
const alignmentNS = io.of('/ws/alignment');
alignmentNS.on('connection', socket => {
  socket.emit('hello', { message: 'Connected to alignment stream' });
  // Track WS connection analytics for namespace
  try {
    WS_STATS.totalConnections += 1;
    WS_STATS.currentConnections += 1;
    WS_STATS.byNamespace['/ws/alignment'] = WS_STATS.byNamespace['/ws/alignment'] || { total: 0, current: 0 };
    WS_STATS.byNamespace['/ws/alignment'].total += 1;
    WS_STATS.byNamespace['/ws/alignment'].current += 1;
    // Optional role attribution from auth token in query (?token=...)
    let role = 'guest';
    try {
      const t = socket.handshake?.auth?.token || socket.handshake?.query?.token;
      if (typeof t === 'string' && t) {
        const payload = jwt.verify(t, JWT_SECRET);
        role = payload?.role || 'guest';
      }
    } catch {}
    const started = Date.now();
    socket.on('disconnect', () => {
      WS_STATS.currentConnections = Math.max(0, WS_STATS.currentConnections - 1);
      WS_STATS.byNamespace['/ws/alignment'].current = Math.max(0, WS_STATS.byNamespace['/ws/alignment'].current - 1);
      const dur = Date.now() - started;
      WS_STATS.durationsMs.push(dur);
      if (WS_STATS.durationsMs.length > 1000) WS_STATS.durationsMs.shift();
    });
    // Record lightweight ws_activity event
    try { pushEvent({ type: 'ws_connect', page: '/ws/alignment', role, meta: { ns: '/ws/alignment' }, ts: Date.now() }); } catch {}
  } catch {}
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

// Startup diagnostics: SMTP configuration
const SMTP_CONFIG_MISSING = !process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS;
if (SMTP_CONFIG_MISSING) {
  console.warn('[QSTEEL][SMTP] Email delivery is DISABLED. Missing SMTP_HOST/SMTP_USER/SMTP_PASS. Set them in apps/api/.env.local');
} else {
  console.log('[QSTEEL][SMTP] Email delivery is ENABLED. From:', process.env.SMTP_FROM || process.env.SMTP_USER);
}

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
const OTP_STORE = new Map(); // key: normalized email, value: { code, expMs }
const normEmailKey = (e)=> String(e||'').trim().toLowerCase();
async function otpSet(email, code, ttlSec = 300) {
  const key = normEmailKey(email);
  const expMs = Date.now() + ttlSec * 1000;
  // Prefer DB persistence if available
  if (prisma) {
    try {
      const expAt = new Date(expMs);
      await prisma.otpCode.upsert({
        where: { email_purpose: { email: key, purpose: 'generic' } },
        update: { code, expAt },
        create: { email: key, purpose: 'generic', code, expAt },
      });
      return;
    } catch { /* fall through to redis/memory */ }
  }
  if (redis) {
    try { await redis.set(`otp:${key}`, JSON.stringify({ code, expMs }), 'EX', ttlSec); return; } catch { /* fall through */ }
  }
  OTP_STORE.set(key, { code, expMs });
}
async function otpGet(email) {
  const key = normEmailKey(email);
  if (prisma) {
    try {
      const row = await prisma.otpCode.findUnique({ where: { email_purpose: { email: key, purpose: 'generic' } } });
      if (!row) {
        // Fallback to Redis/memory if DB has no record (e.g., set before DB connected)
        if (redis) { try { const v = await redis.get(`otp:${key}`); return v ? JSON.parse(v) : null; } catch { /*noop*/ } }
        const v = OTP_STORE.get(key);
        if (!v) return null; if (Date.now() > v.expMs) { OTP_STORE.delete(key); return null; }
        return v;
      }
      const expMs = new Date(row.expAt).getTime();
      if (Date.now() > expMs) { try { await prisma.otpCode.delete({ where: { email_purpose: { email: key, purpose: 'generic' } } }); } catch {}; return null; }
      return { code: row.code, expMs };
    } catch { /* fall through to redis/memory */ }
  }
  if (redis) {
    try { const v = await redis.get(`otp:${key}`); return v ? JSON.parse(v) : null; } catch { return null; }
  }
  const v = OTP_STORE.get(key);
  if (!v) return null; if (Date.now() > v.expMs) { OTP_STORE.delete(key); return null; }
  return v;
}
function otpDel(email) {
  const key = normEmailKey(email);
  const ops = [];
  if (prisma) ops.push(prisma.otpCode.delete({ where: { email_purpose: { email: key, purpose: 'generic' } } }).catch(()=>{}));
  if (redis) ops.push(redis.del(`otp:${key}`).catch(()=>{}));
  OTP_STORE.delete(key);
  return Promise.all(ops).catch(()=>{});
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

// Route usage analytics: record per-path counters with role attribution (if req.user set by route auth)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    try {
      const key = req.path || req.originalUrl || 'unknown';
      const role = (req.user && req.user.role) || 'guest';
      const item = ROUTE_STATS.get(key) || { count: 0, byRole: new Map(), last: 0, totalTimeMs: 0 };
      item.count += 1; item.last = Date.now(); item.totalTimeMs += (Date.now() - start);
      const rc = item.byRole.get(role) || 0; item.byRole.set(role, rc + 1);
      ROUTE_STATS.set(key, item);
    } catch {}
  });
  next();
});

// ==== CMO Mock Stores (in-memory) ====
const ALLOCATIONS = new Map(); // id -> { id, status, payload, createdBy, createdAt, approvedBy?, approvedAt? }
const ALLOC_AUDIT = []; // { allocId, user, action, diff, ts }
// ==== Low stock reports and manager-issued internal orders (in-memory fallbacks) ====
const LOW_STOCK_REPORTS = []; // { id, stockyardCity, product, currentTons?, thresholdTons?, requiredTons?, reporter, ts }
const PENDING_INTERNAL_ORDERS = []; // { id, destination, product, quantityTons, priority, sourcePlant, status, ts }

// ==== Customer Projects (static demo dataset) ====
// Minimal project sites to mark on the map and list in UIs. In production this would come from DB/ERP.
const CUSTOMER_PROJECTS = [
  { id: 'PRJ-CHN-01', name: 'Metro Viaduct Piling', city: 'Chennai', state: 'TN', products: ['TMT Bars','H-Beams'], nearestCMO: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { id: 'PRJ-MUM-01', name: 'Sea Link Expansion', city: 'Mumbai', state: 'MH', products: ['TMT Bars','Coils'], nearestCMO: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  { id: 'PRJ-DEL-01', name: 'Ring Road Flyover', city: 'Delhi', state: 'DL', products: ['H-Beams','Steel'], nearestCMO: 'Delhi', lat: 28.6139, lng: 77.2090 },
  { id: 'PRJ-VSKP-01', name: 'Port Warehouse', city: 'Visakhapatnam', state: 'AP', products: ['Coils','Steel'], nearestCMO: 'Visakhapatnam', lat: 17.6868, lng: 83.2185 },
  { id: 'PRJ-IND-01', name: 'Industrial Park Phase 2', city: 'Indore', state: 'MP', products: ['Cement','Steel'], nearestCMO: 'Indore', lat: 22.7196, lng: 75.8577 },
  { id: 'PRJ-KNP-01', name: 'River Bridge', city: 'Kanpur', state: 'UP', products: ['TMT Bars'], nearestCMO: 'Kanpur', lat: 26.4499, lng: 80.3319 },
  { id: 'PRJ-ROU-01', name: 'Structural Rehab', city: 'Rourkela', state: 'OD', products: ['H-Beams'], nearestCMO: 'Rourkela', lat: 22.2604, lng: 84.8540 },
  { id: 'PRJ-PAT-01', name: 'Ring Road Package-3', city: 'Patna', state: 'BR', products: ['Cement','TMT Bars'], nearestCMO: 'Patna', lat: 25.5941, lng: 85.1376 },
  { id: 'PRJ-DGR-01', name: 'Industrial Shed Cluster', city: 'Durgapur', state: 'WB', products: ['Coils','TMT Bars'], nearestCMO: 'Durgapur', lat: 23.5204, lng: 87.3119 },
  { id: 'PRJ-BPHB-01', name: 'Smart City Roads', city: 'Bhilai', state: 'CG', products: ['Steel','Cement'], nearestCMO: 'Bhilai', lat: 21.1938, lng: 81.3810 },
];

// Ongoing Major Projects (mock, partial from attached list)
const MAJOR_PROJECTS = [
  { id: 'MP-DEL-01', name: 'Delhi Katra Expressway', products: ['Plates','TMT Bars'], sources: ['BSP','BSL','DSP','ISP','RSP'], route: 'Raipur → Nagpur → Itarsi → Bhopal → Bina → Jhansi → Agra Cantt → Delhi', nearestCMO: 'Delhi', city: 'Delhi', lat: 28.6139, lng: 77.2090 },
  { id: 'MP-DEL-02', name: 'Delhi Meerut RRTS', products: ['Structural Steel','Rails'], sources: ['BSP','DSP','ISP'], route: 'Raipur → Nagpur → Itarsi → Bhopal → Bina → Jhansi → Agra Cantt → Delhi', nearestCMO: 'Delhi', city: 'Delhi', lat: 28.6139, lng: 77.2090 },
  { id: 'MP-HP-01', name: 'Bhanupali–Bilaspur–Beri Railway Gauge Link, HP', products: ['Rails','TMT Bars'], sources: ['BSP','DSP','ISP'], route: 'Raipur → Nagpur → Itarsi → Bhopal → Bina → Jhansi → Delhi → Chandigarh', nearestCMO: 'Chandigarh', city: 'Chandigarh', lat: 30.7333, lng: 76.7794 },
  { id: 'MP-UP-01', name: 'Kanpur Metro, Uttar Pradesh', products: ['Rails','Structural Steel'], sources: ['BSP','DSP','ISP'], route: 'Raipur → Nagpur → Jabalpur → Katni → Satna → Allahabad → Kanpur', nearestCMO: 'Lucknow', city: 'Lucknow', lat: 26.8467, lng: 80.9462 },
  { id: 'MP-BR-01', name: 'Patna Metro (Bihar)', products: ['Structural Steel','Rails'], sources: ['BSP','DSP','ISP'], route: 'Raipur → Bilaspur → Rourkela → Asansol → Mughalsarai → Patna', nearestCMO: 'Patna', city: 'Patna', lat: 25.5941, lng: 85.1376 },
  { id: 'MP-AS-01', name: 'Integrated Directorate Complex, Guwahati', products: ['Structural Steel','TMT Bars'], sources: ['BSP','DSP','ISP'], route: 'Raipur → Bilaspur → Rourkela → Howrah → NJP → Guwahati', nearestCMO: 'Guwahati', city: 'Guwahati', lat: 26.1445, lng: 91.7362 },
  { id: 'MP-WB-01', name: 'Sivok Rangpo Railway Tunnel', products: ['Structural Steel','TMT Bars'], sources: ['BSP','DSP','ISP'], route: 'Durgapur → Howrah → Siliguri → Rangpo', nearestCMO: 'Kolkata', city: 'Kolkata', lat: 22.5726, lng: 88.3639 },
  { id: 'MP-OD-01', name: 'Crude Oil Import Terminal – Paradip', products: ['Plates','Structural Steel'], sources: ['BSP','BSL','DSP','ISP','RSP'], route: 'Bokaro/Rourkela → Jharsuguda → Angul → Bhubaneswar → Paradip', nearestCMO: 'Bhubaneswar', city: 'Bhubaneswar', lat: 20.2961, lng: 85.8245 },
  { id: 'MP-TS-01', name: 'Kaleshwaram Water Pipe Line Project, Telangana', products: ['Structural Steel','TMT Bars'], sources: ['BSP','DSP','ISP'], route: 'Durgapur → Kharagpur → Vijayawada → Secunderabad', nearestCMO: 'Hyderabad', city: 'Hyderabad', lat: 17.3850, lng: 78.4867 },
  { id: 'MP-AP-01', name: 'Amaravati Projects, AP', products: ['TMT Bars','Structural Steel'], sources: ['BSP','DSP','ISP'], route: 'Raipur → Raigarh → Vizianagaram → Visakhapatnam', nearestCMO: 'Visakhapatnam', city: 'Visakhapatnam', lat: 17.6868, lng: 83.2185 },
  { id: 'MP-TN-01', name: 'Chennai Metro Rail Ltd (CMRL)', products: ['Rails','Structural Steel'], sources: ['BSP','DSP','ISP'], route: 'Durgapur → Vijayawada → Chennai', nearestCMO: 'Chennai', city: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { id: 'MP-KL-01', name: 'Kochi Metro Phase II', products: ['Rails','Structural Steel'], sources: ['BSP','DSP','ISP'], route: 'Burnpur → Vijayawada → Chennai → Ernakulam', nearestCMO: 'Cochin', city: 'Kochi', lat: 9.9312, lng: 76.2673 },
  { id: 'MP-MH-01', name: 'Versova Bandra Sea Link, Mumbai', products: ['Plates','Structural Steel'], sources: ['BSP','BSL','DSP','ISP','RSP'], route: 'Raipur → Nagpur → Pune → Mumbai', nearestCMO: 'Mumbai', city: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  { id: 'MP-GJ-01', name: 'Bullet Train (Gujarat Stretch)', products: ['Rails','Structural Steel'], sources: ['BSP','DSP','ISP'], route: 'Raipur → Nagpur → Bhopal → Ahmedabad', nearestCMO: 'Ahmedabad', city: 'Ahmedabad', lat: 23.0225, lng: 72.5714 },
  { id: 'MP-MP-01', name: 'Kalishindh River Linking Project, MP', products: ['Structural Steel','Plates'], sources: ['BSP','BSL','DSP','ISP','RSP'], route: 'Raipur → Nagpur → Bhopal → Indore', nearestCMO: 'Indore', city: 'Indore', lat: 22.7196, lng: 75.8577 },
];

// SAIL Network (subset; extend as needed)
const SAIL_NETWORK = [
  { id: 'CO-DEL', type: 'corporate', name: 'Corporate Office', city: 'New Delhi', state: 'DL', lat: 28.6139, lng: 77.2090, description: 'SAIL Corporate Office', contact: { email: 'info@sail.co.in' }, stats: { category: 'Corporate' } },
  { id: 'ISP-BHILAI', type: 'integrated_plant', name: 'Bhilai Steel Plant', city: 'Bhilai', state: 'CG', lat: 21.1938, lng: 81.3810, description: 'Integrated Steel Plant', stats: { products: ['Long','Flat'] } },
  { id: 'ISP-ROURKELA', type: 'integrated_plant', name: 'Rourkela Steel Plant', city: 'Rourkela', state: 'OD', lat: 22.2604, lng: 84.8540, description: 'Integrated Steel Plant', stats: { products: ['Flat','Plates'] } },
  { id: 'ISP-DURGAPUR', type: 'integrated_plant', name: 'Durgapur Steel Plant', city: 'Durgapur', state: 'WB', lat: 23.5204, lng: 87.3119, description: 'Integrated Steel Plant' },
  { id: 'ISP-BOKARO', type: 'integrated_plant', name: 'Bokaro Steel Plant', city: 'Bokaro', state: 'JH', lat: 23.6693, lng: 86.1511, description: 'Integrated Steel Plant' },
  { id: 'ISP-BURNPUR', type: 'integrated_plant', name: 'IISCO Steel Plant (Burnpur)', city: 'Burnpur', state: 'WB', lat: 23.67, lng: 86.98, description: 'Integrated Steel Plant' },
  { id: 'ASSP-SALEM', type: 'alloy_special', name: 'Salem Steel Plant', city: 'Salem', state: 'TN', lat: 11.6643, lng: 78.1460, description: 'Alloy & Special Steel' },
  { id: 'FAP-CHANDRAPUR', type: 'ferro_alloy', name: 'Chandrapur Ferro Alloy Plant', city: 'Chandrapur', state: 'MH', lat: 19.9615, lng: 79.2961, description: 'Ferro Alloy Plant' },
  { id: 'UNIT-BHADRAVATHI', type: 'unit', name: 'Visvesvaraya Iron & Steel Works', city: 'Bhadravathi', state: 'KA', lat: 13.8483, lng: 75.7050, description: 'Unit' },
  { id: 'UNIT-RANCHI', type: 'unit', name: 'Research & Development Centre', city: 'Ranchi', state: 'JH', lat: 23.3441, lng: 85.3096, description: 'Unit' },
  { id: 'CMO-KOL', type: 'cmo_hq', name: 'CMO Head Quarters', city: 'Kolkata', state: 'WB', lat: 22.5726, lng: 88.3639, description: 'Central Marketing Organisation HQ' },
  { id: 'RO-ER-KOL', type: 'regional_office', name: 'Regional Office (Eastern)', city: 'Kolkata', state: 'WB', lat: 22.5726, lng: 88.3639 },
  { id: 'RO-NR-DEL', type: 'regional_office', name: 'Regional Office (Northern)', city: 'New Delhi', state: 'DL', lat: 28.6139, lng: 77.2090 },
  { id: 'RO-WR-MUM', type: 'regional_office', name: 'Regional Office (Western)', city: 'Mumbai', state: 'MH', lat: 19.0760, lng: 72.8777 },
  { id: 'RO-SR-CHN', type: 'regional_office', name: 'Regional Office (Southern)', city: 'Chennai', state: 'TN', lat: 13.0827, lng: 80.2707 },
  { id: 'SPU-AHD', type: 'spu', name: 'Steel Processing Unit', city: 'Ahmedabad', state: 'GJ', lat: 23.0225, lng: 72.5714 },
  { id: 'SPU-LDH', type: 'spu', name: 'Steel Processing Unit', city: 'Ludhiana', state: 'PB', lat: 30.9009, lng: 75.8573 },
  { id: 'SPU-RIS', type: 'spu', name: 'Steel Processing Unit', city: 'Rishra', state: 'WB', lat: 22.7239, lng: 88.3450 },
  { id: 'SPU-JAG', type: 'spu', name: 'Steel Processing Unit', city: 'Jagdishpur', state: 'UP', lat: 26.7497, lng: 81.5447 },
  { id: 'SPU-BLR', type: 'spu', name: 'Steel Processing Unit', city: 'Bangalore', state: 'KA', lat: 12.9716, lng: 77.5946 },
  { id: 'DW-AHD', type: 'dept_wh', name: 'Departmental Warehouse', city: 'Ahmedabad', state: 'GJ', lat: 23.0225, lng: 72.5714 },
  { id: 'DW-IND', type: 'dept_wh', name: 'Departmental Warehouse', city: 'Indore', state: 'MP', lat: 22.7196, lng: 75.8577 },
  { id: 'DW-PAT', type: 'dept_wh', name: 'Departmental Warehouse', city: 'Patna', state: 'BR', lat: 25.5941, lng: 85.1376 },
  { id: 'DW-FBD', type: 'dept_wh', name: 'Departmental Warehouse', city: 'Faridabad', state: 'HR', lat: 28.4089, lng: 77.3178 },
  { id: 'DW-HYD', type: 'dept_wh', name: 'Departmental Warehouse', city: 'Hyderabad', state: 'TS', lat: 17.3850, lng: 78.4867 },
  { id: 'DW-VSKP', type: 'dept_wh', name: 'Departmental Warehouse', city: 'Visakhapatnam', state: 'AP', lat: 17.6868, lng: 83.2185 },
  { id: 'CA-CHD', type: 'consignment', name: 'Consignment Agent / CHA Yard', city: 'Chandigarh', state: 'CH', lat: 30.7333, lng: 76.7794 },
  { id: 'CA-JAI', type: 'consignment', name: 'Consignment Agent / CHA Yard', city: 'Jaipur', state: 'RJ', lat: 26.9124, lng: 75.7873 },
  { id: 'CA-PUN', type: 'consignment', name: 'Consignment Agent / CHA Yard', city: 'Pune', state: 'MH', lat: 18.5204, lng: 73.8567 },
  { id: 'CA-RAI', type: 'consignment', name: 'Consignment Agent / CHA Yard', city: 'Raipur', state: 'CG', lat: 21.2514, lng: 81.6296 },
  { id: 'CA-CBE', type: 'consignment', name: 'Consignment Agent / CHA Yard', city: 'Coimbatore', state: 'TN', lat: 11.0168, lng: 76.9558 },
  { id: 'CA-CHN', type: 'consignment', name: 'Consignment Agent / CHA Yard', city: 'Chennai', state: 'TN', lat: 13.0827, lng: 80.2707 },
  { id: 'CA-VSKP', type: 'consignment', name: 'Consignment Agent / CHA Yard', city: 'Visakhapatnam', state: 'AP', lat: 17.6868, lng: 83.2185 },
  { id: 'SRM-JAI', type: 'srm', name: 'Sales Resident Manager', city: 'Jaipur', state: 'RJ', lat: 26.9124, lng: 75.7873 },
  { id: 'SRM-AHD', type: 'srm', name: 'Sales Resident Manager', city: 'Ahmedabad', state: 'GJ', lat: 23.0225, lng: 72.5714 },
  { id: 'SRM-MUM', type: 'srm', name: 'Sales Resident Manager', city: 'Mumbai', state: 'MH', lat: 19.0760, lng: 72.8777 },
  { id: 'SRM-BLR', type: 'srm', name: 'Sales Resident Manager', city: 'Bangalore', state: 'KA', lat: 12.9716, lng: 77.5946 },
  { id: 'SRM-HYD', type: 'srm', name: 'Sales Resident Manager', city: 'Hyderabad', state: 'TS', lat: 17.3850, lng: 78.4867 },
  { id: 'SRM-PAT', type: 'srm', name: 'Sales Resident Manager', city: 'Patna', state: 'BR', lat: 25.5941, lng: 85.1376 },
  { id: 'SRM-KOL', type: 'srm', name: 'Sales Resident Manager', city: 'Kolkata', state: 'WB', lat: 22.5726, lng: 88.3639 },
  { id: 'CCO-JSR', type: 'customer_contact', name: 'Customer Contact Office', city: 'Jamshedpur', state: 'JH', lat: 22.8046, lng: 86.2029 },
  { id: 'CCO-NAG', type: 'customer_contact', name: 'Customer Contact Office', city: 'Nagpur', state: 'MH', lat: 21.1458, lng: 79.0882 },
  { id: 'CCO-BBS', type: 'customer_contact', name: 'Customer Contact Office', city: 'Bhubaneswar', state: 'OD', lat: 20.2961, lng: 85.8245 },
  { id: 'SRU-BOK', type: 'refractory', name: 'SAIL Refractory Unit', city: 'Bokaro', state: 'JH', lat: 23.6693, lng: 86.1511 },
  { id: 'LID-PAR', type: 'logistics', name: 'Logistics & Infrastructure Dept.', city: 'Paradip', state: 'OD', lat: 20.3160, lng: 86.6116 },
  { id: 'BSO-NR-CHD', type: 'bso_nr', name: 'Branch Sales Office (NR)', city: 'Chandigarh', state: 'CH', lat: 30.7333, lng: 76.7794 },
  { id: 'BSO-NR-LDH', type: 'bso_nr', name: 'Branch Sales Office (NR)', city: 'Ludhiana', state: 'PB', lat: 30.9009, lng: 75.8573 },
  { id: 'BSO-NR-FBD', type: 'bso_nr', name: 'Branch Sales Office (NR)', city: 'Faridabad', state: 'HR', lat: 28.4089, lng: 77.3178 },
  { id: 'BSO-NR-GZB', type: 'bso_nr', name: 'Branch Sales Office (NR)', city: 'Ghaziabad', state: 'UP', lat: 28.6692, lng: 77.4538 },
  { id: 'BSO-NR-JAI', type: 'bso_nr', name: 'Branch Sales Office (NR)', city: 'Jaipur', state: 'RJ', lat: 26.9124, lng: 75.7873 },
  { id: 'BSO-NR-LKO', type: 'bso_nr', name: 'Branch Sales Office (NR)', city: 'Lucknow', state: 'UP', lat: 26.8467, lng: 80.9462 },
  { id: 'BSO-ER-PAT', type: 'bso_er', name: 'Branch Sales Office (ER)', city: 'Patna', state: 'BR', lat: 25.5941, lng: 85.1376 },
  { id: 'BSO-ER-DHN', type: 'bso_er', name: 'Branch Sales Office (ER)', city: 'Dhanbad', state: 'JH', lat: 23.7957, lng: 86.4304 },
  { id: 'BSO-ER-JSR', type: 'bso_er', name: 'Branch Sales Office (ER)', city: 'Jamshedpur', state: 'JH', lat: 22.8046, lng: 86.2029 },
  { id: 'BSO-ER-ROU', type: 'bso_er', name: 'Branch Sales Office (ER)', city: 'Rourkela', state: 'OD', lat: 22.2604, lng: 84.8540 },
  { id: 'BSO-ER-CTC', type: 'bso_er', name: 'Branch Sales Office (ER)', city: 'Cuttack', state: 'OD', lat: 20.4625, lng: 85.8828 },
  { id: 'BSO-ER-GHY', type: 'bso_er', name: 'Branch Sales Office (ER)', city: 'Guwahati', state: 'AS', lat: 26.1445, lng: 91.7362 },
  { id: 'BSO-ER-SHL', type: 'bso_er', name: 'Branch Sales Office (ER)', city: 'Shillong', state: 'ML', lat: 25.5788, lng: 91.8933 },
  { id: 'BSO-ER-AGT', type: 'bso_er', name: 'Branch Sales Office (ER)', city: 'Agartala', state: 'TR', lat: 23.8315, lng: 91.2868 },
  { id: 'BSO-ER-ITN', type: 'bso_er', name: 'Branch Sales Office (ER)', city: 'Itanagar', state: 'AR', lat: 27.0844, lng: 93.6053 },
  { id: 'BSO-ER-IMP', type: 'bso_er', name: 'Branch Sales Office (ER)', city: 'Imphal', state: 'MN', lat: 24.8170, lng: 93.9368 },
  { id: 'BSO-ER-AIZ', type: 'bso_er', name: 'Branch Sales Office (ER)', city: 'Aizawl', state: 'MZ', lat: 23.7271, lng: 92.7176 },
  { id: 'BSO-ER-KOH', type: 'bso_er', name: 'Branch Sales Office (ER)', city: 'Kohima', state: 'NL', lat: 25.6747, lng: 94.1086 },
  { id: 'BSO-ER-GTK', type: 'bso_er', name: 'Branch Sales Office (ER)', city: 'Gangtok', state: 'SK', lat: 27.3389, lng: 88.6065 },
  { id: 'BSO-WR-AHD', type: 'bso_wr', name: 'Branch Sales Office (WR)', city: 'Ahmedabad', state: 'GJ', lat: 23.0225, lng: 72.5714 },
  { id: 'BSO-WR-IND', type: 'bso_wr', name: 'Branch Sales Office (WR)', city: 'Indore', state: 'MP', lat: 22.7196, lng: 75.8577 },
  { id: 'BSO-WR-PUN', type: 'bso_wr', name: 'Branch Sales Office (WR)', city: 'Pune', state: 'MH', lat: 18.5204, lng: 73.8567 },
  { id: 'BSO-WR-NAG', type: 'bso_wr', name: 'Branch Sales Office (WR)', city: 'Nagpur', state: 'MH', lat: 21.1458, lng: 79.0882 },
  { id: 'BSO-WR-RAI', type: 'bso_wr', name: 'Branch Sales Office (WR)', city: 'Raipur', state: 'CG', lat: 21.2514, lng: 81.6296 },
  { id: 'BSO-WR-BHI', type: 'bso_wr', name: 'Branch Sales Office (WR)', city: 'Bhilai', state: 'CG', lat: 21.1938, lng: 81.3810 },
  { id: 'BSO-WR-JAB', type: 'bso_wr', name: 'Branch Sales Office (WR)', city: 'Jabalpur', state: 'MP', lat: 23.1815, lng: 79.9864 },
  { id: 'BSO-WR-BHO', type: 'bso_wr', name: 'Branch Sales Office (WR)', city: 'Bhopal', state: 'MP', lat: 23.2599, lng: 77.4126 },
  { id: 'BSO-WR-BAR', type: 'bso_wr', name: 'Branch Sales Office (WR)', city: 'Vadodara', state: 'GJ', lat: 22.3072, lng: 73.1812 },
  { id: 'BSO-WR-SUR', type: 'bso_wr', name: 'Branch Sales Office (WR)', city: 'Surat', state: 'GJ', lat: 21.1702, lng: 72.8311 },
  { id: 'BSO-SR-BLR', type: 'bso_sr', name: 'Branch Sales Office (SR)', city: 'Bangalore', state: 'KA', lat: 12.9716, lng: 77.5946 },
  { id: 'BSO-SR-CHN', type: 'bso_sr', name: 'Branch Sales Office (SR)', city: 'Chennai', state: 'TN', lat: 13.0827, lng: 80.2707 },
  { id: 'BSO-SR-CBE', type: 'bso_sr', name: 'Branch Sales Office (SR)', city: 'Coimbatore', state: 'TN', lat: 11.0168, lng: 76.9558 },
  { id: 'BSO-SR-COK', type: 'bso_sr', name: 'Branch Sales Office (SR)', city: 'Kochi', state: 'KL', lat: 9.9312, lng: 76.2673 },
  { id: 'BSO-SR-TVM', type: 'bso_sr', name: 'Branch Sales Office (SR)', city: 'Trivandrum', state: 'KL', lat: 8.5241, lng: 76.9366 },
  { id: 'BSO-SR-SBD', type: 'bso_sr', name: 'Branch Sales Office (SR)', city: 'Secunderabad', state: 'TS', lat: 17.4399, lng: 78.4983 },
  { id: 'BSO-SR-VSKP', type: 'bso_sr', name: 'Branch Sales Office (SR)', city: 'Visakhapatnam', state: 'AP', lat: 17.6868, lng: 83.2185 },
  { id: 'BSO-SR-MDU', type: 'bso_sr', name: 'Branch Sales Office (SR)', city: 'Madurai', state: 'TN', lat: 9.9252, lng: 78.1198 },
  { id: 'BSO-SR-PDY', type: 'bso_sr', name: 'Branch Sales Office (SR)', city: 'Puducherry', state: 'PY', lat: 11.9416, lng: 79.8083 },
];

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
  { id: 3, email: 'yard@sail.test', role: 'yard' },
  { id: 4, email: 'supervisor@sail.test', role: 'supervisor' },
  // Crew user for simulation controls
  { id: 5, email: 'crew@sail.test', role: 'crew' },
];
// OTP recipient overrides (send OTP to these real inboxes for given usernames)
const OTP_RECIPIENT_MAP = {
  'admin@sail.test': 'sanu826010@gmail.com',
  'manager@sail.test': 'sanu826010@gmail.com',
  'yard@sail.test': 'sanu826010@gmail.com',
  'supervisor@sail.test': 'sanu826010@gmail.com',
  'cmo@sail.test': 'sanu826010@gmail.com',
  'crew@sail.test': 'sanu826010@gmail.com'
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

// Helper: demo alias email normalization and validation
const DEMO_ALIAS_MAP = {
  // Common typos: map .text -> .test for demo users
  'admin@sail.text': 'admin@sail.test',
  'manager@sail.text': 'manager@sail.test',
  'yard@sail.text': 'yard@sail.test',
  'supervisor@sail.text': 'supervisor@sail.test',
  'cmo@sail.text': 'cmo@sail.test',
  'crew@sail.text': 'crew@sail.test',
};
function normalizeDemoEmail(rawEmail) {
  const e = String(rawEmail || '').trim().toLowerCase();
  return DEMO_ALIAS_MAP[e] || e;
}
function isValidEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim());
}

// Request OTP via email
app.post('/auth/request-otp', async (req, res) => {
  // Accept aliases like "manager.sail@test" then normalize to a canonical email
  const schema = z.object({ email: z.string().trim().min(3, 'Enter a valid email') });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(422).json({ error: 'validation_error', errors: zodFieldErrors(parsed.error) });
  const rawEmail = parsed.data.email;
  const email = normalizeDemoEmail(rawEmail);
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
  // generate code and store (use normalized email as the OTP key)
  const code = String(Math.floor(100000 + Math.random()*900000));
  await otpSet(email, code, 5 * 60);

  const SMTP_HOST = process.env.SMTP_HOST || '';
  const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
  const SMTP_USER = process.env.SMTP_USER || '';
  const SMTP_PASS = process.env.SMTP_PASS || '';
  const SMTP_FROM = process.env.SMTP_FROM || 'noreply@qsteel.local';
  const disableEmail = process.env.DISABLE_EMAIL === '1' || (!SMTP_HOST || !SMTP_USER || !SMTP_PASS);

  if (disableEmail) {
    // Email disabled: optionally log OTP for dev convenience, controlled by env flag
    if (process.env.OTP_DEV_LOG === '1') {
      const missing = [];
      if (!SMTP_HOST) missing.push('SMTP_HOST');
      if (!SMTP_USER) missing.push('SMTP_USER');
      if (!SMTP_PASS) missing.push('SMTP_PASS');
      console.log(`[QSTEEL][AUTH] OTP(for dev) email=${email} code=${code} exp=5m (email disabled, missing: ${missing.join(',') || 'DISABLE_EMAIL flag or unknown'})`);
    }
    const hint = /@sail\.test$/i.test(email) ? ' For demo users, you can also try OTP 123456.' : '';
    return res.json({ ok: true, message: 'OTP generated. Email delivery disabled by config.' + hint });
  }
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      logger: process.env.SMTP_DEBUG === '1',
      debug: process.env.SMTP_DEBUG === '1'
    });
    if (process.env.OTP_DEBUG === '1') {
      try {
        await transporter.verify();
        console.log('[OTP][SMTP] transporter verify OK');
      } catch (verErr) {
        console.warn('[OTP][SMTP] transporter verify FAILED:', verErr?.message || verErr);
      }
    }
    // Prefer routing based on the raw alias if provided, then fall back to normalized
    const toEmail = OTP_RECIPIENT_MAP[rawEmail] || OTP_RECIPIENT_MAP[email] || email;
    const info = await transporter.sendMail({
      from: SMTP_FROM,
      to: toEmail,
      subject: 'Your QSTEEL OTP Code',
      text: `Your OTP is ${code}. It will expire in 5 minutes.`,
      html: `<p>Your OTP is <b>${code}</b>. It will expire in 5 minutes.</p>`
    });
    if (process.env.OTP_DEBUG === '1') {
      console.log('[OTP] dispatched', { entered: rawEmail, normalized: email, to: toEmail, codeMasked: code.replace(/^(\d{4})/, '****'), messageId: info?.messageId, accepted: info?.accepted, rejected: info?.rejected });
    }
    if (process.env.OTP_DEV_LOG === '1' && /@sail\.test$/i.test(email)) {
      console.log(`[OTP][DEV] email=${email} code=${code} exp=5m`);
    }
    res.json({ ok: true, messageId: info.messageId, to: toEmail });
  } catch (e) {
    console.warn('SMTP send failed:', e?.message || e);
    // Do not include OTP in response
    res.status(500).json({ error: 'Failed to send OTP via email. Please try again later.' });
  }
});

// Lightweight diagnostics (no secrets). Returns whether SMTP looks enabled and what mappings exist.
app.get('/auth/diagnostics/otp', (req, res) => {
  const SMTP_HOST = !!process.env.SMTP_HOST;
  const SMTP_USER = !!process.env.SMTP_USER;
  const SMTP_PASS = !!process.env.SMTP_PASS;
  const SMTP_FROM = !!process.env.SMTP_FROM;
  const disableEmail = process.env.DISABLE_EMAIL === '1' || !(SMTP_HOST && SMTP_USER && SMTP_PASS);
  res.json({
    ok: true,
    disableEmail,
    envFlags: { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM, DISABLE_EMAIL: process.env.DISABLE_EMAIL === '1' },
    aliases: DEMO_ALIAS_MAP,
    mapping: OTP_RECIPIENT_MAP,
  });
});

// Dev test email endpoint (disabled in production unless explicitly allowed)
app.post('/auth/dev/test-email', async (req, res) => {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEV_TEST_EMAIL) {
    return res.status(403).json({ error: 'Disabled in production' });
  }
  const schema = z.object({ to: z.string().email(), subject: z.string().optional(), body: z.string().optional() });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  const { to, subject, body } = parsed.data;
  const SMTP_HOST = process.env.SMTP_HOST || '';
  const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
  const SMTP_USER = process.env.SMTP_USER || '';
  const SMTP_PASS = process.env.SMTP_PASS || '';
  const SMTP_FROM = process.env.SMTP_FROM || 'noreply@qsteel.local';
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return res.status(400).json({ error: 'SMTP not configured' });
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      logger: process.env.SMTP_DEBUG === '1',
      debug: process.env.SMTP_DEBUG === '1'
    });
    const info = await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject: subject || 'QSTEEL Test Email',
      text: body || 'Test email from QSTEEL dev endpoint.',
    });
    res.json({ ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
  } catch (e) {
    console.warn('[DEV][EMAIL] send failed:', e?.message || e);
    res.status(500).json({ error: 'Send failed', message: e?.message || String(e) });
  }
});

app.post('/auth/login', async (req, res) => {
  // Accept demo aliases and normalize before OTP verification
  const schema = z.object({ email: z.string().min(3), otp: z.string().regex(/^\d{6}$/) });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  const rawEmail = parsed.data.email;
  const email = normalizeDemoEmail(rawEmail);
  const { otp } = parsed.data;
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email address' });
  // Prefer server-stored OTP when available; allow 123456 as dev override for demo users
  let valid = false;
  const stored = await otpGet(email);
  if (stored && stored.code === otp && Date.now() <= stored.expMs) {
    valid = true; await otpDel(email);
  }
  // Dev override: only for *.sail.test demo users
  if (!valid && /@sail\.test$/i.test(email) && otp === '123456') {
    valid = true;
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

// Multi-role auth: allow any of the given roles (or admin)
function authAny(roles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (Array.isArray(roles) && roles.length) {
        if (payload.role !== 'admin' && !roles.includes(payload.role)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
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

// Simple ETA mock endpoint: accepts sourcePlant (BKSC/DGR/ROU/BPHB) and destination string
// Optional: currentLocation, speedKph, dwellHours
app.post('/ai/eta', auth(), (req, res) => {
  try {
    const schema = z.object({
      sourcePlant: z.enum(['BKSC','DGR','ROU','BPHB']).optional(),
      source: z.string().optional(),
      destination: z.string(),
      currentLocation: z.string().optional(),
      speedKph: z.number().positive().optional(),
      dwellHours: z.number().nonnegative().optional(),
      departedAt: z.string().optional(),
      context: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
    const { sourcePlant, source, destination, currentLocation, speedKph = 50, dwellHours = 3, departedAt, context } = parsed.data;
  const plantCity = { BKSC: 'Bokaro', DGR: 'Durgapur', ROU: 'Rourkela', BPHB: 'Bhilai' }[sourcePlant || 'BKSC'] || (source || 'Bokaro');
  const from = currentLocation || plantCity;
  const to = destination.split(',')[0] || destination;
  const distanceKm = getDistance(from, to);
  const congestionMul = 1 + (Math.random() * 0.3); // up to +30%
  const weatherMul = 1 + (Math.random() * 0.15);   // up to +15%
    const transitHours = Math.max(1, (distanceKm / speedKph) * congestionMul * weatherMul) + dwellHours;
    const etaBase = departedAt ? new Date(departedAt).getTime() : Date.now();
    const eta = new Date(etaBase + transitHours * 3600 * 1000).toISOString();
    // Confidence decreases as congestion/weather multipliers rise
    const noise = (Math.random()*0.06) - 0.03; // +/- 0.03
    const rawConf = 0.9 - (Math.max(0, congestionMul - 1) * 0.4) - (Math.max(0, weatherMul - 1) * 0.6) + noise;
    const confidence = Number(Math.max(0.5, Math.min(0.98, rawConf)).toFixed(2));
    const risk = {
      congestion: congestionMul > 1.25 ? 'high' : congestionMul > 1.1 ? 'medium' : 'low',
      weather: weatherMul > 1.08 ? 'rain' : 'clear'
    };
    const result = {
      eta,
      transitHours: Number(transitHours.toFixed(1)),
      confidence,
      route: { from, to, distanceKm: Number(distanceKm.toFixed(1)) },
      multipliers: { congestion: Number(congestionMul.toFixed(2)), weather: Number(weatherMul.toFixed(2)) },
    };
    try { pushEvent({ type: 'customer_eta_recalc', page: context ? `/customer/${context}` : '/ai/eta', action: 'recalc_eta', role: req.user?.role||'guest', user: req.user?.email||'', meta: { sourcePlant, source, destination, currentLocation, speedKph, dwellHours, result }, ts: Date.now() }); } catch {}
    return res.json({
      eta,
      transitHours: Number(transitHours.toFixed(1)),
      confidence,
      factors: { speedKph, dwellHours },
      route: { from, to, distanceKm: Number(distanceKm.toFixed(1)) },
      multipliers: { congestion: Number(congestionMul.toFixed(2)), weather: Number(weatherMul.toFixed(2)) },
      risk,
    });
  } catch (e) {
    res.status(500).json({ error: 'eta_failed', detail: e?.message || String(e) });
  }
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

// Wagon health telemetry (mock) - yard role
function generateWagonHealth(seed = Date.now()) {
  // deterministic-ish via seed shifting
  const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
  const now = Date.now();
  const sample = (id) => ({
    id: `WGN${id.toString().padStart(4,'0')}`,
    lastBrakeTest: new Date(now - (rand()*72)*3600*1000).toISOString(),
    brakeTestStatus: rand() < 0.92 ? 'PASS' : 'FAIL',
    wheelWearMm: Number((6 + rand()*4).toFixed(1)),
    wheelWearPercent: Number((rand()*55 + 20).toFixed(1)),
    bearingTempC: Number((45 + rand()*25).toFixed(1)),
    vibrationG: Number((0.3 + rand()*0.7).toFixed(2)),
    sensors: {
      acoustic: rand() < 0.95 ? 'OK' : 'ALERT',
      infrared: rand() < 0.9 ? 'OK' : 'HOT',
      loadCell: rand() < 0.93 ? 'OK' : 'CALIBRATE'
    },
    mileageSinceServiceKm: Math.floor(2000 + rand()*8000),
    nextServiceDueKm: 12000,
    alerts: []
  });
  const wagons = Array.from({length: 18}).map((_,i)=> sample(i+1));
  wagons.forEach(w => {
    if (w.brakeTestStatus === 'FAIL') w.alerts.push('Brake test failed');
    if (w.wheelWearPercent > 65) w.alerts.push('High wheel wear');
    if (w.bearingTempC > 65) w.alerts.push('Bearing overheating');
    if (w.sensors.acoustic === 'ALERT') w.alerts.push('Acoustic anomaly');
    if (w.sensors.infrared === 'HOT') w.alerts.push('Infrared hotspot');
    if (w.sensors.loadCell === 'CALIBRATE') w.alerts.push('Load cell calibration needed');
  });
  const kpis = {
    total: wagons.length,
    brakeCompliance: Number((wagons.filter(w=> w.brakeTestStatus==='PASS').length / wagons.length *100).toFixed(1)),
    avgWheelWear: Number((wagons.reduce((s,w)=> s + w.wheelWearPercent,0)/wagons.length).toFixed(1)),
    overWearCount: wagons.filter(w=> w.wheelWearPercent>65).length,
    sensorAlertRate: Number((wagons.filter(w=> w.alerts.some(a=> a.toLowerCase().includes('hot')||a.toLowerCase().includes('acoustic'))).length / wagons.length *100).toFixed(1)),
    avgBearingTemp: Number((wagons.reduce((s,w)=> s + w.bearingTempC,0)/wagons.length).toFixed(1))
  };
  return { kpis, wagons, generatedAt: new Date().toISOString() };
}

app.get('/yard/wagon-health', auth('yard'), async (req, res) => {
  try {
    const data = generateWagonHealth();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to build wagon health data', detail: e?.message || String(e) });
  }
});

// --- Yard Safety Mock Data + Streaming History ---
const SAFETY_HISTORY = [];
const MAX_SAFETY_HISTORY = 60; // keep last 60 snapshots

function generateSafetyData(seed = Date.now()) {
  const rand = () => { const x = Math.sin(seed++) * 10000; return x - Math.floor(x); };
  const shifts = ['Morning','Afternoon','Night'];
  const checklistTemplates = [
    { id: 'CHK-PPE', title: 'PPE Compliance', items: ['Helmets','Gloves','Eye Protection','Hi-Vis Vests','Safety Boots'] },
    { id: 'CHK-HOUSE', title: 'Housekeeping', items: ['Clear Aisles','No Oil Spills','Material Stacking','Waste Segregation'] },
    { id: 'CHK-EQ', title: 'Equipment Readiness', items: ['Forklift Inspection','Crane Limit Switch','Fire Extinguishers','First Aid Kits'] }
  ];
  const completed = checklistTemplates.map(t => ({
    id: t.id,
    title: t.title,
    shift: shifts[Math.floor(rand()*shifts.length)],
    completedAt: new Date(Date.now() - rand()*6*3600*1000).toISOString(),
    items: t.items.map(name => ({ name, status: rand() < 0.9 ? 'OK' : 'ISSUE', note: rand() < 0.15 ? 'Minor deviation' : '' }))
  }));
  const incidents = Array.from({length: 6}).map((_,i)=> ({
    id: `INC${202+i}`,
    type: rand() < 0.3 ? 'Near Miss' : (rand()<0.5 ? 'Minor Injury' : 'Unsafe Condition'),
    severity: rand() < 0.7 ? 'Low' : (rand()<0.9? 'Medium':'High'),
    description: rand()<0.5? 'Slip hazard near loading bay':'Unshielded moving part observed',
    reportedBy: rand()<0.5? 'yard@sail.test':'hse@qsteel.local',
    shift: shifts[Math.floor(rand()*shifts.length)],
    status: rand()<0.6? 'Open': 'Closed',
    ts: new Date(Date.now() - rand()*24*3600*1000).toISOString()
  }));
  const compliance = {
    ppe: Number((85 + rand()*12).toFixed(1)),
    housekeeping: Number((80 + rand()*15).toFixed(1)),
    equipment: Number((78 + rand()*18).toFixed(1)),
    trainingCompletion: Number((70 + rand()*25).toFixed(1)),
    lastLostTimeIncidentDays: Math.floor(20 + rand()*40)
  };
  const openIssues = completed.flatMap(c => c.items.filter(i => i.status==='ISSUE').map(i => ({ checklist: c.id, item: i.name, note: i.note })));
  const summary = {
    totalIncidents: incidents.length,
    openIncidentCount: incidents.filter(i=> i.status==='Open').length,
    highSeverity: incidents.filter(i=> i.severity==='High').length,
    checklistIssues: openIssues.length,
    complianceScore: Number(((compliance.ppe+compliance.housekeeping+compliance.equipment)/3).toFixed(1))
  };
  return { summary, compliance, incidents, checklists: completed, openIssues, generatedAt: new Date().toISOString() };
}

function pushSafetySnapshot() {
  const snap = generateSafetyData();
  SAFETY_HISTORY.push(snap);
  if (SAFETY_HISTORY.length > MAX_SAFETY_HISTORY) SAFETY_HISTORY.shift();
  return snap;
}

// Seed some historical data if empty (simulate past 10 * 2min intervals)
if (SAFETY_HISTORY.length === 0) {
  const seedBase = Date.now() - (10 * 2 * 60 * 1000);
  for (let i=0;i<10;i++) {
    const snap = generateSafetyData(seedBase + i*1337);
    // backdate timestamp
    snap.generatedAt = new Date(seedBase + i*2*60*1000).toISOString();
    SAFETY_HISTORY.push(snap);
  }
}

// Periodic generation + websocket broadcast
setInterval(() => {
  const snap = pushSafetySnapshot();
  try { io.emit('safety:update', { snapshot: snap }); } catch {}
}, 20000); // every 20s

app.get('/yard/safety', auth('yard'), (req, res) => {
  try {
    // ensure we have a fresh snapshot (but avoid generating twice within 5s)
    const last = SAFETY_HISTORY[SAFETY_HISTORY.length -1];
    if (!last || Date.now() - new Date(last.generatedAt).getTime() > 5000) {
      pushSafetySnapshot();
    }
    res.json(SAFETY_HISTORY[SAFETY_HISTORY.length -1]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to build safety data', detail: e?.message || String(e) });
  }
});

app.get('/yard/safety/history', auth('yard'), (req, res) => {
  try {
    res.json(SAFETY_HISTORY.map(s => ({ generatedAt: s.generatedAt, compliance: s.compliance, summary: s.summary })));
  } catch (e) {
    res.status(500).json({ error: 'Failed to build safety history', detail: e?.message || String(e) });
  }
});

app.get('/yard/safety/export.csv', auth('yard'), (req, res) => {
  const data = SAFETY_HISTORY[SAFETY_HISTORY.length -1] || pushSafetySnapshot();
  const header = 'id,type,severity,status,shift,reportedBy,ts';
  const rows = data.incidents.map(i=> [i.id,i.type,i.severity,i.status,i.shift,i.reportedBy,i.ts].join(','));
  const meta = `# generatedAt=${data.generatedAt},openIncidents=${data.summary.openIncidentCount},highSeverity=${data.summary.highSeverity}`;
  const csv = [meta, header, ...rows].join('\n');
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="yard-safety-incidents.csv"');
  try { pushEvent({ type: 'export', page: '/yard/safety', action: 'export_csv', role: req.user?.role||'yard', user: req.user?.email||'', meta: { count: rows.length } , ts: Date.now()}); } catch {}
  res.send(csv);
});

// Wagon detail with synthetic trend series for spark lines
app.get('/yard/wagon-health/:id', auth('yard'), (req, res) => {
  try {
    const id = req.params.id.toUpperCase();
    const base = generateWagonHealth(id.split('').reduce((a,c)=> a + c.charCodeAt(0), 0));
    const wagon = base.wagons.find(w=> w.id === id);
    if (!wagon) return res.status(404).json({ error: 'Not found'});
    const points = 12;
    const seed = id.split('').reduce((a,c)=> a + c.charCodeAt(0), 42);
    let s = seed;
    const r = () => { const x = Math.sin(s++) * 10000; return x - Math.floor(x); };
    const series = Array.from({length: points}).map((_,i)=> ({
      t: i - (points-1),
      bearingTempC: Number((wagon.bearingTempC + (r()*6-3) + (i/points)*2).toFixed(1)),
      wheelWearPercent: Number((wagon.wheelWearPercent - 2 + r()*4).toFixed(1)),
      vibrationG: Number((wagon.vibrationG + (r()*0.2-0.1)).toFixed(2))
    }));
    res.json({ wagon, trends: series, generatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate detail', detail: e?.message || String(e) });
  }
});

// CSV export
app.get('/yard/wagon-health/export.csv', auth('yard'), (req, res) => {
  const { wagons, kpis, generatedAt } = generateWagonHealth();
  const header = 'id,brakeTestStatus,wheelWearPercent,bearingTempC,vibrationG,alerts';
  const rows = wagons.map(w=> [w.id,w.brakeTestStatus,w.wheelWearPercent,w.bearingTempC,w.vibrationG,`"${w.alerts.join('|')}"`].join(','));
  const meta = `# generatedAt=${generatedAt},total=${kpis.total},brakeCompliance=${kpis.brakeCompliance}`;
  const csv = [meta, header, ...rows].join('\n');
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="wagon-health.csv"');
  try { pushEvent({ type: 'export', page: '/yard/wagon-health', action: 'export_csv', role: req.user?.role||'yard', user: req.user?.email||'', meta: { total: kpis.total } , ts: Date.now()}); } catch {}
  res.send(csv);
});

// PDF export snapshot
app.get('/yard/wagon-health/export.pdf', auth('yard'), (req, res) => {
  try {
    const { wagons, kpis, generatedAt } = generateWagonHealth();
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="wagon-health.pdf"');
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    doc.pipe(res);
    doc.fontSize(18).fillColor('#111827').text('QSTEEL — Wagon Health Snapshot');
    doc.moveDown(0.5).fontSize(9).fillColor('#6B7280').text(`Generated: ${generatedAt}`);
    doc.moveDown(0.5).fontSize(11).fillColor('#111827').text('KPIs');
    doc.fontSize(9).fillColor('#111827');
    const kpiEntries = Object.entries(kpis);
    kpiEntries.forEach(([k,v])=> doc.text(`${k}: ${v}`));
    doc.moveDown(0.5).fontSize(11).text('Wagons');
    doc.fontSize(8);
    const cols = ['ID','Brake','Wear%','Bearing','Vibe','Alerts'];
    doc.text(cols.join(' | '));
    doc.moveDown(0.2);
    wagons.slice(0,60).forEach(w=> {
      doc.text(`${w.id} | ${w.brakeTestStatus} | ${w.wheelWearPercent} | ${w.bearingTempC} | ${w.vibrationG} | ${w.alerts.join('; ')}`);
    });
    doc.end();
  } catch (e) {
    res.status(500).json({ error: 'Failed to export PDF', detail: e?.message || String(e) });
  }
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

// --- Stockyard inventory endpoints (products per yard) ---
const STOCKYARD_NAMES = ['Bhilai','Rourkela','Patna','Durgapur','Delhi','Indore','Chennai','Mumbai','Visakhapatnam','Kolkata'];
const STOCK_PRODUCTS = ['TMT Bars','Hot Rolled','Galvanised Sheet','Coils','Billets'];
const slugify = (s)=> String(s||'').toLowerCase().replace(/\s+/g,'-');
function seededQty(name, product) {
  const str = `${name}:${product}`; let h = 0; for (let i=0;i<str.length;i++) { h = ((h<<5)-h) + str.charCodeAt(i); h|=0; }
  const base = Math.abs(h % 500); return 200 + base; // 200..699 tons
}

// List all stockyards with product inventory
app.get('/stock/yard', authAny(['supervisor']), async (_req, res) => {
  const list = STOCKYARD_NAMES.map(n => ({
    slug: slugify(n),
    name: n,
    products: STOCK_PRODUCTS.reduce((acc, p) => { acc[p] = seededQty(n, p); return acc; }, {})
  }));
  res.json({ yards: list });
});

// Get one stockyard by slug
app.get('/stock/yard/:slug', authAny(['supervisor']), async (req, res) => {
  const slug = String(req.params.slug||'');
  const name = STOCKYARD_NAMES.find(n => slugify(n) === slug);
  if (!name) return res.status(404).json({ error: 'Stockyard not found' });
  const products = STOCK_PRODUCTS.reduce((acc, p) => { acc[p] = seededQty(name, p); return acc; }, {});
  res.json({ slug, name, products });
});

// Incoming rakes for a yard (filter if name provided)
app.get('/yard/incoming', authAny(['yard','supervisor','manager','admin']), async (req, res) => {
  const yardName = String(req.query.yard || '').trim();
  if (prisma) {
    try {
      // Pending rakes, optionally filter by yard name
      const where = { status: 'PENDING', ...(yardName ? { yard: { name: { equals: yardName, mode: 'insensitive' } } } : {}) };
      const rakes = await prisma.rake.findMany({ where, include: { yard: true }, take: 20 });
      return res.json(rakes.map(r=> ({ code: r.code, status: r.status, yard: r.yard?.name || null })));
    } catch (e) { /* fallthrough */ }
  }
  // Fallback: subset of MOCK list
  const all = [
    { code: 'rake-101', yard: 'Bhilai', status: 'PENDING' },
    { code: 'rake-202', yard: 'Rourkela', status: 'PENDING' },
    { code: 'rake-303', yard: 'Durgapur', status: 'PENDING' },
  ];
  const arr = yardName ? all.filter(a => a.yard.toLowerCase() === yardName.toLowerCase()) : all;
  res.json(arr);
});

// Pending dispatches for a yard (simple heuristic on orders)
app.get('/yard/dispatches', authAny(['yard','supervisor','manager','admin']), async (req, res) => {
  const yardName = String(req.query.yard || '').trim();
  if (prisma) {
    try {
      // Use orders with PENDING/APPROVED as pending dispatches; optionally filter by destination matching yard city
      const orders = await prisma.order.findMany({
        where: { status: { in: ['PENDING','APPROVED'] }, ...(yardName ? { destination: { contains: yardName, mode: 'insensitive' } } : {}) },
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: { customer: { select: { name: true } } }
      });
      return res.json(orders.map(o => ({ id: o.orderId, customer: o.customer?.name || '', cargo: `${o.cargo} (${o.quantityTons}t)` })));
    } catch (e) { /* fallthrough */ }
  }
  // Fallback: mock few lines
  const items = [
    { id: 'P1', customer: 'ABC Steel', cargo: 'TMT Bars (240t)' },
    { id: 'P2', customer: 'XYZ Infra', cargo: 'Coils (180t)' },
    { id: 'P3', customer: 'Metro JV', cargo: 'Galvanised Sheet (120t)' },
  ];
  try {
    // Show manager-issued internal orders as pending dispatches too
    const internal = PENDING_INTERNAL_ORDERS
      .filter(o => !yardName || (o.destination||'').toLowerCase().includes(yardName.toLowerCase()))
      .slice(-10)
      .map(o => ({ id: o.id, customer: 'Internal', cargo: `${o.product} (${o.quantityTons}t)` }));
    items.unshift(...internal);
  } catch {}
  res.json(items);
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

// =========================
// Supervisor → Manager: Low Stock Report + Manager Order to Yard
// =========================
// Supervisors create a low stock alert with product and stockyard city
app.post('/stock/low-stock/report', authAny(['supervisor','admin']), async (req, res) => {
  try {
    const schema = z.object({
      stockyardCity: z.string().min(2),
      product: z.string().min(2),
      currentTons: z.number().nonnegative().optional(),
      thresholdTons: z.number().nonnegative().optional(),
      requiredTons: z.number().positive().optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
    const payload = parsed.data;
    const item = {
      id: 'LS-' + Math.random().toString(36).slice(2,8).toUpperCase(),
      stockyardCity: payload.stockyardCity,
      product: payload.product,
      currentTons: payload.currentTons ?? null,
      thresholdTons: payload.thresholdTons ?? null,
      requiredTons: payload.requiredTons ?? null,
      reporter: req.user?.email || 'unknown',
      ts: new Date().toISOString(),
    };
    // Persist to DB when available
    if (prisma) {
      try {
        await prisma.lowStockReport.create({ data: {
          stockyardCity: item.stockyardCity,
          product: item.product,
          currentTons: item.currentTons != null ? Math.round(item.currentTons) : null,
          thresholdTons: item.thresholdTons != null ? Math.round(item.thresholdTons) : null,
          requiredTons: item.requiredTons != null ? Math.round(item.requiredTons) : null,
          reporter: item.reporter,
        } });
      } catch (e) { console.warn('[low-stock/report] DB persist failed:', e?.message || e); }
    } else {
      LOW_STOCK_REPORTS.push(item);
    }
    // Optional: broadcast alert
    try { io.emit('alert', { type: 'low_stock', message: `${item.product} low at ${item.stockyardCity}`, level: 'warning', ts: Date.now(), meta: item }); } catch {}
    res.json({ ok: true, report: item });
  } catch (e) {
    res.status(500).json({ error: 'report_failed', detail: e?.message || String(e) });
  }
});

// Managers fetch low stock reports (latest first)
app.get('/stock/low-stock/reports', authAny(['manager','admin']), async (_req, res) => {
  try {
    if (prisma) {
      try {
        const rows = await prisma.lowStockReport.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
        return res.json({ reports: rows.map(r => ({
          id: r.id,
          stockyardCity: r.stockyardCity,
          product: r.product,
          currentTons: r.currentTons,
          thresholdTons: r.thresholdTons,
          requiredTons: r.requiredTons,
          reporter: r.reporter,
          status: r.status,
          ackBy: r.ackBy,
          ackAt: r.ackAt ? (r.ackAt instanceof Date ? r.ackAt.toISOString() : String(r.ackAt)) : null,
          clearedBy: r.clearedBy,
          clearedAt: r.clearedAt ? (r.clearedAt instanceof Date ? r.clearedAt.toISOString() : String(r.clearedAt)) : null,
          ts: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt)
        })) });
      } catch (e) { console.warn('[low-stock/reports] DB fetch failed:', e?.message || e); }
    }
    const list = LOW_STOCK_REPORTS.slice().reverse().slice(0, 100);
    res.json({ reports: list });
  } catch (e) {
    res.status(500).json({ error: 'list_failed', detail: e?.message || String(e) });
  }
});

// Acknowledge a low stock report
app.post('/stock/low-stock/:id/ack', authAny(['manager','admin']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!prisma) return res.status(503).json({ error: 'DB required for ack' });
  try {
    const row = await prisma.lowStockReport.update({ where: { id }, data: { status: 'ACKNOWLEDGED', ackBy: req.user?.email || 'manager', ackAt: new Date() } });
    try { io.emit('alert', { type: 'low_stock_ack', level: 'info', ts: Date.now(), message: `Low stock acknowledged for ${row.product} @ ${row.stockyardCity}` }); } catch {}
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: 'not_found' });
  }
});

// Clear a low stock report
app.post('/stock/low-stock/:id/clear', authAny(['manager','admin']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!prisma) return res.status(503).json({ error: 'DB required for clear' });
  try {
    const row = await prisma.lowStockReport.update({ where: { id }, data: { status: 'CLEARED', clearedBy: req.user?.email || 'manager', clearedAt: new Date() } });
    try { io.emit('alert', { type: 'low_stock_cleared', level: 'info', ts: Date.now(), message: `Low stock cleared for ${row.product} @ ${row.stockyardCity}` }); } catch {}
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: 'not_found' });
  }
});

// Manager issues an internal order for a rake plan from Bokaro Steel Plant to the given stockyard
app.post('/manager/orders/issue', authAny(['manager','admin']), async (req, res) => {
  try {
    const schema = z.object({
      stockyardCity: z.string().min(2),
      product: z.string().min(2),
      quantityTons: z.number().positive(),
      priority: z.enum(['Normal','Urgent']).default('Urgent').optional(),
      sourcePlant: z.string().default('Bokaro Steel Plant').optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
    const { stockyardCity, product, quantityTons, priority = 'Urgent', sourcePlant = 'Bokaro Steel Plant' } = parsed.data;

    // Try to persist as a customer order-like record when DB is available
    let saved = null;
    if (prisma) {
      try {
        saved = await prisma.order.create({
          data: {
            customer: { create: { name: 'Internal', company: 'QSTEEL', email: `internal-${Date.now()}@qsteel.local`, phone: '0000000000', passwordHash: '!' } },
            cargo: product,
            quantityTons: Math.round(quantityTons),
            sourcePlant: sourcePlant,
            destination: stockyardCity,
            priority: priority,
            status: 'APPROVED',
            estimateCost: Math.round(quantityTons * 1200),
          }
        });
      } catch (e) {
        console.warn('[manager/orders/issue] DB create failed, falling back:', e?.message || e);
      }
    }
    if (!saved) {
      const tmp = {
        id: 'INT-' + Math.random().toString(36).slice(2,8).toUpperCase(),
        destination: stockyardCity,
        product,
        quantityTons: Math.round(quantityTons),
        priority,
        sourcePlant,
        status: 'APPROVED',
        ts: new Date().toISOString(),
      };
      PENDING_INTERNAL_ORDERS.push(tmp);
      saved = tmp;
    }

    // Build a simple rake plan (wagons, ETA, cost, emissions)
    const originCity = /Bokaro/i.test(sourcePlant) ? 'Bokaro' : (sourcePlant.split(' ')[0] || 'Bokaro');
    const distanceKm = getDistance(originCity, stockyardCity.split(',')[0]);
    const capacityPerWagon = 60;
    const wagonsUsed = Math.ceil(quantityTons / capacityPerWagon);
    const loadedQty = Math.min(quantityTons, wagonsUsed * capacityPerWagon);
    const utilization = loadedQty / (wagonsUsed * capacityPerWagon);
    const locoType = 'diesel';
    const baseSpeedKph = 50; const dwellHours = 3 + (wagonsUsed * 0.15);
    const runHours = distanceKm / baseSpeedKph;
    const transitHours = Number((runHours + dwellHours).toFixed(1));
    const departAt = new Date();
    const eta = new Date(departAt.getTime() + transitHours * 3600 * 1000);
    const cost = {
      transport: Math.round(distanceKm * wagonsUsed * 22),
      energy: Math.round(distanceKm * wagonsUsed * (locoType==='electric'? 8: 14)),
      handling: Math.round(wagonsUsed * 500)
    };
    const totalCost = cost.transport + cost.energy + cost.handling;
    const emissionsTons = Number(calculateEmissions(distanceKm, wagonsUsed * capacityPerWagon, locoType).toFixed(2));
    const plan = {
      origin: originCity,
      destination: stockyardCity,
      distanceKm,
      wagonsUsed,
      capacityPerWagon,
      utilizationPct: Number((utilization*100).toFixed(1)),
      departAt: departAt.toISOString(),
      eta: eta.toISOString(),
      transitHours,
      locoType,
      cost: { ...cost, total: totalCost },
      emissionsTons
    };

    // Create Rake + Wagons in DB if available
    let createdRake = null;
    if (prisma) {
      try {
        const rakeCode = `RK-${Date.now().toString().slice(-6)}`;
        createdRake = await prisma.rake.create({
          data: {
            code: rakeCode,
            status: 'PENDING',
            wagons: {
              create: Array.from({ length: wagonsUsed }).map((_, i) => ({ code: `W${rakeCode}-${(i+1).toString().padStart(3,'0')}`, type: 'general', capT: 60 }))
            }
          },
          include: { wagons: true }
        });
      } catch (e) { console.warn('[manager/orders/issue] Rake create failed:', e?.message || e); }
    }

    // Emit event and return
    try { io.emit('alert', { type: 'manager_order', level: 'info', ts: Date.now(), message: `Order issued: ${product} ${quantityTons}t to ${stockyardCity}`, meta: { order: saved, plan, rake: createdRake } }); } catch {}
    try { io.emit('alert', { type: 'rake_plan', level: 'info', ts: Date.now(), message: `Rake plan ready for ${stockyardCity}`, meta: { order: saved, plan, rake: createdRake } }); } catch {}
    res.json({ ok: true, order: saved, plan, rake: createdRake });
  } catch (e) {
    res.status(500).json({ error: 'issue_failed', detail: e?.message || String(e) });
  }
});

// Yard: list planned rakes created by manager (DB only)
app.get('/yard/planned-rakes', authAny(['yard','manager','admin']), async (req, res) => {
  if (!prisma) return res.json([]);
  try {
    const list = await prisma.rake.findMany({ where: { status: 'PENDING' }, orderBy: { id: 'desc' }, take: 20, include: { wagons: true, yard: true } });
    res.json(list.map(r => ({ code: r.code, wagons: (r.wagons||[]).length, yard: r.yard?.name || null, status: r.status })));
  } catch (e) {
    res.status(500).json({ error: 'failed_list', detail: e?.message || String(e) });
  }
});

// =========================
// Manager Overview (Bokaro Steel Plant)
// =========================
// Returns: current production, raw materials inventory, finished inventory ready for dispatch,
// outgoing rakes, and pending customer orders.
app.get('/plant/manager/overview', auth('manager'), async (req, res) => {
  try {
    const plant = 'Bokaro Steel Plant';
    // Derive some deterministic demo numbers
    const now = new Date();
    const seed = (s) => {
      let h = 0; for (let i=0;i<s.length;i++) h = ((h<<5)-h)+s.charCodeAt(i);
      return Math.abs(h);
    };
    const finishedProducts = ['TMT Bars','Billets','Coils','Hot Rolled','Galvanised Sheet'];
    const rawMaterials = ['Coal','Iron Ore','Limestone'];
    const capacity = (name) => 1000 + (seed(name)%1000); // 1000..1999
    const threshold = (name) => 300 + (seed(name)%200); // 300..499
    const qtyFor = (name) => 200 + (seed(name+now.toDateString())%700); // 200..899

    const production = finishedProducts.map((p, idx) => {
      const rateTph = 40 + (seed(p+':rate') % 50); // 40..89 tph
      const shiftHours = 8;
      const shiftTotalTons = rateTph * shiftHours;
      const todayTons = shiftTotalTons + (seed(p+':today') % 200);
      return { product: p, rateTph, shiftTotalTons, todayTons };
    });

    const rawInv = rawMaterials.map((r) => {
      const cap = capacity('raw:'+r);
      const qty = qtyFor('raw:'+r);
      const thr = threshold('raw:'+r);
      return { name: r, stockTons: qty, capacityTons: cap, thresholdTons: thr, low: qty < thr };
    });

    const finishedInv = finishedProducts.map((p) => {
      const cap = capacity('fp:'+p);
      const qty = qtyFor('fp:'+p);
      const thr = threshold('fp:'+p);
      return { product: p, readyTons: qty, capacityTons: cap, thresholdTons: thr, low: qty < thr };
    });

    // Outgoing rakes (recent DISPATCHED)
    let outgoing = [];
    if (prisma) {
      try {
        const list = await prisma.rake.findMany({
          where: { status: 'DISPATCHED' },
          orderBy: { updatedAt: 'desc' },
          take: 10,
        });
        outgoing = list.map(r => ({ code: r.code, destination: r.destination || '', product: r.product || '', tons: r.tons || null, departedAt: r.updatedAt }));
      } catch (e) { /* fallback below */ }
    }
    if (!outgoing.length) {
      const src = Array.isArray(MOCK_DATA.rakes) ? MOCK_DATA.rakes : [];
      outgoing = src.filter(r => (r.status||'').toLowerCase()==='dispatched').slice(0,10)
        .map(r => ({ code: r.code || r.id || 'RK', destination: r.destination || r.to || 'DGR', product: r.product || 'Mixed', tons: r.tons || r.load || 600, departedAt: r.dispatchedAt || r.updatedAt || new Date().toISOString() }));
    }

    // Pending/approved customer orders
    let pendingOrders = [];
    if (prisma) {
      try {
        const orders = await prisma.order.findMany({
          where: { status: { in: ['PENDING','APPROVED'] } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { customer: { select: { name: true } } }
        });
        pendingOrders = orders.map(o => ({ id: o.orderId, customer: o.customer?.name || '', product: o.cargo, quantityTons: o.quantityTons, destination: o.destination, priority: o.priority || 'MEDIUM', status: o.status }));
      } catch (e) { /* fallback below */ }
    }
    if (!pendingOrders.length) {
      pendingOrders = [
        { id: 'ORD-101', customer: 'ABC Steel', product: 'TMT Bars', quantityTons: 420, destination: 'Durgapur', priority: 'HIGH', status: 'PENDING' },
        { id: 'ORD-102', customer: 'XYZ Infra', product: 'Coils', quantityTons: 280, destination: 'Rourkela', priority: 'MEDIUM', status: 'APPROVED' },
        { id: 'ORD-103', customer: 'Metro JV', product: 'Galvanised Sheet', quantityTons: 300, destination: 'Patna', priority: 'HIGH', status: 'PENDING' },
      ];
    }

    res.json({ plant, production, rawInventory: rawInv, finishedInventory: finishedInv, outgoingRakes: outgoing, pendingOrders });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load manager overview', detail: e?.message || String(e) });
  }
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

// =========================
// Operations Simulator (What-if)
// =========================
// Accepts: { scenarios: [{ id?, origin, destination, product, tonnage, desiredDeparture (ISO), wagons? }], constraints?: { maxRakes?, locoType? } }
// Returns evaluation per scenario with ETA, rake plan, utilization, cost & emissions deltas.
app.post('/simulator/run', auth('manager'), (req, res) => {
  try {
    const { scenarios = [], constraints = {} } = req.body || {};
    if (!Array.isArray(scenarios) || !scenarios.length) return res.status(400).json({ error: 'Provide scenarios[]' });
    const locoType = constraints.locoType === 'electric' ? 'electric' : 'diesel';
    const results = scenarios.map((sc, idx) => {
      const id = sc.id || `SCN-${idx+1}`;
      const distance = getDistance(sc.origin, sc.destination);
      const capacityPerWagon = 60; // assumption
      const requiredWagons = Math.ceil(sc.tonnage / capacityPerWagon);
      const wagonsUsed = sc.wagons && sc.wagons>0 ? Math.min(sc.wagons, requiredWagons) : requiredWagons;
      const loadedQty = Math.min(sc.tonnage, wagonsUsed * capacityPerWagon);
      const utilization = loadedQty / (wagonsUsed * capacityPerWagon);
      const baseSpeedKph = locoType === 'electric' ? 55 : 50;
      const runHours = distance / baseSpeedKph;
      const dwellHours = 3 + (wagonsUsed * 0.15);
      const depart = sc.desiredDeparture ? new Date(sc.desiredDeparture) : new Date();
      const eta = new Date(depart.getTime() + (runHours + dwellHours) * 3600 * 1000);
      const cost = {
        transport: Math.round(distance * wagonsUsed * 22),
        energy: Math.round(distance * wagonsUsed * (locoType==='electric'? 8: 14)),
        handling: Math.round(wagonsUsed * 500)
      };
      const totalCost = cost.transport + cost.energy + cost.handling;
      const emissionsKg = calculateEmissions(distance, wagonsUsed * capacityPerWagon, locoType);
      const altLocoEmissions = calculateEmissions(distance, wagonsUsed * capacityPerWagon, locoType==='electric'? 'diesel':'electric');
      const emissionsDelta = altLocoEmissions - emissionsKg;
      return {
        id,
        input: sc,
        distanceKm: distance,
        wagonsUsed,
        capacityPerWagon,
        loadedQty,
        utilization: Number((utilization*100).toFixed(1)),
        departure: depart.toISOString(),
        eta: eta.toISOString(),
        transitHours: Number((runHours + dwellHours).toFixed(1)),
        locoType,
        cost: { ...cost, total: totalCost },
        emissionsKg: Number(emissionsKg.toFixed(2)),
        emissionsDeltaVsAlternate: Number(emissionsDelta.toFixed(2)),
        notes: utilization < 0.85 ? ['Low utilization — consider consolidating'] : [],
      };
    });
    // simple aggregate
    const aggregate = {
      totalWagons: results.reduce((s,r)=> s + r.wagonsUsed,0),
      avgUtilization: Number((results.reduce((s,r)=> s + r.utilization,0)/results.length).toFixed(1)),
      totalCost: results.reduce((s,r)=> s + r.cost.total,0),
      totalEmissionsKg: Number(results.reduce((s,r)=> s + r.emissionsKg,0).toFixed(2)),
      scenarios: results.length
    };
    res.json({ aggregate, results, generatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: 'Simulation failed', detail: e?.message || String(e) });
  }
});

// Alias routes (defensive so demo never 404s if a proxy strips segments)
app.post('/manager/simulator/run', auth('manager'), (req,res)=> {
  req.url = '/simulator/run';
  app._router.handle(req,res,()=>{});
});
app.get('/simulator/ping', auth('manager'), (_req,res)=> res.json({ ok:true, service:'simulator', ts: Date.now() }));

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

      // Mock Audit & Compliance report entries (10 rows)
      // Each entry captures category, severity, operational context, a key metric and owner/status
      const AUDIT_REPORTS = (() => {
        const now = Date.now();
        const mins = (m) => new Date(now - m * 60 * 1000).toISOString();
        return [
          { id: 'ACR-001', type: 'Safety Incident', severity: 'high', rakeId: 'RK006', route: 'BKSC→DGR', title: 'Near-miss at siding', details: 'Shunter reported brake slip during coupling.', metricName: 'Idle Time Added (min)', metricValue: 18, status: 'Investigating', actor: 'yard@sail.test', ts: mins(35) },
          { id: 'ACR-002', type: 'Emission', severity: 'medium', rakeId: 'RK004', route: 'ROU→BPHB', title: 'Diesel smoke spike', details: 'Opacity exceeded threshold on gradient.', metricName: 'CO₂ (t)', metricValue: 3.4, status: 'Resolved', actor: 'telemetry', ts: mins(90) },
          { id: 'ACR-003', type: 'SLA Breach', severity: 'high', rakeId: 'RK002', route: 'BKSC→ROU', title: 'Late arrival vs SLA', details: 'Blocked section near Asansol.', metricName: 'Delay (min)', metricValue: 62, status: 'Open', actor: 'ops@qsteel.local', ts: mins(150) },
          { id: 'ACR-004', type: 'Compliance Audit', severity: 'low', rakeId: '—', route: 'BKSC Yard', title: 'PPE spot-check', details: '98% PPE compliance in morning shift.', metricName: 'Compliance (%)', metricValue: 98, status: 'Closed', actor: 'audit@qsteel.local', ts: mins(210) },
          { id: 'ACR-005', type: 'Safety Incident', severity: 'critical', rakeId: 'RK007', route: 'BKSC→DGR', title: 'Over-speed alarm', details: 'Speed exceeded 60 km/h in yard limit.', metricName: 'Max Speed (km/h)', metricValue: 64, status: 'Mitigated', actor: 'telemetry', ts: mins(260) },
          { id: 'ACR-006', type: 'Emission', severity: 'low', rakeId: 'RK003', route: 'ROU→BKSC', title: 'Noise threshold crossed', details: 'Short-duration horn dB peak.', metricName: 'Noise (dB)', metricValue: 86, status: 'Closed', actor: 'telemetry', ts: mins(320) },
          { id: 'ACR-007', type: 'SLA Breach', severity: 'medium', rakeId: 'RK001', route: 'BKSC→BPHB', title: 'Dwell over target', details: 'Loading dwell exceeded SOP at BKSC.', metricName: 'Dwell (min)', metricValue: 42, status: 'Open', actor: 'yard@sail.test', ts: mins(380) },
          { id: 'ACR-008', type: 'Compliance Audit', severity: 'medium', rakeId: '—', route: 'DGR Yard', title: 'Waste segregation lapse', details: 'Mixed scrap observed at bay-2.', metricName: 'Findings (#)', metricValue: 3, status: 'Assigned', actor: 'audit@qsteel.local', ts: mins(460) },
          { id: 'ACR-009', type: 'Safety Incident', severity: 'low', rakeId: 'RK005', route: 'DGR→ROU', title: 'Minor slip report', details: 'Worker slipped near wet surface, no injury.', metricName: 'Medical Cases', metricValue: 0, status: 'Closed', actor: 'hse@qsteel.local', ts: mins(510) },
          { id: 'ACR-010', type: 'Emission', severity: 'high', rakeId: 'RK004', route: 'ROU→BPHB', title: 'Fuel leak contained', details: 'Small diesel leak at Jharsuguda siding.', metricName: 'Leak (L)', metricValue: 12, status: 'Resolved', actor: 'yard@sail.test', ts: mins(640) },
        ];
      })();
      
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

// =========================
// CMO APIs (mock)
// =========================
app.get('/api/v1/cmo/summary', auth('cmo'), (req, res) => {
  const yards = ([]).concat(req.query.yard||[]).map(String);
  const today = new Date().toISOString().slice(0,10);
  const rakes = (MOCK_DATA.rakes||[]);
  const filtered = yards.length ? rakes.filter(r => {
    // naive mapping: use destination text match against yard name
    return yards.some(y => (r.destination||'').toLowerCase().includes(String(y).toLowerCase()));
  }) : rakes;
  const backlog = filtered.filter(r=> String(r.status||'').toLowerCase()!=='dispatched').length;
  const util = filtered.length ? filtered.filter(r=> (r.status||'').toLowerCase()==='loading').length/filtered.length : 0.72;
  const kpis = { backlog, stockyardUtil: util, slaRisk: 0.18, ecoScore: 0.66, date: today, yards };
  try { pushEvent({ type: 'cmo_filter', page: '/api/v1/cmo/summary', action: 'filter_yards', user: req.user?.email||'', role: req.user?.role||'cmo', meta: { yards }, ts: Date.now() }); } catch {}
  res.json({ kpis, alerts: MOCK_DATA.alerts?.slice(0,5) || [] });
});

app.get('/api/v1/cmo/allocations', auth('cmo'), (req,res) => {
  const list = Array.from(ALLOCATIONS.values()).sort((a,b)=> b.createdAt - a.createdAt);
  if (prisma) {
    (async()=>{
      try {
        const db = await prisma.allocation.findMany({ orderBy: { createdAt: 'desc' } });
        const map = new Map(list.map(x=> [x.id, x]));
        db.forEach(d => {
          const merged = {
            id: d.id,
            status: d.status,
            payload: d.payload,
            createdBy: d.createdBy,
            createdAt: new Date(d.createdAt).getTime(),
            approvedBy: d.approvedBy,
            approvedAt: d.approvedAt ? new Date(d.approvedAt).getTime() : undefined,
            rejectedBy: d.rejectedBy,
            rejectedAt: d.rejectedAt ? new Date(d.rejectedAt).getTime() : undefined,
            rejectReason: d.rejectReason
          };
          const m = map.get(d.id);
          map.set(d.id, m ? { ...m, ...merged } : merged);
        });
        const mergedList = Array.from(map.values()).sort((a,b)=> b.createdAt - a.createdAt);
        return res.json({ allocations: mergedList });
      } catch {
        return res.json({ allocations: list });
      }
    })();
  } else {
    res.json({ allocations: list });
  }
});

app.post('/api/v1/cmo/allocations/draft', auth('cmo'), (req,res) => {
  const { order_ids = [], stockyard_id = '', notes = '' } = req.body || {};
  const id = 'ALC' + Math.floor(Math.random()*1e6).toString().padStart(6,'0');
  const record = { id, status: 'draft', payload: { order_ids, stockyard_id, notes }, createdBy: req.user?.email, createdAt: Date.now() };
  ALLOCATIONS.set(id, record);
  ALLOC_AUDIT.push({ allocId: id, user: req.user?.email, action: 'create_draft', diff: record.payload, ts: Date.now() });
  if (prisma) {
    (async()=>{
      try { await prisma.allocation.create({ data: { id, status: 'draft', payload: record.payload, createdBy: record.createdBy } }); } catch {}
      try { await prisma.allocationAudit.create({ data: { allocId: id, user: req.user?.email || '', action: 'create_draft', diff: record.payload } }); } catch {}
    })();
  }
  res.json({ ok:true, draft: record });
});

app.post('/api/v1/cmo/allocations/:id/submit', auth('cmo'), (req,res) => {
  const id = req.params.id;
  const r = ALLOCATIONS.get(id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  r.status = 'submitted';
  ALLOC_AUDIT.push({ allocId: id, user: req.user?.email, action: 'submit', diff: {}, ts: Date.now() });
  if (prisma) {
    (async()=>{
      try { await prisma.allocation.update({ where: { id }, data: { status: 'submitted' } }); } catch {}
      try { await prisma.allocationAudit.create({ data: { allocId: id, user: req.user?.email || '', action: 'submit' } }); } catch {}
    })();
  }
  res.json({ ok:true, allocation: r });
});

app.post('/api/v1/cmo/allocations/:id/approve', auth(), (req,res) => {
  // allow cmo or admin to approve
  if (!['cmo','admin'].includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  const r = ALLOCATIONS.get(id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  r.status = 'approved';
  r.approvedBy = req.user?.email; r.approvedAt = Date.now();
  ALLOC_AUDIT.push({ allocId: id, user: req.user?.email, action: 'approve', diff: {}, ts: Date.now() });
  if (prisma) {
    (async()=>{
      try { await prisma.allocation.update({ where: { id }, data: { status: 'approved', approvedBy: r.approvedBy, approvedAt: new Date(r.approvedAt) } }); } catch {}
      try { await prisma.allocationAudit.create({ data: { allocId: id, user: req.user?.email || '', action: 'approve' } }); } catch {}
    })();
  }
  res.json({ ok:true, allocation: r });
});

// Reject endpoint with optional reason
app.post('/api/v1/cmo/allocations/:id/reject', auth(), (req,res) => {
  if (!['cmo','admin'].includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  const r = ALLOCATIONS.get(id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  const reason = String(req.body?.reason || '').slice(0, 500);
  r.status = 'rejected';
  r.rejectedBy = req.user?.email; r.rejectedAt = Date.now(); r.rejectReason = reason;
  ALLOC_AUDIT.push({ allocId: id, user: req.user?.email, action: 'reject', diff: { reason }, ts: Date.now() });
  if (prisma) {
    (async()=>{
      try { await prisma.allocation.update({ where: { id }, data: { status: 'rejected', rejectedBy: r.rejectedBy, rejectedAt: new Date(r.rejectedAt), rejectReason: reason } }); } catch {}
      try { await prisma.allocationAudit.create({ data: { allocId: id, user: req.user?.email || '', action: 'reject', diff: { reason } } }); } catch {}
    })();
  }
  res.json({ ok:true, allocation: r });
});

// Allocation detail with recent audit trail
app.get('/api/v1/cmo/allocations/:id', auth('cmo'), (req,res) => {
  const id = req.params.id;
  const mem = ALLOCATIONS.get(id);
  const send = (alloc) => {
    const audit = ALLOC_AUDIT.filter(a => a.allocId === id).slice(-50).reverse();
    res.json({ allocation: alloc, audit });
  };
  if (prisma) {
    (async()=>{
      try {
        const d = await prisma.allocation.findUnique({ where: { id } });
        if (d) {
          const merged = {
            id: d.id,
            status: d.status,
            payload: d.payload,
            createdBy: d.createdBy,
            createdAt: new Date(d.createdAt).getTime(),
            approvedBy: d.approvedBy,
            approvedAt: d.approvedAt ? new Date(d.approvedAt).getTime() : undefined,
            rejectedBy: d.rejectedBy,
            rejectedAt: d.rejectedAt ? new Date(d.rejectedAt).getTime() : undefined,
            rejectReason: d.rejectReason
          };
          return send(mem ? { ...mem, ...merged } : merged);
        }
      } catch {}
      if (mem) return send(mem);
      return res.status(404).json({ error: 'not_found' });
    })();
  } else {
    if (!mem) return res.status(404).json({ error: 'not_found' });
    send(mem);
  }
});

// Audit with simple filters: from,to,allocId,action,limit
app.get('/api/v1/cmo/audit', auth('cmo'), (req,res) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)).getTime() : null;
    const to = req.query.to ? new Date(String(req.query.to)).getTime() : null;
    const allocId = req.query.allocId ? String(req.query.allocId) : null;
    const action = req.query.action ? String(req.query.action) : null;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
    let items = ALLOC_AUDIT;
    if (allocId) items = items.filter(i => i.allocId === allocId);
    if (action) items = items.filter(i => i.action === action);
    if (from) items = items.filter(i => i.ts >= from);
    if (to) items = items.filter(i => i.ts <= to);
    items = items.slice(-limit).reverse();
    res.json({ audit: items, count: items.length });
  } catch (e) {
    res.status(400).json({ error: 'invalid_filter', detail: e?.message || String(e) });
  }
});

// CSV export for CMO audit
app.get('/api/v1/cmo/audit.csv', auth('cmo'), (req,res) => {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const headers = ['allocId','user','action','ts','reason','diff'];
  const items = ALLOC_AUDIT.slice(-500).reverse();
  const rows = items.map(i => [i.allocId, i.user, i.action, new Date(i.ts).toISOString(), (i.diff?.reason)||'', JSON.stringify(i.diff||{})].map(esc).join(','));
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="cmo-audit.csv"');
  res.send(headers.join(',') + '\n' + rows.join('\n'));
});

// Customer Tracking (mock)
app.get('/api/v1/customer/orders/:orderId/tracking', auth(), (req,res) => {
  // allow role=customer, manager, admin
  if (!['customer','manager','admin'].includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
  const orderId = req.params.orderId;
  const rake = (MOCK_DATA.rakes||[])[Math.floor(Math.random()*(MOCK_DATA.rakes?.length||1))];
  const pos = getLivePositions()[Math.floor(Math.random()*getLivePositions().length)];
  const events = [
    { type: 'CREATED', ts: new Date(Date.now()-6*3600*1000).toISOString(), note: 'Order confirmed' },
    { type: 'LOADING', ts: new Date(Date.now()-4*3600*1000).toISOString(), note: 'Loading at yard' },
    { type: 'DISPATCHED', ts: new Date(Date.now()-2*3600*1000).toISOString(), note: `Rake ${rake?.id} departed` },
  ];
  const eta = new Date(Date.now()+3*3600*1000).toISOString();
  res.json({ orderId, plan_id: 'PLAN-'+orderId, rake_id: rake?.id, last_known_location: { lat: pos.lat, lng: pos.lng, name: pos.currentLocationName }, ETA: eta, events });
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
  // Track global namespace connections
  try {
    WS_STATS.totalConnections += 1;
    WS_STATS.currentConnections += 1;
    WS_STATS.byNamespace['/'] = WS_STATS.byNamespace['/'] || { total: 0, current: 0 };
    WS_STATS.byNamespace['/'].total += 1;
    WS_STATS.byNamespace['/'].current += 1;
    const started = Date.now();
    socket.on('disconnect', () => {
      WS_STATS.currentConnections = Math.max(0, WS_STATS.currentConnections - 1);
      WS_STATS.byNamespace['/'].current = Math.max(0, WS_STATS.byNamespace['/'].current - 1);
      const dur = Date.now() - started;
      WS_STATS.durationsMs.push(dur);
      if (WS_STATS.durationsMs.length > 1000) WS_STATS.durationsMs.shift();
    });
  } catch {}
});

// =========================
// Customer Module (MVP)
// =========================

// In-memory stores (fallback when DB not integrated)
const CUSTOMERS = new Map(); // key: customerId -> profile
const CUSTOMERS_BY_EMAIL = new Map(); // key: email -> profile
const SIGNUP_PENDING = new Map(); // in-memory fallback
async function signupPendingSet(email, data, ttlSec = 15*60) {
  const key = `signup:${normEmailKey(email)}`;
  const payload = JSON.stringify({ data, createdAt: Date.now() });
  if (redis) { try { await redis.set(key, payload, 'EX', ttlSec); return; } catch {}
  }
  SIGNUP_PENDING.set(normEmailKey(email), { data, createdAt: Date.now() });
}
async function signupPendingGet(email) {
  const key = `signup:${normEmailKey(email)}`;
  if (redis) {
    try { const v = await redis.get(key); if (v) return JSON.parse(v); } catch {}
  }
  return SIGNUP_PENDING.get(normEmailKey(email)) || null;
}
async function signupPendingDel(email) {
  const k = normEmailKey(email);
  if (redis) { try { await redis.del(`signup:${k}`); } catch {}
  }
  SIGNUP_PENDING.delete(k);
}
const ORDERS = new Map(); // key: orderId -> order
const ORDERS_BY_CUSTOMER = new Map(); // key: customerId -> orderIds[]
const INVOICES = new Map(); // key: orderId -> { pdfGeneratedAt, amount }

const scryptAsync = promisify(crypto.scrypt);

// Map Zod errors to a field->message object for client-friendly display
function zodFieldErrors(zerr) {
  try {
    const out = {};
    for (const issue of zerr?.errors || zerr?.issues || []) {
      const key = (Array.isArray(issue.path) && issue.path.length ? String(issue.path[0]) : 'form');
      if (!out[key]) out[key] = issue.message || 'Invalid value';
    }
    return out;
  } catch {
    return { form: 'Invalid input' };
  }
}

const CustomerSignupSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  company: z.string().trim().min(2, 'Company must be at least 2 characters'),
  email: z.string().trim().email('Enter a valid email address'),
  phone: z.coerce.string().trim().min(7, 'Phone must be at least 7 digits'),
  gstin: z.union([z.string().trim().min(5, 'GSTIN must be at least 5 characters'), z.literal('')]).optional(),
  password: z.string().min(8, 'Password must be at least 8 characters')
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

// ------------ Prisma helpers (DB <-> API mappings) ------------
function toDbPriority(p) {
  // API uses 'Normal'|'Urgent' while DB uses enum Priority Normal|Urgent
  return p === 'Urgent' ? 'Urgent' : 'Normal';
}
function toApiPriority(p) {
  return p === 'Urgent' ? 'Urgent' : 'Normal';
}
function toDbStatus(apiStatus) {
  const m = {
    'Pending': 'PENDING',
    'Approved': 'APPROVED',
    'Loading': 'LOADING',
    'En Route': 'EN_ROUTE',
    'Delivered': 'DELIVERED',
    'Rejected': 'REJECTED',
  };
  return m[apiStatus] || 'PENDING';
}
function toApiStatus(dbStatus) {
  const m = {
    PENDING: 'Pending',
    APPROVED: 'Approved',
    LOADING: 'Loading',
    EN_ROUTE: 'En Route',
    DELIVERED: 'Delivered',
    REJECTED: 'Rejected',
  };
  return m[dbStatus] || 'Pending';
}
function upsertCustomerInMemory(row) {
  if (!row) return null;
  const profile = {
    customerId: row.customerId,
    name: row.name,
    company: row.company,
    email: row.email,
    phone: row.phone || '',
    gstin: row.gstin || '',
    passwordHash: row.passwordHash,
    addresses: [],
    paymentMethods: [],
    createdAt: (row.createdAt instanceof Date ? row.createdAt.toISOString() : (row.createdAt || new Date().toISOString()))
  };
  CUSTOMERS.set(profile.customerId, profile);
  CUSTOMERS_BY_EMAIL.set(profile.email, profile);
  return profile;
}
function apiOrderFromRow(row) {
  if (!row) return null;
  return {
    orderId: row.orderId,
    customerId: row.customerId,
    cargo: row.cargo,
    quantityTons: row.quantityTons,
    sourcePlant: row.sourcePlant,
    destination: row.destination,
    priority: toApiPriority(row.priority),
    notes: '',
    status: toApiStatus(row.status),
    createdAt: (row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt),
    estimate: row.estimateCost ? { cost: row.estimateCost, eta: row.eta ? new Date(row.eta).toISOString() : undefined } : undefined,
    rakeId: row.rakeId || null,
    history: Array.isArray(row.history) ? row.history : (row.history || []),
  };
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
  if (!parsed.success) {
    return res.status(422).json({ error: 'validation_error', errors: zodFieldErrors(parsed.error) });
  }
  const { name, company, email, phone, gstin, password } = parsed.data;
  if (CUSTOMERS_BY_EMAIL.has(email)) return res.status(409).json({ error: 'Email already registered' });
  const passwordHash = await hashPassword(password);
  await signupPendingSet(email, { name, company, email, phone, gstin, passwordHash });
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
  const schema = z.object({
    email: z.string().trim().email('Enter a valid email address'),
    otp: z.string().regex(/^\d{6}$/, 'OTP must be a 6-digit code')
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(422).json({ error: 'validation_error', errors: zodFieldErrors(parsed.error) });
  const { email, otp } = parsed.data;
  const pending = await signupPendingGet(email);
  if (!pending) {
    if (process.env.OTP_DEBUG === '1') console.warn('[VERIFY-SIGNUP] pending missing for', email);
    return res.status(410).json({ error: 'signup_session_expired', message: 'Your signup session expired. Please sign up again.' });
  }
  const stored = await otpGet(email);
  const devOverride = (process.env.NODE_ENV !== 'production') && (process.env.DISABLE_EMAIL === '1' || process.env.OTP_DEV_LOG === '1');
  if (process.env.OTP_DEBUG === '1') {
    console.log('[VERIFY-SIGNUP]', { email, hasPending: !!pending, hasStored: !!stored, expInMs: stored ? (stored.expMs - Date.now()) : null });
  }
  const valid = (stored && stored.code === otp && Date.now() <= stored.expMs) || (devOverride && otp === '123456');
  if (!valid) return res.status(401).json({ error: 'Invalid OTP, please try again.' });
  if (stored) { try { await otpDel(email); } catch {} }
  await signupPendingDel(email);
  // Create customer record (DB first, fallback to in-memory)
  let customerId = crypto.randomUUID?.() || 'cust-' + Math.random().toString(36).slice(2);
  let profile = null;
  try {
    if (prisma) {
      const created = await prisma.customer.create({
        data: {
          customerId,
          name: pending.data.name,
          company: pending.data.company,
          email: pending.data.email,
          phone: pending.data.phone,
          gstin: pending.data.gstin || null,
          passwordHash: pending.data.passwordHash,
        }
      });
      profile = upsertCustomerInMemory(created);
      customerId = profile.customerId;
    } else {
      profile = { customerId, ...pending.data, addresses: [], paymentMethods: [], createdAt: new Date().toISOString() };
      CUSTOMERS.set(customerId, profile);
      CUSTOMERS_BY_EMAIL.set(profile.email, profile);
    }
  } catch (e) {
    // Unique email already exists or DB failure -> attempt to load existing and fallback to memory
    try {
      if (prisma) {
        const existing = await prisma.customer.findUnique({ where: { email: pending.data.email } });
        if (existing) {
          profile = upsertCustomerInMemory(existing);
          customerId = profile.customerId;
        } else {
          profile = { customerId, ...pending.data, addresses: [], paymentMethods: [], createdAt: new Date().toISOString() };
          CUSTOMERS.set(customerId, profile);
          CUSTOMERS_BY_EMAIL.set(profile.email, profile);
        }
      }
    } catch {}
  }
  // Issue token for convenience
  const token = jwt.sign({ sub: customerId, role: 'customer', email: profile.email }, JWT_SECRET, { expiresIn: '8h' });
  return res.json({ ok: true, customerId, token });
});

// Customer login: password or OTP
app.post('/auth/customer/login', async (req, res) => {
  const schema = z.object({
    email: z.string().trim().email('Enter a valid email address'),
    password: z.string().min(6).optional(),
    otp: z.string().regex(/^\d{6}$/, 'OTP must be a 6-digit code').optional()
  }).refine(d => !!d.password || !!d.otp, { message: 'Provide either password or OTP', path: ['form'] });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(422).json({ error: 'validation_error', errors: zodFieldErrors(parsed.error) });
  const { email, password, otp } = parsed.data;
  let customer = CUSTOMERS_BY_EMAIL.get(email);
  if (!customer && prisma) {
    try {
      const row = await prisma.customer.findUnique({ where: { email } });
      if (row) customer = upsertCustomerInMemory(row);
    } catch {}
  }
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
  const orderBase = {
    orderId,
    customerId: req.user.sub,
    cargo,
    quantityTons,
    sourcePlant,
    destination,
    priority,
    notes: notes || '',
    status: 'Pending',
    createdAt: new Date().toISOString(),
    estimate: est,
    rakeId: null,
    history: [{ ts: Date.now(), status: 'Pending' }]
  };
  let order = orderBase;
  try {
    if (prisma) {
      const row = await prisma.order.create({
        data: {
          orderId,
          customerId: req.user.sub,
          cargo,
          quantityTons,
          sourcePlant,
          destination,
          priority: toDbPriority(priority),
          status: toDbStatus('Pending'),
          estimateCost: est?.cost ?? null,
          eta: est?.eta ? new Date(est.eta) : null,
          rakeId: null,
          history: orderBase.history,
        }
      });
      order = apiOrderFromRow(row) || orderBase;
    }
  } catch (e) { /* keep in-memory fallback */ }
  ORDERS.set(orderId, order);
  const arr = ORDERS_BY_CUSTOMER.get(order.customerId) || []; arr.push(orderId); ORDERS_BY_CUSTOMER.set(order.customerId, arr);
  // Notify managers
  io.emit('notification', { audience: 'manager', type: 'order_created', orderId, customerId: req.user.sub, priority });
  res.json({ ok: true, order });
});

app.get('/customer/orders', auth('customer'), async (req, res) => {
  try {
    if (prisma) {
      const rows = await prisma.order.findMany({ where: { customerId: req.user.sub }, orderBy: { createdAt: 'desc' } });
      for (const r of rows) { const o = apiOrderFromRow(r); if (o) { ORDERS.set(o.orderId, o); const arr = ORDERS_BY_CUSTOMER.get(o.customerId) || []; if (!arr.includes(o.orderId)) { arr.push(o.orderId); ORDERS_BY_CUSTOMER.set(o.customerId, arr); } } }
    }
  } catch {}
  const ids = ORDERS_BY_CUSTOMER.get(req.user.sub) || [];
  res.json({ orders: ids.map(id => ORDERS.get(id)).filter(Boolean) });
});

app.get('/customer/orders/:id', auth('customer'), async (req, res) => {
  const o = ORDERS.get(req.params.id);
  if (!o || o.customerId !== req.user.sub) return res.status(404).json({ error: 'Order not found' });
  res.json({ order: o });
});

// Project sites listing (role: manager/admin/cmo/customer minimal). For demo, return all projects.
app.get('/customer/projects', auth(), (req, res) => {
  try {
    // Optional filters: cmo, city, product
    const cmo = req.query.cmo ? String(req.query.cmo).toLowerCase() : '';
    const city = req.query.city ? String(req.query.city).toLowerCase() : '';
    const product = req.query.product ? String(req.query.product).toLowerCase() : '';
    let list = CUSTOMER_PROJECTS.slice();
    if (cmo) list = list.filter(p => (p.nearestCMO||'').toLowerCase().includes(cmo));
    if (city) list = list.filter(p => (p.city||'').toLowerCase().includes(city));
    if (product) list = list.filter(p => (p.products||[]).some(x => String(x).toLowerCase().includes(product)));
    res.json({ projects: list });
  } catch (e) {
    res.status(500).json({ error: 'failed_to_list_projects', detail: e?.message || String(e) });
  }
});

// SAIL Network points (static). Icons determined by "type" on the client.
app.get('/network/sail', auth(), (req, res) => {
  try {
    const type = req.query.type ? String(req.query.type).toLowerCase() : '';
    let items = (typeof SAIL_NETWORK !== 'undefined' ? SAIL_NETWORK : []);
    if (type) items = items.filter(p => String(p.type||'').toLowerCase() === type);
    res.json({ points: items });
  } catch (e) {
    res.status(500).json({ error: 'failed_to_list_network', detail: e?.message || String(e) });
  }
});

// Major projects list (for CMO/Manager/Yard/Admin)
app.get('/projects/major', auth(), (req, res) => {
  try {
    res.json({ projects: MAJOR_PROJECTS });
  } catch (e) {
    res.status(500).json({ error: 'failed_to_list_major_projects' });
  }
});

// AI/ML planner: uses recent stats (mock) and explains cost reasons
app.post('/ai/plan', auth('cmo'), (req, res) => {
  const schema = z.object({
    product: z.string(), quantity: z.number().positive(), destination: z.string(), priority: z.enum(['Normal','Urgent']).default('Normal'),
    multiCity: z.boolean().optional()
  });
  const parsed = schema.safeParse(req.body||{});
  if(!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
  const { product, quantity, destination, priority, multiCity } = parsed.data;
  const base = estimateOrder({ cargo: product, qtyTons: quantity, sourcePlant: 'BKSC', destination, priority });
  const demandFactor = 1 + (product.toLowerCase().includes('tmt') ? 0.08 : 0.04);
  const tax = Math.round(base.cost * 0.18);
  const fuel = Math.round(base.distanceKm * 0.9);
  const delayRisk = Math.round(base.cost * 0.03);
  const total = Math.round(base.cost * demandFactor + tax + fuel + delayRisk);
  const reasons = [
    { label: 'Demand surge', impact: Math.round(base.cost * (demandFactor-1)) },
    { label: 'GST/Taxes', impact: tax },
    { label: 'Fuel & freight', impact: fuel },
    { label: 'Delay risk hedge', impact: delayRisk },
  ];
  const route = multiCity ? ['BKSC → DGR','DGR → ROU','ROU → '+ (destination.split(',')[0]||destination)] : ['BKSC → ' + (destination.split(',')[0]||destination)];
  res.json({
    suggestion: { route, eta: base.eta, ecoHint: base.ecoHint },
    cost: { base: base.cost, total, reasons },
    footprint: { distanceKm: base.distanceKm, carbonTons: base.carbonTons },
  });
});

// Register a new customer (ID/Password) by CMO
app.post('/cmo/customer/register', auth('cmo'), (req, res) => {
  const schema = z.object({ company: z.string(), email: z.string().email(), password: z.string().min(6) });
  const parsed = schema.safeParse(req.body||{});
  if(!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
  const { company, email, password } = parsed.data;
  if (CUSTOMERS_BY_EMAIL.get(email)) return res.status(409).json({ error: 'email_exists' });
  const id = crypto.randomUUID?.() || 'cust-' + Math.random().toString(36).slice(2);
  // persist in in-memory stores with hash so that /auth/customer/login works
  (async()=>{
    const passwordHash = await hashPassword(password);
    const profile = { customerId: id, name: company, company, email, phone: '', gstin: '', passwordHash, addresses: [], paymentMethods: [], createdAt: new Date().toISOString() };
    CUSTOMERS.set(id, profile);
    CUSTOMERS_BY_EMAIL.set(email, profile);
  })().then(()=>{
    res.json({ ok: true, id, email });
  }).catch(e=> res.status(500).json({ error: 'failed_to_register', detail: e?.message || String(e) }));
});

// Export plan as PDF (stub contents)
app.post('/cmo/plan/export.pdf', auth('cmo'), (req, res) => {
  const schema = z.object({ plan: z.any() });
  const parsed = schema.safeParse(req.body||{});
  if(!parsed.success) return res.status(400).json({ error: 'invalid' });
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="plan.pdf"');
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);
  doc.fontSize(16).text('AI/ML Order Plan');
  doc.moveDown(); doc.fontSize(10).text(JSON.stringify(parsed.data.plan,null,2));
  doc.end();
});

// CSV export for plan
app.post('/cmo/plan/export.csv', auth('cmo'), (req, res) => {
  const schema = z.object({ plan: z.any() });
  const parsed = schema.safeParse(req.body||{});
  if(!parsed.success) return res.status(400).json({ error: 'invalid' });
  const plan = parsed.data.plan || {};
  const lines = ['key,value'];
  Object.entries(plan).forEach(([k,v])=>{
    if (Array.isArray(v)) {
      lines.push(`${k},"${v.join(' | ')}"`);
    } else if (v && typeof v === 'object') {
      lines.push(`${k},"${JSON.stringify(v)}"`);
    } else {
      lines.push(`${k},${v}`);
    }
  });
  const csv = lines.join('\n');
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="plan.csv"');
  res.send(csv);
});

// CMO order intake: create customer if new, generate credentials, create order and attach AI plan
app.post('/cmo/order/new', auth('cmo'), async (req, res) => {
  const schema = z.object({
    company: z.string(),
    email: z.string().email().optional(),
    product: z.string(),
    quantity: z.number().positive(),
    destination: z.string(),
    priority: z.enum(['Normal','Urgent']).default('Normal')
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
  const { company, email, product, quantity, destination, priority } = parsed.data;

  // ensure customer exists
  let customerProfile = email ? CUSTOMERS_BY_EMAIL.get(email) : null;
  let generated = null;
  if (!customerProfile) {
    const password = Math.random().toString(36).slice(2, 10);
    const customerId = crypto.randomUUID?.() || 'cust-' + Math.random().toString(36).slice(2);
    const passwordHash = await hashPassword(password);
    const normalizedEmail = email || `${company.toLowerCase().replace(/\s+/g,'')}@example.com`;
    try {
      if (prisma) {
        const created = await prisma.customer.create({ data: { customerId, name: company, company, email: normalizedEmail, phone: '', gstin: null, passwordHash } });
        customerProfile = upsertCustomerInMemory(created);
      } else {
        customerProfile = { customerId, name: company, company, email: normalizedEmail, phone: '', gstin: '', passwordHash, addresses: [], paymentMethods: [], createdAt: new Date().toISOString() };
        CUSTOMERS.set(customerId, customerProfile);
        CUSTOMERS_BY_EMAIL.set(customerProfile.email, customerProfile);
      }
    } catch (e) {
      // If email exists already, load it
      try {
        if (prisma) {
          const existing = await prisma.customer.findUnique({ where: { email: normalizedEmail } });
          if (existing) customerProfile = upsertCustomerInMemory(existing);
        }
      } catch {}
    }
    generated = { customerId, email: customerProfile.email, password };
  }

  // Create order for this customer
  const orderId = crypto.randomUUID?.() || 'ord-' + Math.random().toString(36).slice(2);
  const sourcePlant = 'BKSC';
  const est = estimateOrder({ cargo: product, qtyTons: quantity, sourcePlant, destination, priority });
  let order = { orderId, customerId: customerProfile.customerId, cargo: product, quantityTons: quantity, sourcePlant, destination, priority, notes: '', status: 'Pending', createdAt: new Date().toISOString(), estimate: est, rakeId: null, history: [{ ts: Date.now(), status: 'Pending' }] };
  try {
    if (prisma) {
      const row = await prisma.order.create({
        data: {
          orderId,
          customerId: customerProfile.customerId,
          cargo: product,
          quantityTons: quantity,
          sourcePlant,
          destination,
          priority: toDbPriority(priority),
          status: toDbStatus('Pending'),
          estimateCost: est?.cost ?? null,
          eta: est?.eta ? new Date(est.eta) : null,
          rakeId: null,
          history: order.history,
        }
      });
      order = apiOrderFromRow(row) || order;
    }
  } catch (e) { /* fallback keeps in-memory */ }
  ORDERS.set(orderId, order);
  const arr = ORDERS_BY_CUSTOMER.get(order.customerId) || []; arr.push(orderId); ORDERS_BY_CUSTOMER.set(order.customerId, arr);

  // attach AI plan with 14-day stats mock
  const stats14d = Array.from({ length: 14 }).map((_,i)=> ({ day: i+1, routesAvailable: Math.floor(10+Math.random()*5), weatherIndex: Number((0.7+Math.random()*0.3).toFixed(2)), delays: Math.floor(Math.random()*4) }));
  const demandFactor = 1 + (product.toLowerCase().includes('tmt') ? 0.08 : 0.04);
  const tax = Math.round(est.cost * 0.18);
  const fuel = Math.round(est.distanceKm * 0.9);
  const delayRisk = Math.round(est.cost * 0.03);
  const total = Math.round(est.cost * demandFactor + tax + fuel + delayRisk);
  const plan = {
    suggestion: { route: ['BKSC → ' + (destination.split(',')[0]||destination)], eta: est.eta, ecoHint: est.ecoHint },
    cost: { base: est.cost, total, reasons: [
      { label: 'Demand surge', impact: Math.round(est.cost*(demandFactor-1)) },
      { label: 'GST/Taxes', impact: tax },
      { label: 'Fuel & freight', impact: fuel },
      { label: 'Delay risk hedge', impact: delayRisk }
    ] },
    footprint: { distanceKm: est.distanceKm, carbonTons: est.carbonTons },
    stats14d
  };

  try { pushEvent({ type: 'cmo_order_created', page: '/cmo/order/new', action: 'create', role: 'cmo', user: req.user?.email||'', meta: { orderId, company }, ts: Date.now() }); } catch {}
  io.emit('notification', { audience: 'manager', type: 'order_created', orderId, company, priority });
  res.json({ ok: true, order, plan, credentials: generated || undefined });
});

// CMO orders history
app.get('/cmo/orders', auth('cmo'), (req, res) => {
  const orders = Array.from(ORDERS.values()).sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ orders });
});

// CMO orders CSV
app.get('/cmo/orders.csv', auth('cmo'), (req, res) => {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  };
  const header = 'orderId,company,email,cargo,quantityTons,sourcePlant,destination,priority,status,createdAt';
  const rows = Array.from(ORDERS.values()).map(o => {
    const c = CUSTOMERS.get(o.customerId);
    return [o.orderId, c?.company||c?.name||'', c?.email||'', o.cargo, o.quantityTons, o.sourcePlant, o.destination, o.priority, o.status, o.createdAt].map(esc).join(',');
  });
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="cmo-orders.csv"');
  res.send([header, ...rows].join('\n'));
});

// Crew: start trip simulation for a rake (4 min, update every 5s)
app.post('/crew/trip/start', authAny(['yard','crew']), (req, res) => {
  const schema = z.object({ rakeId: z.string(), path: z.array(z.object({ name: z.string(), lat: z.number(), lng: z.number() })).min(2) });
  const parsed = schema.safeParse(req.body||{});
  if(!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
  const { rakeId, path } = parsed.data;
  let i = 0; const totalTicks = Math.min(48, Math.ceil((4*60)/5));
  const pos = MOCK_DATA.positions.find(p => p.id === rakeId) || { id: rakeId, speed: 40, temp: 30, stops: path };
  if (!MOCK_DATA.positions.find(p => p.id === rakeId)) MOCK_DATA.positions.push(pos);
  const timer = setInterval(() => {
    const idx = Math.min(path.length-1, Math.floor((i/(totalTicks-1)) * (path.length-1)));
    const s = path[idx]; pos.lat = s.lat; pos.lng = s.lng; pos.currentLocationName = s.name; io.emit('positions', MOCK_DATA.positions);
    i++; if (i>= totalTicks) { clearInterval(timer); io.emit('notification', { audience: 'all', type: 'rake_arrived', rakeId }); }
  }, 5000);
  // First update after ~2s to satisfy demo requirement
  setTimeout(() => { try { io.emit('positions', MOCK_DATA.positions); } catch {} }, 2000);
  res.json({ ok: true, rakeId, ticks: totalTicks });
});

// Crew: predefined delay/stop reasons
const CREW_REASONS = ['Signal', 'Technical', 'Weather', 'Congestion', 'Operational'];
app.get('/crew/reasons', authAny(['crew','yard','manager','cmo']), (_req, res) => res.json({ reasons: CREW_REASONS }));

// Crew: report stop/delay
app.post('/crew/trip/delay', authAny(['crew','yard']), (req, res) => {
  const schema = z.object({ rakeId: z.string(), reason: z.string() });
  const parsed = schema.safeParse(req.body||{});
  if (!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
  const { rakeId, reason } = parsed.data;
  const pos = MOCK_DATA.positions.find(p => p.id === rakeId);
  if (pos) { pos.status = 'Halted'; pos.speed = 0; }
  const evt = { type: 'crew_delay', page: '/crew', action: 'delay', role: req.user?.role||'crew', user: req.user?.email||'', meta: { rakeId, reason }, ts: Date.now() };
  try { pushEvent(evt); } catch {}
  io.emit('notification', { audience: 'all', type: 'rake_delay', rakeId, reason });
  res.json({ ok: true });
});

app.post('/crew/trip/stop', authAny(['crew','yard']), (req, res) => {
  const schema = z.object({ rakeId: z.string(), reason: z.string() });
  const parsed = schema.safeParse(req.body||{});
  if (!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
  const { rakeId, reason } = parsed.data;
  const pos = MOCK_DATA.positions.find(p => p.id === rakeId);
  if (pos) { pos.status = 'Stopped'; pos.speed = 0; }
  try { pushEvent({ type: 'crew_stop', page: '/crew', action: 'stop', role: req.user?.role||'crew', user: req.user?.email||'', meta: { rakeId, reason }, ts: Date.now() }); } catch {}
  io.emit('notification', { audience: 'all', type: 'rake_stopped', rakeId, reason });
  res.json({ ok: true });
});

// Crew fatigue mock
app.get('/crew/fatigue', authAny(['manager','cmo','yard','crew']), (_req, res) => {
  const crews = Array.from({ length: 6 }).map((_,i)=> ({ id: 'CRW'+(i+1), hoursLastWeek: 40 + Math.floor(Math.random()*12), dutyTodayHrs: Math.floor(Math.random()*10), fatigueScore: Number((0.4 + Math.random()*0.5).toFixed(2)) }));
  res.json({ crews, generatedAt: new Date().toISOString() });
});

// Manager: inventory check for shortages and raw material trigger suggestion
app.get('/manager/inventory/check', auth('manager'), (req, res) => {
  const result = (MOCK_DATA.stockDemand||[]).map(r => ({ yard: r.yard, grade: r.grade, stock: r.stock, demand: r.demand, shortage: Math.max(0, r.demand - r.stock) }));
  const severe = result.filter(x => x.shortage > 100);
  const suggestion = severe.length >= 5 ? 'Trigger raw material request from CMO' : 'Monitor';
  res.json({ items: result, severe: severe.length, suggestion });
});

// Manager: simple merge suggestions for orders on same route/destination
app.get('/manager/orders/suggestions', auth('manager'), (req, res) => {
  const pending = Array.from(ORDERS.values()).filter(o => ['Pending','Approved'].includes(o.status));
  const groups = pending.reduce((m,o)=>{ const key = `${o.sourcePlant}|${(o.destination||'').split(',')[0]}`; (m[key]=m[key]||[]).push(o); return m; }, {});
  const suggestions = Object.entries(groups).filter(([_,arr])=> arr.length>=2).map(([key,arr])=>{
    const [src,dst] = key.split('|');
    const totalQty = arr.reduce((s,o)=> s + (o.quantityTons||0),0);
    return { route: `${src}→${dst}`, orders: arr.map(x=>x.orderId), totalQty, action: 'Consider coupling/merge' };
  });
  res.json({ suggestions });
});

// Manager: perform merge/couple on suggested orders (demo: assign a common rake/group)
app.post('/manager/orders/merge', auth('manager'), (req, res) => {
  const schema = z.object({ orderIds: z.array(z.string()).min(2) });
  const parsed = schema.safeParse(req.body||{});
  if(!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
  const { orderIds } = parsed.data;
  const groupId = 'MRG-' + (crypto.randomUUID?.().slice(0,8) || Math.random().toString(36).slice(2,10));
  const rakeId = 'RK' + Math.floor(1000 + Math.random()*9000);
  const updated = [];
  for (const id of orderIds) {
    const o = ORDERS.get(id); if (!o) continue;
    o.groupId = groupId; o.status = o.status === 'Pending' ? 'Approved' : o.status; o.rakeId = o.rakeId || rakeId; o.history = (o.history||[]).concat([{ ts: Date.now(), status: 'Coupled' }]);
    ORDERS.set(id, o); updated.push(o);
  }
  try { pushEvent({ type: 'orders_merge', page: '/orders/status', action: 'merge', role: 'manager', user: req.user?.email||'', meta: { groupId, rakeId, count: updated.length }, ts: Date.now() }); } catch {}
  io.emit('notification', { audience: 'all', type: 'orders_merged', message: `Coupled ${updated.length} orders into ${rakeId}`, groupId, rakeId });
  res.json({ ok: true, groupId, rakeId, orders: updated });
});

function haversineKm(a, b) {
  const R = 6371; // km
  const toRad = (x)=> x * Math.PI / 180;
  const dLat = toRad((b.lat||0) - (a.lat||0));
  const dLon = toRad((b.lng||0) - (a.lng||0));
  const lat1 = toRad(a.lat||0); const lat2 = toRad(b.lat||0);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Compare alternative routes: compute distance, ETA and CO2 using simple coefficients
app.post('/ai/alt/compare', authAny(['manager','cmo','yard','admin']), (req, res) => {
  const schema = z.object({
    plant: z.string(), cmo: z.string(), cargo: z.string().default('steel'), tonnage: z.number().default(3000),
    routes: z.array(z.object({ id: z.string(), waypoints: z.array(z.object({ name: z.string().optional(), lat: z.number(), lng: z.number() })).min(2) })).min(1)
  });
  const parsed = schema.safeParse(req.body||{});
  if (!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
  const { plant, cmo, cargo, tonnage, routes } = parsed.data;
  const baseEfPerKmPerTon = 0.000025; // tCO2 per km per ton (demo)
  const avgSpeed = 50; // km/h
  const dwellPerStopH = 0.15; // 9 minutes per stop
  const perKmCost = 1.2; // currency/km/ton (demo)
  const out = routes.map(r => {
    let dist = 0; for (let i=1;i<r.waypoints.length;i++) dist += haversineKm(r.waypoints[i-1], r.waypoints[i]);
    const stops = Math.max(0, r.waypoints.length - 2);
    const hours = dist / avgSpeed + (stops * dwellPerStopH);
    const co2 = dist * tonnage * baseEfPerKmPerTon;
    const cost = dist * tonnage * perKmCost;
    return { id: r.id, distanceKm: Math.round(dist), etaHours: Number(hours.toFixed(1)), co2Tons: Number(co2.toFixed(2)), cost: Math.round(cost) };
  });
  const bestCost = out.reduce((a,b)=> a.cost <= b.cost ? a : b, out[0]);
  const bestEta = out.reduce((a,b)=> a.etaHours <= b.etaHours ? a : b, out[0]);
  const bestCo2 = out.reduce((a,b)=> a.co2Tons <= b.co2Tons ? a : b, out[0]);
  try { pushEvent({ type: 'compare_routes', page: '/map', action: 'compare', role: req.user?.role||'guest', user: req.user?.email||'', meta: { plant, cmo, cargo, tonnage, routes: out }, ts: Date.now() }); } catch {}
  res.json({ routes: out, bestBy: { cost: bestCost.id, eta: bestEta.id, co2: bestCo2.id } });
});

// -------------------------------------------------
// Canonical Planner Commit Endpoint (+ Map overlay)
// -------------------------------------------------
// Persists a chosen route against one or more orders, assigns rake/group when missing,
// appends order history, emits notifications, and returns a confirmation payload.
const PLAN_COMMITS = new Map(); // commitId -> record
const MAP_OVERLAY_TOKENS = new Map(); // token -> { waypoints, createdAt, ttlSec, payload }

app.post('/planner/plan/commit', authAny(['manager','cmo','admin']), (req, res) => {
  const schema = z.object({
    plant: z.string(),
    cmo: z.string(),
    alternative: z.object({ id: z.string(), name: z.string().optional() }).optional(),
    waypoints: z.array(z.object({ name: z.string().optional(), lat: z.number(), lng: z.number() })).min(2).optional(),
    metrics: z.object({ distanceKm: z.number().optional(), etaHours: z.number().optional(), co2Tons: z.number().optional(), cost: z.number().optional() }).optional(),
    orderIds: z.array(z.string()).optional(),
    notes: z.string().optional()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'invalid', issues: parsed.error.issues });
  const { plant, cmo, alternative, waypoints = [], metrics = {}, orderIds = [], notes = '' } = parsed.data;
  const committedAt = Date.now();
  const commitId = 'CMT-' + (crypto.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10));
  const groupId = 'GRP-' + (crypto.randomUUID?.().slice(0, 6) || Math.random().toString(36).slice(2, 8));
  const rakeId = 'RK' + Math.floor(1000 + Math.random() * 9000);

  // Overlay token for Map page to retrieve coordinates directly if desired
  const ttlSec = 10 * 60;
  const overlayToken = 'ovr-' + (crypto.randomUUID?.().slice(0, 10) || Math.random().toString(36).slice(2, 12));
  MAP_OVERLAY_TOKENS.set(overlayToken, { waypoints, createdAt: committedAt, ttlSec, payload: { plant, cmo, alternative, metrics } });

  // Persist lightweight commit record (in-memory; DB optional future)
  const record = { commitId, plant, cmo, alternative: alternative || null, waypoints, metrics, groupId, rakeId, orderIds, notes, committedAt, committedBy: req.user?.email || '' };
  PLAN_COMMITS.set(commitId, record);

  // If orders provided, annotate them with committed route info
  const updated = [];
  if (Array.isArray(orderIds) && orderIds.length) {
    for (const id of orderIds) {
      const o = ORDERS.get(id);
      if (!o) continue;
      // Attach committed route metadata
      o.committedRoute = {
        id: alternative?.id || 'alt-custom',
        name: alternative?.name || '',
        plant,
        cmo,
        waypoints,
        metrics,
        committedAt,
        committedBy: req.user?.email || '',
        overlayToken,
        overlayExpiresAt: committedAt + ttlSec * 1000
      };
      // Assign group/rake if not already set
      o.groupId = o.groupId || groupId;
      o.rakeId = o.rakeId || rakeId;
      // History entry
      o.history = (o.history || []).concat([{ ts: committedAt, status: 'Committed Route', note: alternative?.id || 'route' }]);
      ORDERS.set(id, o);
      updated.push({ orderId: o.orderId, rakeId: o.rakeId, groupId: o.groupId });
    }
    try { io.emit('notification', { audience: 'all', type: 'route_committed', message: `Committed route ${alternative?.id || ''} for ${updated.length} order(s)`, groupId, rakeId, orders: updated }); } catch {}
  }

  try { pushEvent({ type: 'plan_commit', page: '/planner', action: 'commit', role: req.user?.role || 'guest', user: req.user?.email || '', meta: { commitId, plant, cmo, alt: alternative?.id, orders: updated.length }, ts: committedAt }); } catch {}

  res.json({ ok: true, commitId, plant, cmo, committedRouteId: alternative?.id || null, groupId, rakeId, overlayToken, orders: updated });
});

// Short-lived overlay retrieval for Map page (token expires ~10 min)
app.get('/planner/plan/overlay/:token', auth(), (req, res) => {
  const token = String(req.params.token || '');
  const rec = MAP_OVERLAY_TOKENS.get(token);
  if (!rec) return res.status(404).json({ error: 'not_found' });
  const ageSec = Math.floor((Date.now() - rec.createdAt) / 1000);
  if (ageSec > (rec.ttlSec || 600)) {
    MAP_OVERLAY_TOKENS.delete(token);
    return res.status(410).json({ error: 'expired' });
  }
  res.json({ waypoints: rec.waypoints, meta: rec.payload, createdAt: rec.createdAt, ttlSec: rec.ttlSec });
});

// Role-prefixed aliases that forward to canonical commit
['manager','cmo','admin'].forEach(prefix => {
  app.post(`/${prefix}/plan/commit`, auth(prefix === 'admin' ? 'admin' : undefined), (req, res) => {
    req.url = '/planner/plan/commit';
    app._router.handle(req, res, () => {});
  });
});

// Append more major projects (from provided mock sheet) near their nearest CMO city coords
try {
  if (Array.isArray(MAJOR_PROJECTS)) {
    MAJOR_PROJECTS.push(
      { id: 'MP-JK-01', name: 'Kishtwar Pakal Dul Power Project, J&K', products: ['Structural Steel','TMT Bars'], sources: ['BSP','DSP','ISP'], route: 'BSP/DSP/ISP → Delhi → J&K', nearestCMO: 'Delhi', city: 'Delhi', lat: 28.6139, lng: 77.2090, contact: { name: 'Proj Office', email: 'pkgdul@infra.test' }, kpis: { quantityTons: 12000, eta: 'Q4 FY25', co2: '—' } },
      { id: 'MP-DEL-03', name: 'Delhi Katra Expressway (Packages)', products: ['Plates','TMT Bars'], sources: ['BSP','BSL','DSP','ISP','RSP'], route: 'Multi-plant → Delhi', nearestCMO: 'Delhi', city: 'Delhi', lat: 28.6139, lng: 77.2090 },
      { id: 'MP-UK-01', name: 'Vishnugad Pipalkoti Hydro Electric Project', products: ['Structural Steel','TMT Bars'], sources: ['BSP','DSP','ISP'], route: 'Multi-plant → Delhi → Uttarakhand', nearestCMO: 'Delhi', city: 'Delhi', lat: 28.6139, lng: 77.2090, contact: { email: 'vishnugad@hydro.test' }, kpis: { quantityTons: 8000, eta: 'Q3 FY25', co2: '—' } },
      { id: 'MP-HP-02', name: 'Shongtong Karchham Hydro Electric Project', products: ['Structural Steel','Plates'], sources: ['BSP','BSL','DSP','ISP','RSP'], route: 'Multi-plant → Delhi → HP', nearestCMO: 'Delhi', city: 'Delhi', lat: 28.6139, lng: 77.2090 },
      { id: 'MP-UK-02', name: 'Rishikesh-KarnPrayag Rail Link Project', products: ['Rails','Structural Steel'], sources: ['BSP','DSP','ISP'], route: 'Multi-plant → Delhi → Uttarakhand', nearestCMO: 'Delhi', city: 'Delhi', lat: 28.6139, lng: 77.2090 },
      { id: 'MP-UP-02', name: 'Kanpur Irrigation Project', products: ['Plates','Structural Steel'], sources: ['BSP','BSL','DSP','ISP','RSP'], route: 'Multi-plant → Lucknow', nearestCMO: 'Lucknow', city: 'Lucknow', lat: 26.8467, lng: 80.9462 },
      { id: 'MP-AS-02', name: 'Dhubri Bridge, Assam–Meghalaya', products: ['Plates','Structural Steel'], sources: ['BSP','BSL','DSP','ISP','RSP'], route: 'Multi-plant → Kolkata → NJP → Guwahati', nearestCMO: 'Guwahati', city: 'Guwahati', lat: 26.1445, lng: 91.7362, contact: { phone: '+91-99999-12345' }, kpis: { quantityTons: 5000, eta: 'FY26', co2: '—' } },
      { id: 'MP-WB-02', name: 'NTPC Rammam Hydroelectric Project, Darjeeling', products: ['Structural Steel','Plates'], sources: ['BSP','BSL','DSP','ISP','RSP'], route: 'Multi-plant → Howrah → Darjeeling', nearestCMO: 'Kolkata', city: 'Kolkata', lat: 22.5726, lng: 88.3639 },
      { id: 'MP-OD-02', name: 'Lower Suktel Dam, Bolangir, Odisha', products: ['TMT Bars','Structural Steel'], sources: ['BSP','DSP','ISP'], route: 'Multi-plant → Bhubaneswar', nearestCMO: 'Bhubaneswar', city: 'Bhubaneswar', lat: 20.2961, lng: 85.8245 },
      { id: 'MP-TS-02', name: 'Sita Rama Lift Irrigation Project, Telangana', products: ['Plates','Structural Steel'], sources: ['BSP','BSL','DSP','ISP','RSP'], route: 'Multi-plant → Vijayawada → Secunderabad', nearestCMO: 'Hyderabad', city: 'Hyderabad', lat: 17.3850, lng: 78.4867, contact: { name: 'Irrigation PMU' }, kpis: { quantityTons: 7000, eta: 'Q1 FY26', co2: '—' } },
      { id: 'MP-TS-03', name: 'Google Campus, Hyderabad', products: ['Structural Steel'], sources: ['BSP','DSP','ISP'], route: 'DSP/ISP → Vijayawada → Hyderabad', nearestCMO: 'Hyderabad', city: 'Hyderabad', lat: 17.3850, lng: 78.4867 },
      { id: 'MP-TN-02', name: 'Eversendai Constructions, DLF Taramani', products: ['Structural Steel'], sources: ['BSP','DSP','ISP'], route: 'DSP/ISP → Vijayawada → Chennai', nearestCMO: 'Chennai', city: 'Chennai', lat: 13.0827, lng: 80.2707 },
      { id: 'MP-TN-03', name: 'B&B Builders – ACS Lalithambigai College', products: ['Structural Steel'], sources: ['BSP','DSP','ISP'], route: 'DSP/ISP → Vijayawada → Chennai', nearestCMO: 'Chennai', city: 'Chennai', lat: 13.0827, lng: 80.2707 },
      { id: 'MP-KL-02', name: 'M/s KSEB (SHP) Hydro Projects, Kerala', products: ['Plates','Structural Steel'], sources: ['BSP','BSL','DSP','ISP','RSP'], route: 'Multi-plant → Kochi', nearestCMO: 'Cochin', city: 'Kochi', lat: 9.9312, lng: 76.2673 },
      { id: 'MP-KL-03', name: 'Kitex Textile Park, Kerala', products: ['Structural Steel'], sources: ['BSP','DSP','ISP'], route: 'ISP → Chennai → Kochi', nearestCMO: 'Cochin', city: 'Kochi', lat: 9.9312, lng: 76.2673 },
      { id: 'MP-MH-02', name: 'Mumbai Ahmedabad High Speed Rail', products: ['Rails','Structural Steel'], sources: ['BSP','DSP','ISP'], route: 'Various → Ahmedabad → Mumbai', nearestCMO: 'Mumbai', city: 'Mumbai', lat: 19.0760, lng: 72.8777 },
      { id: 'MP-MH-03', name: 'Colaba Seepz Metro Line, Mumbai', products: ['Rails','Structural Steel'], sources: ['BSP','DSP','ISP'], route: 'Various → Mumbai', nearestCMO: 'Mumbai', city: 'Mumbai', lat: 19.0760, lng: 72.8777 },
      { id: 'MP-GJ-02', name: 'AMNS Hazira Expansion 9–15 MTPA, Gujarat', products: ['Plates','Structural Steel'], sources: ['BSP','BSL','DSP','ISP','RSP'], route: 'Various → Ahmedabad/Hazira', nearestCMO: 'Ahmedabad', city: 'Ahmedabad', lat: 23.0225, lng: 72.5714, contact: { email: 'hazira@amns.test' }, kpis: { quantityTons: 15000, eta: 'FY27', co2: '—' } },
    );
  }
} catch {}

// Unified order status list for CMO/Admin/Manager
// Returns all orders across customers with current status and basic fields
app.get('/orders/status', auth(), (req, res) => {
  const role = req.user?.role;
  if (!['manager','admin','cmo'].includes(role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    // Hydrate from DB if available
    (async ()=>{
      try {
        if (prisma) {
          const rows = await prisma.order.findMany();
          for (const r of rows) { const o = apiOrderFromRow(r); if (o) { ORDERS.set(o.orderId, o); const arr = ORDERS_BY_CUSTOMER.get(o.customerId) || []; if (!arr.includes(o.orderId)) { arr.push(o.orderId); ORDERS_BY_CUSTOMER.set(o.customerId, arr); } } }
        }
      } catch {}
    })();
    const all = Array.from(ORDERS.values());
    // Optional filters: status, sourcePlant, destination
    const status = req.query.status ? String(req.query.status).toLowerCase() : '';
    const src = req.query.sourcePlant ? String(req.query.sourcePlant).toUpperCase() : '';
    const dest = req.query.destination ? String(req.query.destination).toLowerCase() : '';
    let list = all;
    if (status) list = list.filter(o => String(o.status||'').toLowerCase() === status);
    if (src) list = list.filter(o => String(o.sourcePlant||'').toUpperCase() === src);
    if (dest) list = list.filter(o => String(o.destination||'').toLowerCase().includes(dest));
    // project association heuristic: match destination city to a project city
    const byCity = CUSTOMER_PROJECTS.reduce((m,p)=>{ m[p.city.toLowerCase()] = p; return m; }, {});
    const items = list.map(o => ({
      id: o.orderId, status: o.status, cargo: o.cargo, quantityTons: o.quantityTons,
      sourcePlant: o.sourcePlant, destination: o.destination, priority: o.priority,
      rakeId: o.rakeId || null,
      committedRoute: o.committedRoute ? {
        id: o.committedRoute.id || null,
        name: o.committedRoute.name || null,
        plant: o.committedRoute.plant,
        cmo: o.committedRoute.cmo,
        metrics: o.committedRoute.metrics || null,
        committedAt: o.committedRoute.committedAt || null,
        overlayToken: o.committedRoute.overlayToken || null,
        overlayExpiresAt: o.committedRoute.overlayExpiresAt || null
      } : null,
      project: byCity[(o.destination||'').split(',')[0]?.toLowerCase?.() || ''] || null,
      createdAt: o.createdAt,
    }));
    res.json({ orders: items, total: items.length });
  } catch (e) {
    res.status(500).json({ error: 'failed_to_list_orders', detail: e?.message || String(e) });
  }
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
  try { if (prisma) await prisma.order.update({ where: { orderId: o.orderId }, data: { status: toDbStatus(o.status), history: o.history } }); } catch {}
  io.emit('notification', { audience: 'customer', email: CUSTOMERS.get(o.customerId)?.email, type: 'order_approved', orderId: o.orderId });
  // Assign rake and schedule departure sequence: Loading -> En Route
  const rakeId = `RK${String(Math.floor(Math.random()*9000)+1000)}`;
  o.rakeId = rakeId;
  try { if (prisma) await prisma.order.update({ where: { orderId: o.orderId }, data: { rakeId } }); } catch {}
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
  try { if (prisma) await prisma.order.update({ where: { orderId: o.orderId }, data: { status: toDbStatus(o.status), history: o.history } }); } catch {}
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
  try { if (prisma) await prisma.order.update({ where: { orderId: o.orderId }, data: { status: toDbStatus(o.status), history: o.history } }); } catch {}
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

// Mock Audit ticker: mutate audit dataset periodically to simulate live updates
setInterval(() => {
  try {
    if (!Array.isArray(AUDIT_REPORTS)) return;
    const rand = Math.random();
    const nowIso = new Date().toISOString();
    const pick = (arr) => arr[Math.floor(Math.random()*arr.length)];
    const rakes = (MOCK_DATA.rakes || []).map(r => r.id);

    // 35%: add a fresh emission datapoint (CO₂)
    if (rand < 0.35) {
      const n = {
        id: `ACR-${String(100 + Math.floor(Math.random()*900)).padStart(3,'0')}`,
        type: 'Emission', severity: pick(['low','medium','high']),
        rakeId: pick(rakes) || 'RK004', route: pick(['BKSC→DGR','ROU→BPHB','BKSC→ROU']),
        title: 'CO₂ reading update', details: 'Telemetry carbon snapshot recorded.',
        metricName: 'CO₂ (t)', metricValue: Number((Math.random()*5 + 0.5).toFixed(2)),
        status: 'Closed', actor: 'telemetry', ts: nowIso
      };
      AUDIT_REPORTS.push(n);
    // 25%: toggle an SLA breach status or create one
    } else if (rand < 0.60) {
      const breaches = AUDIT_REPORTS.filter(x => x.type === 'SLA Breach');
      if (breaches.length && Math.random() < 0.6) {
        const b = pick(breaches);
        b.status = pick(['Open','Resolved','Closed']);
        b.ts = nowIso;
      } else {
        AUDIT_REPORTS.push({
          id: `ACR-${String(100 + Math.floor(Math.random()*900)).padStart(3,'0')}`,
          type: 'SLA Breach', severity: pick(['medium','high']),
          rakeId: pick(rakes) || 'RK002', route: pick(['BKSC→ROU','BKSC→DGR']),
          title: 'Delay vs SLA window', details: 'Section congestion led to missed window.',
          metricName: 'Delay (min)', metricValue: Math.floor(20 + Math.random()*90),
          status: pick(['Open','Resolved']), actor: 'ops@qsteel.local', ts: nowIso
        });
      }
    // 20%: add or update a safety near-miss (low/medium)
    } else if (rand < 0.80) {
      const n = {
        id: `ACR-${String(100 + Math.floor(Math.random()*900)).padStart(3,'0')}`,
        type: 'Safety Incident', severity: pick(['low','medium']),
        rakeId: pick(rakes) || 'RK007', route: pick(['BKSC→DGR','DGR Yard']),
        title: 'Near-miss reported', details: 'Worker reported unsafe proximity during shunting.',
        metricName: 'Medical Cases', metricValue: 0,
        status: pick(['Open','Closed','Investigating','Mitigated']), actor: pick(['hse@qsteel.local','yard@sail.test']), ts: nowIso
      };
      AUDIT_REPORTS.push(n);
    // 20%: close out old items randomly
    } else {
      const openIdx = AUDIT_REPORTS.findIndex(x => /open|investigating|assigned/i.test(x.status));
      if (openIdx >= 0) {
        AUDIT_REPORTS[openIdx].status = pick(['Closed','Resolved','Mitigated']);
        AUDIT_REPORTS[openIdx].ts = nowIso;
      }
    }

    // Keep list bounded (latest 40)
    if (AUDIT_REPORTS.length > 40) {
      AUDIT_REPORTS.splice(0, AUDIT_REPORTS.length - 40);
    }
  } catch {}
}, 5000);

// Audit & Compliance Reports
app.get('/reports/audit', auth('admin'), (req, res) => {
  res.json({ items: AUDIT_REPORTS, count: AUDIT_REPORTS.length, generatedAt: new Date().toISOString() });
});

app.get('/reports/audit.csv', auth('admin'), (req, res) => {
  const headers = ['ID','Type','Severity','Rake/Asset','Route/Location','Title','Details','Metric','Value','Status','Actor','Timestamp'];
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = AUDIT_REPORTS.map(r => [
    r.id, r.type, r.severity, r.rakeId, r.route, r.title, r.details, r.metricName, r.metricValue, r.status, r.actor, r.ts
  ].map(esc).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-compliance.csv"');
  res.send(headers.join(',') + '\n' + rows.join('\n'));
});

app.get('/reports/audit.pdf', auth('admin'), (req, res) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-compliance.pdf"');
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);

  // Header
  doc.fontSize(18).text('Audit & Compliance Report', { align: 'left' });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor('#666').text(`Generated: ${new Date().toLocaleString()}`);
  doc.moveDown(0.6).fillColor('#000');

  // Summary pills
  const counts = AUDIT_REPORTS.reduce((acc, r) => { acc[r.severity] = (acc[r.severity]||0)+1; return acc; }, {});
  const total = AUDIT_REPORTS.length;
  const y0 = doc.y; const pill = (x, title, value) => {
    doc.rect(x, y0, 160, 48).stroke('#e5e7eb');
    doc.fontSize(9).fillColor('#6b7280').text(title, x + 8, y0 + 8);
    doc.fontSize(14).fillColor('#111827').text(String(value), x + 8, y0 + 24);
  };
  pill(40, 'Total Findings', total);
  pill(210, 'High/Critical', (counts['high']||0) + (counts['critical']||0));
  pill(380, 'Open Items', AUDIT_REPORTS.filter(r=>/open|investigating|assigned/i.test(r.status)).length);
  doc.moveDown(4);

  // Table
  const cols = [
    { key: 'id', label: 'ID', w: 60 },
    { key: 'type', label: 'Type', w: 90 },
    { key: 'severity', label: 'Sev', w: 45 },
    { key: 'rakeId', label: 'Rake', w: 55 },
    { key: 'route', label: 'Route/Location', w: 100 },
    { key: 'title', label: 'Title', w: 120 },
    { key: 'metric', label: 'Metric', w: 75 },
    { key: 'value', label: 'Value', w: 45 },
    { key: 'status', label: 'Status', w: 70 },
  ];

  let x = 40; let y = doc.y + 10;
  doc.fontSize(10).fillColor('#374151');
  cols.forEach(c => { doc.text(c.label, x, y, { width: c.w }); x += c.w; });
  y += 16; x = 40; doc.moveTo(40, y).lineTo(555, y).stroke('#e5e7eb'); y += 6;

  doc.fontSize(9).fillColor('#111827');
  AUDIT_REPORTS.forEach(r => {
    if (y > 770) { doc.addPage(); y = 40; x = 40; }
    const cells = [
      r.id,
      r.type,
      r.severity,
      r.rakeId,
      r.route,
      r.title,
      r.metricName,
      r.metricValue,
      r.status,
    ];
    cells.forEach((val, i) => { const c = cols[i]; doc.text(String(val), x, y, { width: c.w }); x += c.w; });
    x = 40; y += 16; doc.moveTo(40, y).lineTo(555, y).stroke('#f3f4f6'); y += 2;
  });

  doc.end();
});

// -----------------------------
// Analytics & Events (MVP)
// -----------------------------
function pushEvent(evt) {
  EVENTS.push(evt);
  if (EVENTS.length > MAX_EVENTS) EVENTS.shift();
  if (prisma) {
    (async()=>{
      try { await prisma.event.create({ data: { ts: new Date(evt.ts), user: evt.user||'', role: evt.role||'guest', type: evt.type||'', page: evt.page||'', action: evt.action||'', meta: evt.meta||{} } }); } catch {}
    })();
  }
}

// Best-effort JWT parse for optional auth on /events
function tryParseAuth(req) {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
    if (!token) return null;
    return jwt.verify(token, JWT_SECRET);
  } catch { return null; }
}

// Ingest events (page_view, action_click, export, ws_activity)
app.post('/events', (req, res) => {
  try {
    const schema = z.object({
      type: z.string(),
      page: z.string().optional(),
      action: z.string().optional(),
      meta: z.any().optional(),
      ts: z.number().optional(),
    });
    const parsed = schema.safeParse(req.body||{});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
    const user = tryParseAuth(req);
    const evt = { ...parsed.data, ts: parsed.data.ts || Date.now(), user: user?.email || '', role: user?.role || 'guest', ip: req.ip };
    pushEvent(evt);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'failed_to_record', detail: e?.message || String(e) });
  }
});

// Admin usage snapshot: route counters, roles, WS stats, recent events
app.get('/admin/analytics/usage', auth('admin'), (req, res) => {
  try {
    const range = String(req.query.range||'24h');
    const now = Date.now();
    const since = range==='7d' ? now - 7*24*3600*1000 : range==='30d' ? now - 30*24*3600*1000 : now - 24*3600*1000;
    const routes = Array.from(ROUTE_STATS.entries()).map(([path, v]) => ({
      path,
      count: v.count,
      avgMs: v.count ? Math.round(v.totalTimeMs / v.count) : 0,
      byRole: Array.from(v.byRole.entries()).map(([role, c]) => ({ role, count: c }))
    })).sort((a,b)=> b.count - a.count).slice(0, 200);
    const roleAgg = {};
    routes.forEach(r => r.byRole.forEach(({role, count}) => { roleAgg[role] = (roleAgg[role]||0) + count; }));
    const recent = EVENTS.filter(e => e.ts >= since);
    const eventCounts = recent.reduce((acc,e)=>{ acc[e.type] = (acc[e.type]||0)+1; return acc; },{});
    const ws = {
      totalConnections: WS_STATS.totalConnections,
      currentConnections: WS_STATS.currentConnections,
      byNamespace: WS_STATS.byNamespace,
      avgSessionSec: WS_STATS.durationsMs.length ? Math.round(WS_STATS.durationsMs.reduce((a,b)=>a+b,0)/WS_STATS.durationsMs.length/1000) : 0
    };
    res.json({ routes, roles: roleAgg, events: { window: range, counts: eventCounts, recent: recent.slice(-100).reverse() }, ws });
  } catch (e) {
    res.status(500).json({ error: 'failed_to_aggregate', detail: e?.message || String(e) });
  }
});

// Admin CSV export of recent events
app.get('/admin/analytics/events.csv', auth('admin'), (req, res) => {
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit || 1000)));
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  };
  const items = EVENTS.slice(-limit).reverse();
  const headers = ['ts','user','role','type','page','action','meta'];
  const rows = items.map(e => [new Date(e.ts).toISOString(), e.user, e.role, e.type, e.page||'', e.action||'', JSON.stringify(e.meta||{})].map(esc).join(','));
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="events.csv"');
  res.send(headers.join(',') + '\n' + rows.join('\n'));
});

// Admin CSV export for ETA recalcs with filtering
// Query params: user?=email, from?=ISO, to?=ISO, limit?=N
app.get('/admin/analytics/eta-recalcs.csv', auth('admin'), (req, res) => {
  const qUser = (req.query.user ? String(req.query.user) : '').toLowerCase();
  const fromTs = req.query.from ? Date.parse(String(req.query.from)) : NaN;
  const toTs = req.query.to ? Date.parse(String(req.query.to)) : NaN;
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit || 1000)));
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  };
  let items = EVENTS.filter(e => e.type === 'customer_eta_recalc');
  if (!Number.isNaN(fromTs)) items = items.filter(e => e.ts >= fromTs);
  if (!Number.isNaN(toTs)) items = items.filter(e => e.ts <= toTs);
  if (qUser) items = items.filter(e => (e.user||'').toLowerCase().includes(qUser));
  items = items.slice(-limit).reverse();
  const headers = ['ts','user','role','page','speedKph','dwellHours','source','currentLocation','destination'];
  const rows = items.map(e => [
    new Date(e.ts).toISOString(), e.user||'', e.role||'', e.page||'',
    e.meta?.speedKph ?? '', e.meta?.dwellHours ?? '', e.meta?.source ?? '', e.meta?.currentLocation ?? '', e.meta?.destination ?? ''
  ].map(esc).join(','));
  res.setHeader('Content-Type','text/csv');
  res.setHeader('Content-Disposition','attachment; filename="eta-recalcs.csv"');
  res.send(headers.join(',') + '\n' + rows.join('\n'));
});

// API Endpoints for Advanced Optimizer
app.post('/optimizer/rake-formation', auth(), async (req, res) => {
  try {
    // Align validation schema with actual mock order structure. Allow legacy field names.
    const orderSchema = z.object({
      id: z.string(),
      product: z.string(),
      qty: z.number().positive(),
      // Current data uses 'destination'. Accept legacy 'to'.
      destination: z.string().optional(),
      to: z.string().optional(),
      // Optional priority / dueDate / penalty fields present in mock data
      priority: z.string().optional(),
      dueDate: z.string().optional(),
      penalty: z.number().optional(),
      // Legacy request style: from / slaDays (convert if present)
      from: z.string().optional(),
      slaDays: z.number().int().positive().optional()
    }).passthrough();

    const bodySchema = z.object({
      orders: z.array(orderSchema).default(OPTIMIZER_DATA.orders),
      weights: z.object({ cost: z.number().optional(), sla: z.number().optional(), utilization: z.number().optional(), emissions: z.number().optional() }).default({}),
      constraints: z.record(z.any()).default({})
    });

    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
    }

    const { orders, weights = {} } = parsed.data;

    // Normalize orders so optimizer always receives the expected shape
    const normalizedOrders = (orders || []).map(o => {
      const destination = o.destination || o.to || 'Unknown';
      // Derive dueDate from slaDays if provided and dueDate missing
      let dueDate = o.dueDate;
      if (!dueDate && o.slaDays) {
        dueDate = new Date(Date.now() + o.slaDays * 24 * 60 * 60 * 1000).toISOString();
      }
      if (!dueDate) {
        // Fallback: spread deliveries over next 48h
        dueDate = new Date(Date.now() + Math.floor(Math.random() * 48) * 60 * 60 * 1000).toISOString();
      }
      return {
        id: o.id,
        product: o.product,
        qty: o.qty,
        destination,
        priority: o.priority || 'Medium',
        dueDate,
        penalty: typeof o.penalty === 'number' ? o.penalty : 1500
      };
    });

    const optimizationWeights = {
      cost: (typeof weights.cost === 'number' ? weights.cost : 0.3) || 0.3,
      sla: (typeof weights.sla === 'number' ? weights.sla : 0.4) || 0.4,
      utilization: (typeof weights.utilization === 'number' ? weights.utilization : 0.2) || 0.2,
      emissions: (typeof weights.emissions === 'number' ? weights.emissions : 0.1) || 0.1
    };

    const result = optimizeRakeFormation(normalizedOrders.length ? normalizedOrders : OPTIMIZER_DATA.orders, optimizationWeights);

    res.json({
      success: true,
      optimization: result,
      weights: optimizationWeights,
      orderCount: normalizedOrders.length || OPTIMIZER_DATA.orders.length,
      timestamp: new Date().toISOString(),
      processingTimeMs: Math.floor(Math.random() * 500 + 200) // Simulated latency for realism
    });
  } catch (error) {
    console.error('Optimizer error (rake-formation):', error);
    res.status(500).json({ error: error.message });
  }
});

// Optimizer alias endpoints (defensive for demos / alternate routing under manager/admin prefixes)
['manager','admin'].forEach(prefix => {
  app.post(`/${prefix}/optimizer/rake-formation`, auth(prefix === 'admin' ? 'admin' : undefined), (req,res)=> {
    req.url = '/optimizer/rake-formation';
    app._router.handle(req,res,()=>{});
  });
  app.post(`/${prefix}/optimizer/scenario-analysis`, auth(prefix === 'admin' ? 'admin' : undefined), (req,res)=> {
    req.url = '/optimizer/scenario-analysis';
    app._router.handle(req,res,()=>{});
  });
  app.get(`/${prefix}/optimizer/constraints`, auth(prefix === 'admin' ? 'admin' : undefined), (req,res)=> {
    req.url = '/optimizer/constraints';
    app._router.handle(req,res,()=>{});
  });
  app.get(`/${prefix}/optimizer/production-alignment`, auth(prefix === 'admin' ? 'admin' : undefined), (req,res)=> {
    req.url = '/optimizer/production-alignment';
    app._router.handle(req,res,()=>{});
  });
  app.get(`/${prefix}/optimizer/daily-plan`, auth(prefix === 'admin' ? 'admin' : undefined), (req,res)=> {
    req.url = '/optimizer/daily-plan';
    app._router.handle(req,res,()=>{});
  });
});

// Lightweight mock data endpoint (for offline demo / health check)
app.get('/optimizer/mock', auth(), (req,res) => {
  const result = optimizeRakeFormation(OPTIMIZER_DATA.orders.slice(0,5));
  res.json({
    success:true,
    optimization: result,
    mock:true,
    hint: 'This is a lightweight mock dataset for demo fallback.'
  });
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

// -------------------------------------------------------------
// Advanced Hybrid Optimizer (Mock MILP + Heuristic + Pareto)
// -------------------------------------------------------------
// This endpoint simulates a multi-stage pipeline:
// 1. Clustering (orders grouped by destination)
// 2. Heuristic seeding (greedy packing by priority + earliest due date)
// 3. Local swap search (pseudo MILP refinement)
// 4. Pareto sampling (cost vs emissions vs SLA risk trade-offs)
// Returns rich explainability metadata for UI transparency.
app.post('/optimizer/rake-formation/advanced', auth(), async (req, res) => {
  try {
    const { orders = OPTIMIZER_DATA.orders, wagons = [], weights = {} } = req.body || {};
    if (!Array.isArray(orders)) return res.status(400).json({ error: 'orders must be array' });

    const W = {
      cost: typeof weights.cost === 'number' ? weights.cost : 0.25,
      sla: typeof weights.sla === 'number' ? weights.sla : 0.25,
      utilization: typeof weights.utilization === 'number' ? weights.utilization : 0.25,
      emissions: typeof weights.emissions === 'number' ? weights.emissions : 0.25,
    };

    // 1. Clustering by destination
    const clusters = {};
    orders.forEach(o => {
      const key = (o.destination || o.to || 'UNKNOWN').toUpperCase();
      if (!clusters[key]) clusters[key] = { destination: key, orders: [], totalQty: 0, earliestDue: null };
      clusters[key].orders.push(o);
      clusters[key].totalQty += o.qty || o.quantity || o.quantityTons || 0;
      const due = new Date(o.dueDate || Date.now() + 24*3600*1000);
      if (!clusters[key].earliestDue || due < clusters[key].earliestDue) clusters[key].earliestDue = due;
    });

    // 2. Heuristic seeding: sort orders by priority (mapped) then due date
    const priMap = { high:3, medium:2, low:1 };
    const sorted = [...orders].sort((a,b) => (
      (priMap[String(b.priority||'medium').toLowerCase()]||2) - (priMap[String(a.priority||'medium').toLowerCase()]||2)
    ) || (new Date(a.dueDate||0).getTime() - new Date(b.dueDate||0).getTime()));
    const seedWagons = (wagons && wagons.length ? wagons : Array.from({ length: 10 }).map((_,i) => ({ id: 'WG'+(i+1), capacity: 60, used: 0, orders: [] })));
    sorted.forEach(o => {
      const qty = o.qty || o.quantity || o.quantityTons || 0;
      let remaining = qty;
      // first-fit into existing wagons
      for (const w of seedWagons) {
        if (remaining <= 0) break;
        const space = w.capacity - w.used;
        if (space <= 0) continue;
        const alloc = Math.min(space, remaining);
        if (alloc > 0) {
          w.orders.push({ id: o.id, alloc });
          w.used += alloc;
          remaining -= alloc;
        }
      }
      // if leftover create virtual wagons
      while (remaining > 0) {
        const alloc = Math.min(60, remaining);
        seedWagons.push({ id: 'VIRT-'+seedWagons.length, capacity: 60, used: alloc, orders: [{ id: o.id, alloc }], virtual: true });
        remaining -= alloc;
      }
    });

    // 3. Local swap refinement to balance utilization
    const swaps = [];
    function wagonLoadVariance() {
      const loads = seedWagons.map(w=> w.used / w.capacity);
      const mu = loads.reduce((a,b)=>a+b,0)/loads.length;
      return loads.reduce((s,l)=> s + (l-mu)**2,0)/loads.length;
    }
    let bestVar = wagonLoadVariance();
    for (let iter=0; iter<40; iter++) {
      const a = seedWagons[Math.floor(Math.random()*seedWagons.length)];
      const b = seedWagons[Math.floor(Math.random()*seedWagons.length)];
      if (!a||!b||a===b||!a.orders.length||!b.orders.length) continue;
      const ao = a.orders[Math.floor(Math.random()*a.orders.length)];
      const bo = b.orders[Math.floor(Math.random()*b.orders.length)];
      if (!ao || !bo) continue;
      // swap amounts (simple) if within capacity limits
      const newAUsed = a.used - ao.alloc + bo.alloc;
      const newBUsed = b.used - bo.alloc + ao.alloc;
      if (newAUsed <= a.capacity && newBUsed <= b.capacity) {
        const prevVar = bestVar;
        // execute swap
        a.used = newAUsed; b.used = newBUsed;
        const tmpAlloc = ao.alloc; ao.alloc = bo.alloc; bo.alloc = tmpAlloc;
        const v = wagonLoadVariance();
        if (v < bestVar) { bestVar = v; swaps.push({ iter, a: a.id, b: b.id, variance: Number(v.toFixed(4)) }); }
        else {
          // revert if not improved (hill climbing)
          a.used = a.used - bo.alloc + ao.alloc;
          b.used = b.used - ao.alloc + bo.alloc;
          const tmp = ao.alloc; ao.alloc = bo.alloc; bo.alloc = tmp;
        }
      }
      if (swaps.length >= 12) break;
    }

    // 4. Pareto sampling - synthesize alternative solutions with trade-offs
    const utilization = seedWagons.reduce((s,w)=> s + (w.used/w.capacity),0)/seedWagons.length;
    const baseCost = 1000 + seedWagons.length * 250 + (1-utilization)*800;
    const baseEmissions = 500 + seedWagons.length * 15 - utilization*120;
    const baseSlaRisk = (1-utilization) * 0.15 + (Object.keys(clusters).length * 0.01);
    const alternatives = Array.from({ length: 4 }).map((_,i)=> {
      const f = 0.9 + i*0.04; // shift trade-off surface
      return {
        id: 'ALT-'+(i+1),
        cost: Number((baseCost * f).toFixed(2)),
        emissions: Number((baseEmissions * (2 - f)).toFixed(2)),
        slaRisk: Number((baseSlaRisk * (1 + (0.2 - i*0.03))).toFixed(3)),
        utilization: Number((utilization * (0.95 + i*0.02)).toFixed(3)),
        note: 'Synthetic Pareto sample'
      };
    });

    // Score & pick optimal using weights (lower cost/emissions/risk better, higher utilization better)
    function score(a) {
      return (
        -W.cost * a.cost +
        -W.emissions * a.emissions +
        -W.sla * a.slaRisk * 1000 +
        W.utilization * a.utilization * 1000
      );
    }
    const optimal = alternatives.reduce((best,a)=> score(a) > score(best) ? a : best, alternatives[0]);

    const explanation = {
      method: 'hybrid-milp-heuristic',
      objectiveWeights: W,
      stages: [
        { stage: 'clustering', clusters: Object.keys(clusters).length, details: Object.values(clusters).map(c => ({ destination: c.destination, orders: c.orders.length, totalQty: c.totalQty })) },
        { stage: 'heuristic_seeding', wagonsSeeded: seedWagons.length, avgFill: Number((utilization*100).toFixed(1)) },
        { stage: 'local_refinement', swapsTried: swaps.length, bestVariance: bestVar },
        { stage: 'pareto_sampling', samples: alternatives.length }
      ],
      decisionLog: [
        'Grouped orders to reduce fragmentation and improve fill ratio',
        'Allocated high-priority & earliest-due orders first for SLA protection',
        'Performed hill-climb swaps to balance wagon loads (lower variance)',
        'Generated Pareto variants to surface trade-offs for planner review'
      ],
      rationale: 'Heuristic seeding + local refinement approximates MILP solutions while remaining fast for interactive planning.'
    };

    res.json({
      success: true,
      optimization: { optimal, alternatives, explanation, method: 'hybrid-milp-heuristic' },
      wagons: seedWagons.map(w => ({ id: w.id, used: w.used, capacity: w.capacity, fill: Number((w.used / w.capacity * 100).toFixed(1)), orders: w.orders })),
      meta: { clusters: Object.keys(clusters).length, utilization: Number((utilization*100).toFixed(1)) }
    });
  } catch (e) {
    console.error('advanced optimizer error:', e);
    res.status(500).json({ error: 'Advanced optimizer failed', detail: e?.message || String(e) });
  }
});

// Role-prefixed aliases for advanced hybrid endpoint
['manager','admin'].forEach(prefix => {
  app.post(`/${prefix}/optimizer/rake-formation/advanced`, auth(prefix === 'admin' ? 'admin' : undefined), (req,res)=> {
    req.url = '/optimizer/rake-formation/advanced';
    app._router.handle(req,res,()=>{});
  });
});

app.get('/optimizer/production-alignment', auth(), async (req, res) => {
  try {
    const alignment = analyzeProductionAlignment();
    res.json(alignment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Role-prefixed aliases for production alignment (manager/admin)
['manager','admin'].forEach(prefix => {
  app.get(`/${prefix}/optimizer/production-alignment`, auth(prefix === 'admin' ? 'admin' : undefined), (req,res)=> {
    req.url = '/optimizer/production-alignment';
    app._router.handle(req,res,()=>{});
  });
});

app.get('/optimizer/constraints', auth(), async (req, res) => {
  res.json({
    constraints: OPTIMIZER_CONFIG.constraints,
    wagonCompatibility: OPTIMIZER_CONFIG.constraints.wagonTypes,
    loadingPoints: OPTIMIZER_CONFIG.constraints.loadingPoints,
    costs: OPTIMIZER_CONFIG.costs
  });
});

// Role-prefixed aliases for constraints (manager/admin)
['manager','admin'].forEach(prefix => {
  app.get(`/${prefix}/optimizer/constraints`, auth(prefix === 'admin' ? 'admin' : undefined), (req,res)=> {
    req.url = '/optimizer/constraints';
    app._router.handle(req,res,()=>{});
  });
});

// Update optimizer constraints (admin only, dev-friendly). Accepts partial updates.
app.post('/optimizer/constraints', auth('admin'), async (req, res) => {
  try {
    const num = (v) => (typeof v === 'number' && !Number.isNaN(v)) ? v : undefined;
    const arr = (v) => Array.isArray(v) ? v : undefined;
    const obj = (v) => (v && typeof v === 'object') ? v : undefined;
    const body = req.body || {};

    if (obj(body.minRakeSize)) {
      OPTIMIZER_CONFIG.constraints.minRakeSize.tons = num(body.minRakeSize.tons) ?? OPTIMIZER_CONFIG.constraints.minRakeSize.tons;
      OPTIMIZER_CONFIG.constraints.minRakeSize.wagons = num(body.minRakeSize.wagons) ?? OPTIMIZER_CONFIG.constraints.minRakeSize.wagons;
    }
    if (obj(body.maxRakeSize)) {
      OPTIMIZER_CONFIG.constraints.maxRakeSize.tons = num(body.maxRakeSize.tons) ?? OPTIMIZER_CONFIG.constraints.maxRakeSize.tons;
      OPTIMIZER_CONFIG.constraints.maxRakeSize.wagons = num(body.maxRakeSize.wagons) ?? OPTIMIZER_CONFIG.constraints.maxRakeSize.wagons;
    }
    if (obj(body.loadingPoints)) {
      for (const [plant, cfg] of Object.entries(body.loadingPoints)) {
        OPTIMIZER_CONFIG.constraints.loadingPoints[plant] = OPTIMIZER_CONFIG.constraints.loadingPoints[plant] || { capacity: 0, sidings: 0, hourly: 0 };
        OPTIMIZER_CONFIG.constraints.loadingPoints[plant].capacity = num(cfg.capacity) ?? OPTIMIZER_CONFIG.constraints.loadingPoints[plant].capacity;
        OPTIMIZER_CONFIG.constraints.loadingPoints[plant].sidings = num(cfg.sidings) ?? OPTIMIZER_CONFIG.constraints.loadingPoints[plant].sidings;
        OPTIMIZER_CONFIG.constraints.loadingPoints[plant].hourly = num(cfg.hourly) ?? OPTIMIZER_CONFIG.constraints.loadingPoints[plant].hourly;
      }
    }
    if (obj(body.wagonTypes)) {
      for (const [type, wc] of Object.entries(body.wagonTypes)) {
        OPTIMIZER_CONFIG.constraints.wagonTypes[type] = OPTIMIZER_CONFIG.constraints.wagonTypes[type] || { capacity: 60, compatible: [] };
        if (num(wc.capacity) !== undefined) OPTIMIZER_CONFIG.constraints.wagonTypes[type].capacity = num(wc.capacity);
        if (arr(wc.compatible)) OPTIMIZER_CONFIG.constraints.wagonTypes[type].compatible = wc.compatible;
      }
    }

    res.json({ ok: true, constraints: OPTIMIZER_CONFIG.constraints });
  } catch (e) {
    res.status(400).json({ error: 'Invalid payload', detail: e?.message || String(e) });
  }
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

// Role-prefixed aliases for daily plan (manager/admin)
['manager','admin'].forEach(prefix => {
  app.get(`/${prefix}/optimizer/daily-plan`, auth(prefix === 'admin' ? 'admin' : undefined), (req,res)=> {
    req.url = '/optimizer/daily-plan';
    app._router.handle(req,res,()=>{});
  });
});

// ---------------------------------------------------------------------------
// Enhanced Manager Alignment Dashboard Endpoint (Mock Intelligence Layer)
// ---------------------------------------------------------------------------
// Provides 360° view: plant->yard->customer flows, strategic priority match,
// cost & sustainability alignment, timeline SLA, AI suggestions, policy checks,
// goals vs targets, team responsibility matrix, decision impact preview, alerts.
app.get('/optimizer/alignment/manager-dashboard', auth(), async (req, res) => {
  try {
    // Re-run (lightweight) optimizer to fabricate current rakes snapshot
    const result = optimizeRakeFormation(OPTIMIZER_DATA.orders);
    const rakes = result.optimal.rakes.slice(0, 10); // limit for dashboard
    const now = Date.now();
    const plants = [...new Set(rakes.map(r=> r.loadingPoint))];
    const destinations = [...new Set(rakes.map(r=> r.destination))];

    // 360° Flow Map (simplified)
    const flows = rakes.map(r => ({
      from: r.loadingPoint,
      to: r.destination,
      tons: r.loadedQty || r.totalTons || (r.wagons * 60 * r.utilization/100),
      sla: r.slaFlag,
      cost: r.cost,
      emissions: r.emissions
    }));

    // Strategic priority (mock high-value contracts = destinations with 'BHILAI' or large tonnage)
    const prioritizedOrders = flows
      .filter(f => f.tons > 1800 || /BHILAI/i.test(f.to))
      .map(f => ({ route: `${f.from}→${f.to}`, tons: Math.round(f.tons), reason: f.tons > 1800 ? 'High Volume' : 'Key Account' }));
    const strategicAlignmentScore = prioritizedOrders.length ? Math.min(1, prioritizedOrders.length / (rakes.length || 1)) : 0.4;

    // Cost alignment (freight vs demurrage/penalty risk estimation)
    const totalFreight = rakes.reduce((s,r)=> s + r.cost, 0);
    const demurrageRisk = Math.round(totalFreight * 0.02); // 2% exposure mock
    const penaltyRisk = Math.round(totalFreight * 0.012); // 1.2% mock
    const costSuggestions = [
      { action: 'Resequence loading for high-tonnage rake', impact: '₹'+(Math.round(totalFreight*0.003)).toLocaleString()+' saved' },
      { action: 'Combine partial rakes to reduce idle wagons', impact: 'Demurrage risk ↓' }
    ];

    // Sustainability alignment
    const totalCO2 = rakes.reduce((s,r)=> s + (r.emissions || 0), 0);
    const avgPerRake = totalCO2 / (rakes.length || 1);
    const targetCO2 = totalCO2 * 0.92; // assume 8% reduction target
    const ecoScore = Math.max(0, Math.min(1, (targetCO2 / (totalCO2 || 1))));
    const rakeEmissions = rakes.map(r => ({ id: r.id, emissions: r.emissions, utilization: r.utilization }));

    // Timeline & SLA (promised deadlines = ETA + buffer)
    const timeline = rakes.map((r,i) => {
      const start = new Date(now + i * 45*60000);
      const eta = new Date(r.eta || (now + (i+2)*90*60000));
      const promised = new Date(eta.getTime() + 60*60000); // promised 1h after ETA
      const slaRisk = r.slaFlag ? 0.05 : 0.25 + (i*0.01);
      return { id: r.id, start, eta, promised, slaRisk };
    });

    // AI Suggestions (mock reasoning)
    const aiSuggestions = [
      { id: 'SUG-1', message: 'Approve WG cluster to Bhilai now – saves ₹85K & 2h delay', impact: { cost: -85000, timeHrs: -2 }, actionType: 'approve' },
      { id: 'SUG-2', message: 'Delay Rake '+(rakes[2]?.id||'RAK-3')+' by 30m – align with wagon release & avoid demurrage', impact: { demurrage: -12000 }, actionType: 'delay' },
      { id: 'SUG-3', message: 'Merge two partial BOXN rakes to raise utilization to 93%', impact: { utilization: +4.5 }, actionType: 'merge' }
    ];

    // Policy / Compliance (mock rule checks)
    const policy = {
      rulesChecked: 18,
      violations: rakes.filter(r=> r.utilization < 70).map(r=> ({ rake: r.id, rule: 'Min utilization 70%', current: r.utilization }))
    };

    // Goals & Targets
    const goals = {
      utilization: { value: result.optimal.summary.avgUtilization, target: 90, status: result.optimal.summary.avgUtilization >= 90 ? 'green':'amber' },
      turnaround: { value: 7.8, target: 7, status: 7.8 <= 7 ? 'green':'amber' },
      co2Reduction: { value: Math.round((1- (totalCO2/(totalCO2*1.08)))*100), target: 8, status: ecoScore >= 0.92 ? 'green':'amber' }
    };

    // Team / Role matrix (static mock)
    const team = {
      roles: [
        { role: 'Plant Manager', user: 'plant_mgr@sail.test', responsibility: 'Production pacing' },
        { role: 'Yard Supervisor', user: 'yard_sup@sail.test', responsibility: 'Wagon staging' },
        { role: 'Logistics Coordinator', user: 'log_coord@sail.test', responsibility: 'Dispatch sequencing' },
        { role: 'Sustainability Officer', user: 'green@sail.test', responsibility: 'Emission oversight' }
      ]
    };

    // Decision impact templates
    const decisionImpactTemplates = [
      { action: 'Delay', effect: { slaRisk: '+3.5%', cost: '-₹25K', emission: '-2.1T' } },
      { action: 'Approve', effect: { slaRisk: '-1.2%', cost: '+₹15K', emission: '+1.0T' } },
      { action: 'Merge', effect: { utilization: '+4.0%', cost: '-₹40K', emission: '-3.3T' } }
    ];

    // Alerts (dynamic conditions)
    const alerts = [];
    if (policy.violations.length) alerts.push({ type: 'Utilization', severity: 'warning', message: `${policy.violations.length} rakes below minimum utilization.` });
    if (demurrageRisk > 50000) alerts.push({ type: 'Cost', severity: 'info', message: 'Demurrage exposure trending high – review sequencing.' });
    if (ecoScore < 0.9) alerts.push({ type: 'Sustainability', severity: 'risk', message: 'Eco-score below target; consider consolidating under-filled rakes.' });

    res.json({
      timestamp: new Date().toISOString(),
      map: { plants, destinations, flows },
      strategic: { prioritizedOrders, strategicAlignmentScore },
      cost: { totalFreight, demurrageRisk, penaltyRisk, suggestions: costSuggestions },
      sustainability: { totalCO2, avgPerRake, targetCO2, ecoScore, rakeEmissions },
      timeline,
      aiSuggestions,
      policy,
      goals,
      team,
      decisionImpactTemplates,
      alerts
    });
  } catch (e) {
    console.error('manager-dashboard error', e);
    res.status(500).json({ error: 'Failed to build manager alignment dashboard', detail: e?.message || String(e) });
  }
});

['manager','admin'].forEach(prefix => {
  app.get(`/${prefix}/optimizer/alignment/manager-dashboard`, auth(prefix === 'admin' ? 'admin' : undefined), (req,res)=> {
    req.url = '/optimizer/alignment/manager-dashboard';
    app._router.handle(req,res,()=>{});
  });
});

// Export endpoints for manager dashboard snapshot (CSV / PDF)
app.get('/optimizer/alignment/export.csv', auth(), async (req,res)=> {
  try {
    const dashRes = await fetch('http://localhost:'+ (process.env.PORT||4000) +'/optimizer/alignment/manager-dashboard', { headers:{ Authorization: req.headers.authorization||'' }});
    const data = await dashRes.json();
    const rows = [
      'Section,Key,Value',
      `Strategic,AlignmentScore,${data.strategic?.strategicAlignmentScore}`,
      ...data.map?.flows?.map(f=> `Flow,${f.from}->${f.to},${Math.round(f.tons)}T @₹${f.cost}`) || [],
      ...data.cost?.suggestions?.map(s=> `CostSuggestion,${s.action},${s.impact}`) || [],
      ...data.aiSuggestions?.map(a=> `AISuggestion,${a.id},${a.message}`) || [],
      ...data.alerts?.map(a=> `Alert,${a.type},${a.message}`) || []
    ];
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename="alignment-dashboard.csv"');
    res.send(rows.join('\n'));
  } catch(e) {
    res.status(500).json({ error:'Failed to export CSV', detail: e?.message||String(e) });
  }
});

app.get('/optimizer/alignment/export.pdf', auth(), async (req,res)=> {
  try {
    const dashRes = await fetch('http://localhost:'+ (process.env.PORT||4000) +'/optimizer/alignment/manager-dashboard', { headers:{ Authorization: req.headers.authorization||'' }});
    const data = await dashRes.json();
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="alignment-dashboard.pdf"');
    const doc = new PDFDocument({ size:'A4', margin:40 });
    doc.pipe(res);
    doc.fontSize(16).text('Manager Alignment Dashboard Snapshot');
    doc.moveDown(0.5).fontSize(9).fillColor('#555').text(new Date().toLocaleString());
    doc.moveDown(0.8).fillColor('#000');
    const section = (title) => { doc.moveDown(0.6).fontSize(12).fillColor('#111827').text(title); doc.moveDown(0.2).fontSize(9).fillColor('#374151'); };
    section('Strategic Priority');
    doc.text('Alignment Score: '+ Math.round((data.strategic?.strategicAlignmentScore||0)*100)+'%');
    section('Flows');
    (data.map?.flows||[]).slice(0,20).forEach(f=> doc.text(`${f.from} -> ${f.to}  ${Math.round(f.tons)}T  Cost ₹${f.cost}  CO₂ ${f.emissions?.toFixed?.(1)||0}T`));
    section('Cost Suggestions');
    (data.cost?.suggestions||[]).forEach(s=> doc.text(`• ${s.action} (${s.impact})`));
    section('AI Suggestions');
    (data.aiSuggestions||[]).forEach(a=> doc.text(`• ${a.message}`));
    section('Alerts');
    (data.alerts||[]).forEach(a=> doc.text(`• [${a.type}] ${a.message}`));
    doc.end();
  } catch(e) {
    res.status(500).json({ error:'Failed to export PDF', detail: e?.message||String(e) });
  }
});

// Periodic push over WebSocket (Socket.IO namespace)
setInterval(async ()=> {
  try {
    const result = optimizeRakeFormation(OPTIMIZER_DATA.orders); // lightweight call
    const summary = result.optimal.summary;
    const avgUtil = summary.avgUtilization;
    const cost = summary.totalCost;
    const co2 = summary.totalEmissions ?? summary.carbonFootprint ?? 0;
    // Simple alignment score: blend of utilization and inverse cost growth (normalized)
    const utilScore = avgUtil / 100; // 0..1
    const costBaseline = 1_000_000; // arbitrary normalization anchor
    const costScore = Math.max(0, Math.min(1, 1 - (cost / (costBaseline*2))));
    const alignmentScore = Number(((utilScore*0.7 + costScore*0.3)).toFixed(4));
    const sample = { avgUtil, cost, co2, alignmentScore, ts: Date.now() };
    alignmentNS.emit('heartbeat', sample);
  } catch(e) {
    // silent
  }
}, 10000).unref();

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
  
  // Derive additional summary metrics for legacy/report UI compatibility
  const wagonUtil = calculateWagonUtilization();
  const capacityGap = Math.max(0, totalOrderVolume - railCapacity); // demand exceeding theoretical rail capacity
  const alignmentScore = (() => {
    // Blend of rail coverage and effective utilization penalized by capacity gap ratio
    const cov = railCoverage; // 0..1
    const util = wagonUtil.utilization / 100; // 0..1
    const gapPenalty = capacityGap > 0 ? Math.min(0.3, capacityGap / (totalOrderVolume || 1)) : 0;
    return Math.max(0, Math.min(1, (cov * 0.55 + util * 0.45) * (1 - gapPenalty)));
  })();

  const recommendationsText = recommendations.map(r => `Increase ${r.product} at ${r.plant} by ${r.quantity}T (Priority: ${r.priority}) – ${r.rationale}`);
  if (capacityGap > 0 && recommendationsText.length === 0) {
    recommendationsText.push(`Capacity gap of ${capacityGap}T detected – evaluate supplemental road logistics or production shift.`);
  }
  if (wagonUtil.idle > 50) {
    recommendationsText.push(`Idle wagons: ${wagonUtil.idle}. Consider redeployment or leasing to improve utilization.`);
  }

  return {
    productionRecommendations: recommendations,
    recommendations: recommendationsText, // compatibility for report page expecting simple string list
    summary: {
      totalProduction: totalOrderVolume,
      availableWagons: wagonUtil.total,
      capacityGap,
      alignmentScore
    },
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
      wagonUtilization: wagonUtil,
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
  try { pushEvent({ type: 'export', page: '/optimizer', action: 'daily_plan_csv', role: req.user?.role||'guest', user: req.user?.email||'', meta: { rakes: result.optimal.rakes.length }, ts: Date.now() }); } catch {}
  res.send(`${csvHeaders}\n${csvRows}`);
});

// PDF export of the daily dispatch plan (for yard managers)
app.get('/optimizer/export/daily-plan.pdf', auth(), (req, res) => {
  const result = optimizeRakeFormation(OPTIMIZER_DATA.orders);
  const rakes = result.optimal.rakes;
  const summary = result.optimal.summary;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="daily-rake-plan.pdf"');
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);

  // Header
  doc.fontSize(18).text('Daily Dispatch Plan', { align: 'left' });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor('#666').text(`Date: ${new Date().toLocaleString()}`);
  doc.moveDown(0.6).fillColor('#000');

  // KPIs
  const kpiY = doc.y;
  const kpiBox = (x, title, value) => {
    doc.rect(x, kpiY, 160, 48).stroke('#e5e7eb');
    doc.fontSize(9).fillColor('#6b7280').text(title, x + 8, kpiY + 8);
    doc.fontSize(14).fillColor('#111827').text(String(value), x + 8, kpiY + 24);
  };
  kpiBox(40, 'Total Rakes', rakes.length);
  kpiBox(210, 'Avg Utilization', `${summary.avgUtilization.toFixed(1)}%`);
  kpiBox(380, 'Total Cost', `₹${summary.totalCost.toLocaleString()}`);
  doc.moveDown(4);

  // Table header
  const startY = doc.y + 10;
  const cols = [
    { key: 'id', label: 'Rake ID', w: 70 },
    { key: 'cargo', label: 'Cargo', w: 90 },
    { key: 'loadingPoint', label: 'Loading Point', w: 90 },
    { key: 'destination', label: 'Destination', w: 90 },
    { key: 'wagons', label: 'Wagons', w: 60 },
    { key: 'eta', label: 'ETA', w: 100 },
    { key: 'cost', label: 'Cost', w: 70 },
    { key: 'slaFlag', label: 'SLA', w: 40 },
  ];

  let x = 40; let y = startY;
  doc.fontSize(10).fillColor('#374151');
  cols.forEach(c => { doc.text(c.label, x, y, { width: c.w }); x += c.w; });
  y += 16; x = 40; doc.moveTo(40, y).lineTo(555, y).stroke('#e5e7eb'); y += 6;

  // Rows
  doc.fontSize(9).fillColor('#111827');
  rakes.forEach((r, idx) => {
    if (y > 770) { doc.addPage(); y = 40; x = 40; }
    const values = [
      r.id,
      r.cargo,
      r.loadingPoint,
      r.destination,
      `${r.wagons} ${r.wagonType}`,
      new Date(r.eta).toLocaleString(),
      `₹${r.cost.toLocaleString()}`,
      r.slaFlag ? 'YES' : 'NO'
    ];
    values.forEach((val, i) => { const c = cols[i]; doc.text(String(val), x, y, { width: c.w }); x += c.w; });
    x = 40; y += 16; doc.moveTo(40, y).lineTo(555, y).stroke('#f3f4f6'); y += 2;
  });

  doc.end();
  try { pushEvent({ type: 'export', page: '/optimizer', action: 'daily_plan_pdf', role: req.user?.role||'guest', user: req.user?.email||'', meta: { rakes: rakes.length }, ts: Date.now() }); } catch {}
});

// Basic root & health endpoints for diagnostics (non-sensitive)
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'qsteel-api', time: Date.now() });
});
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Global error / rejection handlers to surface hidden crashes
process.on('uncaughtException', err => {
  console.error('[FATAL][uncaughtException]', err);
});
process.on('unhandledRejection', err => {
  console.error('[FATAL][unhandledRejection]', err);
});

const PORT = process.env.PORT || 4000;
console.log('[BOOT] initiating server start on port', PORT);
httpServer.on('error', err => {
  console.error('[SERVER][error]', err);
});
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[BOOT] listening on http://localhost:${PORT}`);
  if (!allowAll) console.log('CORS origins allowed:', CORS_ORIGINS.join(', '));
});

// Heartbeat log (unref so it doesn't keep process alive if something else ends it)
setInterval(() => {
  if (process.env.API_HEARTBEAT === '1') {
    console.log('[HEARTBEAT]', new Date().toISOString());
  }
}, 60000).unref();
