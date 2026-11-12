CREATE TABLE "leftover_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"report_date" date NOT NULL,
	"donated_portions" integer DEFAULT 0 NOT NULL,
	"animal_feed_portions" integer DEFAULT 0 NOT NULL,
	"compost_portions" integer DEFAULT 0 NOT NULL,
	"discarded_portions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_leftover_reports_merchant_date" UNIQUE("merchant_id","report_date"),
	CONSTRAINT "leftover_reports_non_negative" CHECK ("leftover_reports"."donated_portions" >= 0 AND "leftover_reports"."animal_feed_portions" >= 0 AND "leftover_reports"."compost_portions" >= 0 AND "leftover_reports"."discarded_portions" >= 0)
);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "pilot_baseline_leftover_portions" integer;--> statement-breakpoint
ALTER TABLE "leftover_reports" ADD CONSTRAINT "leftover_reports_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;