ALTER TABLE "otp_codes" ADD COLUMN "client_key" varchar(64);--> statement-breakpoint
CREATE INDEX "idx_otp_client_key" ON "otp_codes" USING btree ("client_key","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_otp_created_at" ON "otp_codes" USING btree ("created_at" DESC NULLS LAST);