import { sql } from 'drizzle-orm';
import {
  char,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const boxStatusEnum = pgEnum('box_status', ['open', 'sealed']);
export const aiStatusEnum = pgEnum('ai_status', ['none', 'pending', 'done', 'error']);
export const itemSourceEnum = pgEnum('item_source', ['ai', 'manual']);

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const series = pgTable('series', {
  id: serial('id').primaryKey(),
  letter: char('letter', { length: 1 }).notNull().unique(),
  description: text('description'),
  nextNumber: integer('next_number').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const locations = pgTable('locations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const boxes = pgTable(
  'boxes',
  {
    id: serial('id').primaryKey(),
    seriesId: integer('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'restrict' }),
    /** Denormalised copy of series.letter so label_id can be a generated column. */
    seriesLetter: char('series_letter', { length: 1 }).notNull(),
    number: integer('number').notNull(),
    labelId: text('label_id')
      .notNull()
      .generatedAlwaysAs(sql`series_letter || '-' || lpad(number::text, 3, '0')`),
    name: text('name'),
    locationId: integer('location_id').references(() => locations.id, { onDelete: 'set null' }),
    status: boxStatusEnum('status').notNull().default('open'),
    aiDescription: text('ai_description'),
    aiStatus: aiStatusEnum('ai_status').notNull().default('none'),
    aiError: text('ai_error'),
    printedAt: timestamp('printed_at', { withTimezone: true }),
    searchVector: tsvector('search_vector'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('boxes_series_number_uq').on(t.seriesId, t.number),
    uniqueIndex('boxes_label_id_uq').on(t.labelId),
    index('boxes_location_idx').on(t.locationId),
    index('boxes_series_idx').on(t.seriesId),
    index('boxes_search_gin').using('gin', t.searchVector),
    index('boxes_label_trgm').using('gin', sql`${t.labelId} gin_trgm_ops`),
  ],
);

export const photos = pgTable(
  'photos',
  {
    id: serial('id').primaryKey(),
    boxId: integer('box_id')
      .notNull()
      .references(() => boxes.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    originalPath: text('original_path').notNull(),
    thumbPath: text('thumb_path').notNull(),
    width: integer('width'),
    height: integer('height'),
    aiStatus: aiStatusEnum('ai_status').notNull().default('none'),
    aiError: text('ai_error'),
    /** Per-photo AI summary; box.ai_description is derived from these unless a box-level run replaced it. */
    aiDescription: text('ai_description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('photos_box_idx').on(t.boxId, t.sortOrder)],
);

export const items = pgTable(
  'items',
  {
    id: serial('id').primaryKey(),
    boxId: integer('box_id')
      .notNull()
      .references(() => boxes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    qty: integer('qty').notNull().default(1),
    note: text('note'),
    source: itemSourceEnum('source').notNull().default('manual'),
    photoId: integer('photo_id').references(() => photos.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('items_box_idx').on(t.boxId),
    index('items_photo_idx').on(t.photoId),
    index('items_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
);

/** Labels printed ahead of time (numbers reserved in a series). Claimed when a box takes the number. */
export const preprintedLabels = pgTable(
  'preprinted_labels',
  {
    id: serial('id').primaryKey(),
    seriesId: integer('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    printedAt: timestamp('printed_at', { withTimezone: true }).notNull().defaultNow(),
    claimedBoxId: integer('claimed_box_id').references(() => boxes.id, { onDelete: 'set null' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('preprinted_series_number_uq').on(t.seriesId, t.number),
    index('preprinted_unclaimed_idx').on(t.seriesId, t.claimedAt),
  ],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SeriesRow = typeof series.$inferSelect;
export type LocationRow = typeof locations.$inferSelect;
export type BoxRow = typeof boxes.$inferSelect;
export type PhotoRow = typeof photos.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type PreprintedLabelRow = typeof preprintedLabels.$inferSelect;
