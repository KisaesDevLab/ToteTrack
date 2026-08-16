CREATE TABLE "preprinted_labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"series_id" integer NOT NULL,
	"number" integer NOT NULL,
	"printed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_box_id" integer,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "preprinted_labels" ADD CONSTRAINT "preprinted_labels_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preprinted_labels" ADD CONSTRAINT "preprinted_labels_claimed_box_id_boxes_id_fk" FOREIGN KEY ("claimed_box_id") REFERENCES "public"."boxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "preprinted_series_number_uq" ON "preprinted_labels" USING btree ("series_id","number");--> statement-breakpoint
CREATE INDEX "preprinted_unclaimed_idx" ON "preprinted_labels" USING btree ("series_id","claimed_at");