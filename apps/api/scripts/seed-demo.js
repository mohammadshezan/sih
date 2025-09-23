import 'dotenv/config';

const base = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
const key = process.env.SEED_KEY || '';

async function run() {
  const url = `${base.replace(/\/$/, '')}/dev/seed-demo`;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key? { 'x-seed-key': key } : {}) } });
    const txt = await res.text();
    let data = null; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (!res.ok) {
      console.error('Seed failed:', data);
      process.exit(1);
    }
    console.log('Seed success:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Seed error:', e?.message || e);
    process.exit(1);
  }
}

run();
