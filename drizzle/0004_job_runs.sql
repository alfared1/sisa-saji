CREATE TABLE "job_runs" (
	"name" varchar(120) PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"last_status" varchar(20),
	"last_summary" jsonb
);
