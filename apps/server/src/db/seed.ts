import { eq } from 'drizzle-orm';
import { loadEnv } from '../env.js';
import { createBox } from '../services/boxes.js';
import { refreshBoxSearchVector } from '../services/search-vector.js';
import { createDb } from './index.js';
import { runMigrations } from './migrate.js';
import { boxes, items, locations, series } from './schema.js';

const env = loadEnv();
const handle = createDb(env.DATABASE_URL);
const { db } = handle;

try {
  await runMigrations(db);

  const existing = await db.select().from(series);
  if (existing.length) {
    console.log(`Seed skipped: ${existing.length} series already exist.`);
  } else {
    const [a] = await db
      .insert(series)
      .values({ letter: 'A', description: 'General storage' })
      .returning();
    const [b] = await db
      .insert(series)
      .values({ letter: 'B', description: 'Seasonal & holiday' })
      .returning();
    const [garage] = await db
      .insert(locations)
      .values({ name: 'Garage shelf 1', sortOrder: 0 })
      .returning();
    const [attic] = await db.insert(locations).values({ name: 'Attic', sortOrder: 1 }).returning();
    const [closet] = await db
      .insert(locations)
      .values({ name: 'Hall closet', sortOrder: 2 })
      .returning();

    const box1 = await createBox(db, {
      seriesId: a!.id,
      name: 'Camping gear',
      locationId: garage!.id,
    });
    const box2 = await createBox(db, {
      seriesId: a!.id,
      name: 'Kitchen overflow',
      locationId: closet!.id,
      status: 'sealed',
    });
    const box3 = await createBox(db, {
      seriesId: b!.id,
      name: 'Christmas decorations',
      locationId: attic!.id,
    });

    await db.insert(items).values([
      { boxId: box1.id, name: 'Two-person tent', qty: 1, note: 'Green, REI', source: 'manual' },
      { boxId: box1.id, name: 'Sleeping bag', qty: 2, note: null, source: 'manual' },
      { boxId: box1.id, name: 'Headlamp', qty: 1, note: 'Needs AAA batteries', source: 'manual' },
      { boxId: box2.id, name: 'Muffin tin', qty: 2, note: null, source: 'manual' },
      { boxId: box2.id, name: 'Slow cooker', qty: 1, note: 'Crock-Pot 6qt', source: 'manual' },
      { boxId: box3.id, name: 'String lights', qty: 4, note: 'Warm white LED', source: 'manual' },
      { boxId: box3.id, name: 'Glass ornaments', qty: 24, note: 'Fragile', source: 'manual' },
    ]);
    await db
      .update(boxes)
      .set({
        aiDescription: 'Camping equipment: tent, sleeping bags and lighting for weekend trips.',
      })
      .where(eq(boxes.id, box1.id));
    for (const id of [box1.id, box2.id, box3.id]) await refreshBoxSearchVector(db, id);
    console.log('Seeded 2 series, 3 locations, 3 boxes, 7 items.');
  }
} finally {
  await handle.close();
}
