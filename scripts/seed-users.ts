import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { users } from "../drizzle/schema";

/**
 * Seeds team members with email + bcrypt-hashed passwords.
 *
 * Credentials are NEVER committed. Provide them one of two ways:
 *   1. SEED_USERS env var — a JSON array (handy on Railway):
 *        SEED_USERS='[{"name":"Jane","email":"jane@co.com","role":"admin","password":"..."}]'
 *   2. A gitignored seed-users.json file at the repo root
 *      (copy seed-users.example.json and fill it in).
 *
 * Run with: pnpm db:seed
 * Idempotent — re-running updates existing users (matched by email) rather
 * than creating duplicates, so it is also how you rotate passwords or change
 * roles. Remove a user from the source list and they simply stop being seeded
 * (delete them in the app/DB to revoke access).
 */

type SeedUser = {
  name: string;
  email: string;
  phone?: string;
  role?: "user" | "admin";
  password: string;
};

function loadSeedUsers(): SeedUser[] {
  const raw = process.env.SEED_USERS?.trim();
  let source: unknown;

  if (raw) {
    source = JSON.parse(raw);
  } else {
    const filePath = path.resolve(process.cwd(), "seed-users.json");
    if (!existsSync(filePath)) {
      throw new Error(
        "No seed users found. Set the SEED_USERS env var or create seed-users.json " +
          "(copy seed-users.example.json).",
      );
    }
    source = JSON.parse(readFileSync(filePath, "utf-8"));
  }

  if (!Array.isArray(source) || source.length === 0) {
    throw new Error("Seed users must be a non-empty JSON array.");
  }

  return source.map((entry, i) => {
    const u = entry as Partial<SeedUser>;
    if (!u.email || !u.password || !u.name) {
      throw new Error(`Seed user at index ${i} is missing name, email, or password.`);
    }
    if (u.role && u.role !== "user" && u.role !== "admin") {
      throw new Error(`Seed user ${u.email} has invalid role "${u.role}".`);
    }
    return {
      name: u.name,
      email: u.email.trim(),
      phone: u.phone?.trim() || undefined,
      role: u.role ?? "user",
      password: u.password,
    };
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — seeding requires a database connection.");
  }

  const db = await getDb();
  if (!db) {
    throw new Error("Could not connect to the database (check DATABASE_URL).");
  }

  const seedUsers = loadSeedUsers();
  let created = 0;
  let updated = 0;

  for (const u of seedUsers) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, u.email))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(users)
        .set({
          name: u.name,
          role: u.role,
          passwordHash,
          loginMethod: "password",
          ...(u.phone ? { phone: u.phone } : {}),
        })
        .where(eq(users.email, u.email));
      updated++;
      console.log(`updated  ${u.email} (${u.role})`);
    } else {
      await db.insert(users).values({
        openId: `custom_${u.email}`,
        name: u.name,
        email: u.email,
        phone: u.phone ?? null,
        role: u.role,
        passwordHash,
        loginMethod: "password",
        lastSignedIn: new Date(),
      });
      created++;
      console.log(`created  ${u.email} (${u.role})`);
    }
  }

  console.log(`\nDone. ${created} created, ${updated} updated.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seeding failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
