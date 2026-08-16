ALTER TABLE "boxes" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "preprinted_labels" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "preprinted_labels" ADD COLUMN "template_id" text;--> statement-breakpoint
CREATE INDEX "boxes_deleted_idx" ON "boxes" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "photos_deleted_idx" ON "photos" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "preprinted_batch_idx" ON "preprinted_labels" USING btree ("batch_id");