import 'dotenv/config';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Users
  await prisma.user.createMany({ skipDuplicates: true, data: [
    { email: 'admin@sail.test', role: 'admin' },
    { email: 'manager@sail.test', role: 'manager' },
    { email: 'yard@sail.test', role: 'yard' },
  ]});

  // Plants & Yards
  const bokaro = await prisma.plant.upsert({ where: { name: 'Bokaro' }, update: {}, create: { name: 'Bokaro' }});
  const durgapur = await prisma.plant.upsert({ where: { name: 'Durgapur' }, update: {}, create: { name: 'Durgapur' }});
  const rourkela = await prisma.plant.upsert({ where: { name: 'Rourkela' }, update: {}, create: { name: 'Rourkela' }});

  const yardA = await prisma.yard.upsert({ where: { id: 1 }, update: {}, create: { name: 'Yard A', lat: 23.66, lng: 86.15, plantId: bokaro.id }});
  const yardB = await prisma.yard.upsert({ where: { id: 2 }, update: {}, create: { name: 'Yard B', lat: 23.63, lng: 86.18, plantId: bokaro.id }});

  // Rakes & Wagons
  const rake1 = await prisma.rake.upsert({ where: { code: 'rake-101' }, update: {}, create: { code: 'rake-101', yardId: yardA.id }});
  const rake2 = await prisma.rake.upsert({ where: { code: 'rake-202' }, update: {}, create: { code: 'rake-202', yardId: yardB.id }});

  await prisma.wagon.createMany({ skipDuplicates: true, data: [
    { code: 'WGN-1', rakeId: rake1.id, type: 'steel', capT: 60 },
    { code: 'WGN-2', rakeId: rake1.id, type: 'steel', capT: 60 },
    { code: 'WGN-3', rakeId: rake2.id, type: 'steel', capT: 60 },
    { code: 'WGN-4', type: 'general', capT: 60 },
    { code: 'WGN-5', type: 'general', capT: 60 },
  ]});

  // Stations
  const stnData = [
    { code: 'BKSC', name: 'Bokaro Steel City', lat: 23.658, lng: 86.151 },
    { code: 'DGR', name: 'Durgapur', lat: 23.538, lng: 87.291 },
    { code: 'Dhanbad', name: 'Dhanbad', lat: 23.795, lng: 86.43 },
    { code: 'Asansol', name: 'Asansol', lat: 23.685, lng: 86.974 },
    { code: 'Andal', name: 'Andal', lat: 23.593, lng: 87.242 },
    { code: 'ROU', name: 'Rourkela', lat: 22.227, lng: 84.857 },
    { code: 'Purulia', name: 'Purulia', lat: 23.332, lng: 86.365 },
    { code: 'BPHB', name: 'Bhilai Power House', lat: 21.208, lng: 81.379 },
    { code: 'Norla', name: 'Norla Road', lat: 19.188, lng: 82.787 },
  ];
  await prisma.station.createMany({ skipDuplicates: true, data: stnData });

  // Routes with ordered stations
  async function upsertRoute(key, seqCodes, plantId) {
    // Ensure stations exist
    const stations = await prisma.station.findMany({ where: { code: { in: seqCodes } } });
    const map = new Map(stations.map(s => [s.code, s]));
    const from = map.get(seqCodes[0]);
    const to = map.get(seqCodes[seqCodes.length - 1]);
    const route = await prisma.route.upsert({
      where: { key },
      update: { name: key, fromId: from?.id, toId: to?.id, plantId },
      create: { key, name: key, fromId: from?.id, toId: to?.id, plantId }
    });
    // Clear existing sequence and recreate
    await prisma.routeStation.deleteMany({ where: { routeId: route.id } });
    for (let i = 0; i < seqCodes.length; i++) {
      const st = map.get(seqCodes[i]);
      if (!st) continue;
      await prisma.routeStation.create({ data: { routeId: route.id, stationId: st.id, seq: i } });
    }
    return route;
  }

  await upsertRoute('BKSC-DGR', ['BKSC','Dhanbad','Asansol','Andal','DGR'], bokaro.id);
  await upsertRoute('BKSC-ROU', ['BKSC','Purulia','ROU'], bokaro.id);
  await upsertRoute('BKSC-BPHB', ['BKSC','Norla','BPHB'], bokaro.id);

  console.log('Seed completed');
}

main().finally(()=>prisma.$disconnect());
