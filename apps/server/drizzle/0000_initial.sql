CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."ai_status" AS ENUM('none', 'pending', 'done', 'error');--> statement-breakpoint
CREATE TYPE "public"."box_status" AS ENUM('open', 'sealed');--> statement-breakpoint
CREATE TYPE "public"."item_source" AS ENUM('ai', 'manual');--> statement-breakpoint
CREATE TABLE "boxes" (
	"id" serial PRIMARY KEY NOT NULL,
	"series_id" integer NOT NULL,
	"series_letter" char(1) NOT NULL,
	"number" integer NOT NULL,
	"label_id" text GENERATED ALWAYS AS (series_letter || '-' || lpad(number::text, 3, '0')) STORED NOT NULL,
	"name" text,
	"location_id" integer,
	"status" "box_status" DEFAULT 'open' NOT NULL,
	"ai_description" text,
	"ai_status" "ai_status" DEFAULT 'none' NOT NULL,
	"ai_error" text,
	"printed_at" timestamp with time zone,
	"search_vector" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" serial PRIMARY KEY NOT NULL,
	"box_id" integer NOT NULL,
	"name" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"note" text,
	"source" "item_source" DEFAULT 'manual' NOT NULL,
	"photo_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"box_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"original_path" text NOT NULL,
	"thumb_path" text NOT NULL,
	"width" integer,
	"height" integer,
	"ai_status" "ai_status" DEFAULT 'none' NOT NULL,
	"ai_error" text,
	"ai_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" serial PRIMARY KEY NOT NULL,
	"letter" char(1) NOT NULL,
	"description" text,
	"next_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_letter_unique" UNIQUE("letter")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boxes" ADD CONSTRAINT "boxes_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxes" ADD CONSTRAINT "boxes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boxes_series_number_uq" ON "boxes" USING btree ("series_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "boxes_label_id_uq" ON "boxes" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "boxes_location_idx" ON "boxes" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "boxes_series_idx" ON "boxes" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "boxes_search_gin" ON "boxes" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "boxes_label_trgm" ON "boxes" USING gin ("label_id" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "items_box_idx" ON "items" USING btree ("box_id");--> statement-breakpoint
CREATE INDEX "items_photo_idx" ON "items" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "items_name_trgm" ON "items" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "photos_box_idx" ON "photos" USING btree ("box_id","sort_order");