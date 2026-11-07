/**
 * Prints a session cookie for an existing user (development only).
 *
 *   npx tsx scripts/dev-login.ts demo.pembeli@sisasaji.test
 *   npx tsx scripts/dev-login.ts +6281300000001
 *   curl -H "cookie: $(npx tsx scripts/dev-login.ts demo.mitra@sisasaji.test)" http://localhost:3000/api/v1/auth/me
 */
import "dotenv/config";
import { eq, or } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { getDatabaseUrl } from "../src/lib/env";
import { sessionCookie } from "../tests/helpers/session";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("dev-login is disabled in production");
  const identifier = process.argv[2];
  if (!identifier) throw new Error("Usage: tsx scripts/dev-login.ts <email|phone>");
  const { db, pool } = createDb(getDatabaseUrl(), { max: 1 });
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, identifier.toLowerCase()), eq(users.phoneNumber, identifier)))
    .limit(1);
  await pool.end();
  if (!user) throw new Error(`No user with email/phone ${identifier}`);
  process.stdout.write(await sessionCookie(user.id));
}

main().catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(1);
});
