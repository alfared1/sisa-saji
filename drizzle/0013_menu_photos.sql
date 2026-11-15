CREATE TABLE "menu_photos" (
	"menu_id" uuid PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"bytes" bytea NOT NULL,
	"content_type" varchar(20) NOT NULL,
	"byte_size" integer NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_photos_size" CHECK ("menu_photos"."byte_size" BETWEEN 1 AND 409600),
	CONSTRAINT "menu_photos_type" CHECK ("menu_photos"."content_type" = 'image/jpeg')
);
--> statement-breakpoint
ALTER TABLE "menu_photos" ADD CONSTRAINT "menu_photos_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_photos" ADD CONSTRAINT "menu_photos_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_menu_photos_merchant" ON "menu_photos" USING btree ("merchant_id");