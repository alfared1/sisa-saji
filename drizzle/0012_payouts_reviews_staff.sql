CREATE TYPE "public"."payout_status" AS ENUM('PROCESSING', 'PAID', 'FAILED');--> statement-breakpoint
CREATE TABLE "merchant_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"amount_idr" bigint NOT NULL,
	"status" "payout_status" DEFAULT 'PROCESSING' NOT NULL,
	"bank_code" varchar(30) NOT NULL,
	"account_masked" varchar(50) NOT NULL,
	"account_holder" varchar(120),
	"ref" varchar(40) NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "merchant_payouts_ref_unique" UNIQUE("ref"),
	CONSTRAINT "merchant_payouts_amount_positive" CHECK ("merchant_payouts"."amount_idr" > 0)
);
--> statement-breakpoint
CREATE TABLE "merchant_staff" (
	"merchant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_staff_merchant_id_user_id_pk" PRIMARY KEY("merchant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "merchant_reply" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "merchant_replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchant_payouts" ADD CONSTRAINT "merchant_payouts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_staff" ADD CONSTRAINT "merchant_staff_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_staff" ADD CONSTRAINT "merchant_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_merchant_payouts_merchant" ON "merchant_payouts" USING btree ("merchant_id","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_merchant_staff_user" ON "merchant_staff" USING btree ("user_id");