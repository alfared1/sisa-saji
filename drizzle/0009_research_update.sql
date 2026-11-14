CREATE TABLE "batch_photo_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_photos" (
	"surplus_batch_id" uuid PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"bytes" bytea NOT NULL,
	"content_type" varchar(20) NOT NULL,
	"byte_size" integer NOT NULL,
	"demo_only" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_photos_size" CHECK ("batch_photos"."byte_size" BETWEEN 1 AND 409600),
	CONSTRAINT "batch_photos_type" CHECK ("batch_photos"."content_type" = 'image/jpeg')
);
--> statement-breakpoint
CREATE TABLE "delivery_interests" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"kos_name" varchar(60) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "contents" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "lauk_options" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "hygiene_avg" numeric(3, 2);--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "hygiene_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "portion_full_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "portion_answer_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "lauk_choice" varchar(40);--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "hunger_alert_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "hunger_alert_lat" double precision;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "hunger_alert_lng" double precision;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "hunger_alert_geom" geography(Point, 4326) GENERATED ALWAYS AS ((ST_SetSRID(ST_MakePoint(hunger_alert_lng, hunger_alert_lat), 4326)::geography)) STORED;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "hunger_alert_radius_m" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "hunger_alert_label" varchar(80);--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "last_hunger_alert_on" date;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "hunger_alert_test_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "hygiene_rating" smallint;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "portion_full" boolean;--> statement-breakpoint
ALTER TABLE "surplus_batches" ADD COLUMN "lauk_available" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "surplus_batches" ADD COLUMN "full_portion" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "surplus_batches" ADD COLUMN "photo_upload_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "batch_photo_uploads" ADD CONSTRAINT "batch_photo_uploads_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_photos" ADD CONSTRAINT "batch_photos_surplus_batch_id_surplus_batches_id_fk" FOREIGN KEY ("surplus_batch_id") REFERENCES "public"."surplus_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_photos" ADD CONSTRAINT "batch_photos_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_interests" ADD CONSTRAINT "delivery_interests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_batch_photo_uploads_merchant" ON "batch_photo_uploads" USING btree ("merchant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_batch_photos_merchant" ON "batch_photos" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "idx_push_hunger_geom" ON "push_subscriptions" USING gist ("hunger_alert_geom") WHERE hunger_alert_enabled;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_contents_max" CHECK (cardinality("menus"."contents") <= 12);--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_lauk_options_max" CHECK (cardinality("menus"."lauk_options") <= 8);--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_hygiene_range" CHECK ("reviews"."hygiene_rating" IS NULL OR "reviews"."hygiene_rating" BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE "surplus_batches" ADD CONSTRAINT "batches_lauk_available_max" CHECK (cardinality("surplus_batches"."lauk_available") <= 8);--> statement-breakpoint
-- Data: no closed "paket kejutan" may be published or shown any more. Real pilot warung with
-- such a menu must create a listed menu. Live batches of those menus that nobody has reserved
-- end now; batches with reserved portions stay so open orders and tickets can still be picked up.
UPDATE "menus" SET "is_active" = false, "updated_at" = now() WHERE "is_active" AND ("is_mystery_bag" OR "category" = 'MYSTERY_BAG');--> statement-breakpoint
UPDATE "surplus_batches" SET "status" = 'EXPIRED', "updated_at" = now()
WHERE "status" IN ('ACTIVE', 'SCHEDULED') AND "reserved_stock" = 0
  AND "menu_id" IN (SELECT "id" FROM "menus" WHERE "is_mystery_bag" OR "category" = 'MYSTERY_BAG');