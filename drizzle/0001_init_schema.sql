CREATE TYPE "public"."batch_status" AS ENUM('SCHEDULED', 'ACTIVE', 'SOLD_OUT', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."menu_category" AS ENUM('MAKANAN_BERAT', 'MAKANAN_RINGAN', 'MAKANAN_VEGAN', 'MINUMAN', 'ROTI_PASTRY', 'BAHAN_MAKANAN', 'MYSTERY_BAG');--> statement-breakpoint
CREATE TYPE "public"."merchant_tier" AS ENUM('REGULAR', 'PREMIUM');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING_PAYMENT', 'PAID', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."payment_method_type" AS ENUM('QRIS', 'GOPAY', 'OVO', 'DANA', 'SURPLUS_PAY');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('CUSTOMER', 'MERCHANT', 'ADMIN');--> statement-breakpoint
CREATE TABLE "customer_merchant_subscriptions" (
	"user_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"notify_on_surplus_live" boolean DEFAULT true NOT NULL,
	"notify_on_ai_prediction" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_merchant_subscriptions_user_id_merchant_id_pk" PRIMARY KEY("user_id","merchant_id")
);
--> statement-breakpoint
CREATE TABLE "discount_adjustment_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"surplus_batch_id" uuid NOT NULL,
	"previous_discount_pct" integer NOT NULL,
	"new_discount_pct" integer NOT NULL,
	"previous_price_idr" integer NOT NULL,
	"new_price_idr" integer NOT NULL,
	"remaining_stock" integer NOT NULL,
	"minutes_to_closing" integer NOT NULL,
	"active_users_in_radius" integer NOT NULL,
	"trigger_reason" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"menu_name" varchar(150) NOT NULL,
	"category" "menu_category" DEFAULT 'MAKANAN_BERAT' NOT NULL,
	"description" text,
	"image_url" text,
	"original_price_idr" integer NOT NULL,
	"min_recovery_price_idr" integer NOT NULL,
	"portion_weight_grams" integer DEFAULT 200 NOT NULL,
	"is_mystery_bag" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menus_original_price_positive" CHECK ("menus"."original_price_idr" > 0),
	CONSTRAINT "menus_min_recovery_positive" CHECK ("menus"."min_recovery_price_idr" > 0),
	CONSTRAINT "menus_floor_le_original" CHECK ("menus"."min_recovery_price_idr" <= "menus"."original_price_idr"),
	CONSTRAINT "menus_portion_weight_positive" CHECK ("menus"."portion_weight_grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "merchant_surplus_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"menu_id" uuid,
	"target_date" date NOT NULL,
	"day_of_week" smallint NOT NULL,
	"predicted_surplus_portions" numeric(6, 2) NOT NULL,
	"predicted_peak_surplus_hour" time DEFAULT '20:00:00' NOT NULL,
	"sellout_probability_at_50pct" numeric(5, 4) NOT NULL,
	"confidence_score" numeric(5, 4) NOT NULL,
	"model_version" varchar(40) NOT NULL,
	"proactive_notif_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_predictions_merchant_menu_date" UNIQUE NULLS NOT DISTINCT("merchant_id","menu_id","target_date"),
	CONSTRAINT "predictions_dow_range" CHECK ("merchant_surplus_predictions"."day_of_week" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"merchant_name" varchar(150) NOT NULL,
	"slug" varchar(160) NOT NULL,
	"merchant_category" "menu_category" DEFAULT 'MAKANAN_BERAT' NOT NULL,
	"description" text,
	"logo_url" text,
	"banner_url" text,
	"address" text NOT NULL,
	"whatsapp_number" varchar(25) NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"geom" geography(Point, 4326) GENERATED ALWAYS AS ((ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography)) STORED,
	"operational_open_time" time DEFAULT '09:00:00' NOT NULL,
	"operational_close_time" time DEFAULT '22:00:00' NOT NULL,
	"default_surplus_start_time" time DEFAULT '20:00:00' NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"merchant_verified" boolean DEFAULT false NOT NULL,
	"subscription_tier" "merchant_tier" DEFAULT 'REGULAR' NOT NULL,
	"subscription_expires_at" timestamp with time zone,
	"static_qris_payload" text,
	"bank_code" varchar(30),
	"bank_account_number" varchar(50),
	"bank_account_holder" varchar(120),
	"wallet_balance_idr" bigint DEFAULT 0 NOT NULL,
	"historical_conversion_rate" numeric(5, 4) DEFAULT 0.65 NOT NULL,
	"rating_avg" numeric(3, 2) DEFAULT 5 NOT NULL,
	"total_reviews" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "merchants_lat_range" CHECK ("merchants"."latitude" BETWEEN -90 AND 90),
	CONSTRAINT "merchants_lng_range" CHECK ("merchants"."longitude" BETWEEN -180 AND 180),
	CONSTRAINT "merchants_conversion_rate_range" CHECK ("merchants"."historical_conversion_rate" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"surplus_batch_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"menu_name_snapshot" varchar(150) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_original_price_idr" integer NOT NULL,
	"unit_selling_price_idr" integer NOT NULL,
	"discount_pct_applied" integer NOT NULL,
	"portion_weight_grams" integer DEFAULT 200 NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" varchar(32) NOT NULL,
	"customer_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'PENDING_PAYMENT' NOT NULL,
	"pickup_code" varchar(10) NOT NULL,
	"pickup_qr_token" text NOT NULL,
	"scheduled_pickup_time" timestamp with time zone,
	"pickup_deadline_at" timestamp with time zone NOT NULL,
	"uses_own_lunchbox" boolean DEFAULT false NOT NULL,
	"subtotal_original_idr" integer NOT NULL,
	"subtotal_recovery_idr" integer NOT NULL,
	"voucher_discount_idr" integer DEFAULT 0 NOT NULL,
	"platform_commission_idr" integer DEFAULT 1500 NOT NULL,
	"total_customer_paid_idr" integer NOT NULL,
	"net_merchant_payout_idr" integer NOT NULL,
	"payment_method" "payment_method_type" DEFAULT 'QRIS' NOT NULL,
	"payment_gateway_ref" varchar(120),
	"qris_dynamic_string" text,
	"payment_expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"pickup_proof_image_url" text,
	"cancel_reason" text,
	"total_food_saved_grams" integer DEFAULT 0 NOT NULL,
	"total_co2_avoided_grams" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_orderNumber_unique" UNIQUE("order_number"),
	CONSTRAINT "orders_pickupQrToken_unique" UNIQUE("pickup_qr_token"),
	CONSTRAINT "orders_amounts_nonneg" CHECK (
      "orders"."subtotal_original_idr" >= 0 AND "orders"."subtotal_recovery_idr" >= 0 AND
      "orders"."voucher_discount_idr" >= 0 AND "orders"."platform_commission_idr" >= 0 AND
      "orders"."total_customer_paid_idr" >= 0 AND "orders"."net_merchant_payout_idr" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"tags" text[],
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_orderId_unique" UNIQUE("order_id"),
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "surplus_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"batch_date" date DEFAULT CURRENT_DATE NOT NULL,
	"initial_stock" integer NOT NULL,
	"available_stock" integer NOT NULL,
	"reserved_stock" integer DEFAULT 0 NOT NULL,
	"original_price_idr" integer NOT NULL,
	"current_discount_pct" integer NOT NULL,
	"current_selling_price_idr" integer NOT NULL,
	"auto_discount_enabled" boolean DEFAULT true NOT NULL,
	"predicted_sellout_prob" numeric(5, 4),
	"pickup_start_time" timestamp with time zone NOT NULL,
	"pickup_end_time" timestamp with time zone NOT NULL,
	"status" "batch_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_price_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_initial_stock_positive" CHECK ("surplus_batches"."initial_stock" > 0),
	CONSTRAINT "batches_available_stock_nonneg" CHECK ("surplus_batches"."available_stock" >= 0),
	CONSTRAINT "batches_reserved_stock_nonneg" CHECK ("surplus_batches"."reserved_stock" >= 0),
	CONSTRAINT "batches_stock_le_initial" CHECK ("surplus_batches"."available_stock" + "surplus_batches"."reserved_stock" <= "surplus_batches"."initial_stock"),
	CONSTRAINT "batches_discount_range" CHECK ("surplus_batches"."current_discount_pct" BETWEEN 0 AND 90),
	CONSTRAINT "batches_selling_price_positive" CHECK ("surplus_batches"."current_selling_price_idr" > 0),
	CONSTRAINT "batches_pickup_window" CHECK ("surplus_batches"."pickup_end_time" > "surplus_batches"."pickup_start_time")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "user_role" DEFAULT 'CUSTOMER' NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"email" varchar(150),
	"phone_number" varchar(25),
	"password_hash" text,
	"avatar_url" text,
	"campus_or_area" varchar(100),
	"default_lat" double precision,
	"default_lng" double precision,
	"webpush_subscription" jsonb,
	"loyalty_points" integer DEFAULT 0 NOT NULL,
	"badge_tier" varchar(50) DEFAULT 'SURPLUS_ROOKIE' NOT NULL,
	"total_food_saved_grams" integer DEFAULT 0 NOT NULL,
	"total_co2_avoided_grams" integer DEFAULT 0 NOT NULL,
	"total_money_saved_idr" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phoneNumber_unique" UNIQUE("phone_number"),
	CONSTRAINT "users_contact_required" CHECK ("users"."email" IS NOT NULL OR "users"."phone_number" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "customer_merchant_subscriptions" ADD CONSTRAINT "customer_merchant_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_merchant_subscriptions" ADD CONSTRAINT "customer_merchant_subscriptions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_adjustment_logs" ADD CONSTRAINT "discount_adjustment_logs_surplus_batch_id_surplus_batches_id_fk" FOREIGN KEY ("surplus_batch_id") REFERENCES "public"."surplus_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_surplus_predictions" ADD CONSTRAINT "merchant_surplus_predictions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_surplus_predictions" ADD CONSTRAINT "merchant_surplus_predictions_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_surplus_batch_id_surplus_batches_id_fk" FOREIGN KEY ("surplus_batch_id") REFERENCES "public"."surplus_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_batches" ADD CONSTRAINT "surplus_batches_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_batches" ADD CONSTRAINT "surplus_batches_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_subscriptions_merchant" ON "customer_merchant_subscriptions" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "idx_discount_logs_batch" ON "discount_adjustment_logs" USING btree ("surplus_batch_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_menus_merchant" ON "menus" USING btree ("merchant_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_predictions_date" ON "merchant_surplus_predictions" USING btree ("target_date");--> statement-breakpoint
CREATE INDEX "idx_merchants_geom" ON "merchants" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "idx_merchants_tier_open" ON "merchants" USING btree ("is_open","subscription_tier","rating_avg" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_merchants_owner" ON "merchants" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_order_items_order" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_order_items_batch" ON "order_items" USING btree ("surplus_batch_id");--> statement-breakpoint
CREATE INDEX "idx_orders_customer_status" ON "orders" USING btree ("customer_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_orders_merchant_status" ON "orders" USING btree ("merchant_id","status","pickup_deadline_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_orders_active_pickup_code" ON "orders" USING btree ("merchant_id","pickup_code") WHERE status IN ('PENDING_PAYMENT', 'PAID', 'READY_FOR_PICKUP');--> statement-breakpoint
CREATE INDEX "idx_reviews_merchant" ON "reviews" USING btree ("merchant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_batches_active_window" ON "surplus_batches" USING btree ("status","pickup_end_time","current_selling_price_idr");--> statement-breakpoint
CREATE INDEX "idx_batches_merchant_date" ON "surplus_batches" USING btree ("merchant_id","batch_date");