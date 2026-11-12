ALTER TYPE "public"."payment_method_type" ADD VALUE 'BAYAR_DI_WARUNG';--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "is_pilot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "pilot_joined_at" timestamp with time zone;