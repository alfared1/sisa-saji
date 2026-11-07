CREATE TABLE "customer_presence" (
	"client_id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"geom" geography(Point, 4326) GENERATED ALWAYS AS ((ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography)) STORED,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" varchar(150) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"requested_role" "user_role" DEFAULT 'CUSTOMER' NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"client_id" varchar(64),
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "customer_presence" ADD CONSTRAINT "customer_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_presence_geom" ON "customer_presence" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "idx_presence_last_seen" ON "customer_presence" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_otp_identifier" ON "otp_codes" USING btree ("identifier","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_push_user" ON "push_subscriptions" USING btree ("user_id");