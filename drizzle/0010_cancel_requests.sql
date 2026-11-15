CREATE TYPE "public"."cancel_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_request_status" "cancel_request_status";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_request_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_request_responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_request_response" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_amount_idr" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_ref" varchar(120);