#!/usr/bin/env node
/**
 * Migrate CRM data from the old Manus MySQL (source) into the Railway MySQL
 * (target), table-by-table, into Railway's CURRENT schema.
 *
 * Safe by default: runs as a DRY RUN unless you pass --execute.
 *   - Dry run  : connects to both DBs, verifies the target is empty, and
 *                reports how many rows WOULD be copied per table. No writes.
 *   - Execute  : performs the copy inside a single transaction on the target.
 *
 * Strategy (agreed in planning):
 *   - 17 tables copy with primary keys + timestamps PRESERVED.
 *   - contacts: firstName/lastName are DROPPED (not in Railway schema).
 *   - users (Option B): the target's seeded placeholder users are DELETED, then
 *     all source users are imported with ids/openIds/timestamps preserved. After
 *     this script, run `pnpm db:seed` to reattach passwords to the admins
 *     (idempotent, upserts by email) so they can log in.
 *   - SKIPPED entirely: __drizzle_migrations (Railway owns its own),
 *     lead_sessions_new (empty/abandoned), app_settings (empty).
 *
 * ── Usage (run from a machine that can reach BOTH databases) ─────────────────
 *   pnpm install   # mysql2 is already a dependency
 *
 *   # source = Manus, target = Railway
 *   MANUS_DATABASE_URL='mysql://ro_user:pass@manus-host:3306/db' \
 *   RAILWAY_DATABASE_URL='mysql://user:pass@railway-host:PORT/railway' \
 *     node scripts/migrate-manus-to-railway.mjs              # dry run
 *
 *   ... same env ... node scripts/migrate-manus-to-railway.mjs --execute
 *
 * Discrete vars also work: MANUS_DB_HOST/PORT/USER/PASSWORD/NAME and
 * RAILWAY_DB_HOST/PORT/USER/PASSWORD/NAME. RAILWAY also falls back to
 * DATABASE_URL. Add MANUS_DB_SSL=true / RAILWAY_DB_SSL=true to force TLS.
 *
 * Flags:
 *   --execute   actually write (default is dry run)
 *   --force     proceed even if a non-users target table is already non-empty
 *               (DANGEROUS: risks duplicate/colliding rows — avoid)
 */

import mysql from "mysql2/promise";

// ── Load order respects logical references (no FKs are enforced in-DB, but we
//    load parents before children so the data is coherent at every step). ──
const TABLES = [
  // users handled specially (see migrateUsers); listed here for column defs.
  { name: "tags", cols: ["id", "name", "color", "createdAt"] },
  {
    name: "contacts",
    // firstName/lastName intentionally excluded.
    cols: [
      "id", "name", "phone", "email", "company", "notes", "source",
      "criteria1", "criteria2", "criteria3", "criteria4", "criteria5",
      "status", "outcome", "timezone", "createdAt", "updatedAt",
    ],
  },
  { name: "calendars", cols: ["id", "name", "type", "ownerId", "color", "createdAt"] },
  { name: "lead_sessions", cols: ["id", "sessionId", "fileName", "tagId", "createdAt"] },
  {
    name: "leads",
    cols: [
      "id", "sessionId", "name", "phone", "company", "extraData",
      "disposition", "notes", "createdAt", "updatedAt",
    ],
    json: ["extraData"],
  },
  {
    name: "automations",
    cols: [
      "id", "name", "triggerType", "triggerTagId", "triggerCalendarId",
      "isActive", "timezone", "createdAt", "updatedAt",
    ],
  },
  {
    name: "automation_steps",
    cols: [
      "id", "automationId", "stepOrder", "stepType", "waitValue", "waitUnit",
      "waitMode", "eventType", "smsBody", "emailSubject", "emailBody", "createdAt",
    ],
  },
  { name: "contact_tags", cols: ["contactId", "tagId"] },
  { name: "user_tag_permissions", cols: ["id", "userId", "tagId", "createdAt"] },
  {
    name: "smartlists",
    cols: ["id", "userId", "name", "filterRules", "isPublic", "sharedWith", "createdAt"],
    json: ["filterRules"],
  },
  {
    name: "automation_enrollments",
    cols: [
      "id", "automationId", "contactId", "currentStep", "nextRunAt",
      "eventTimestamp", "status", "enrolledAt", "updatedAt",
    ],
  },
  {
    name: "automation_execution_logs",
    cols: [
      "id", "automationId", "enrollmentId", "contactId", "stepIndex",
      "stepType", "status", "detail", "executedAt",
    ],
  },
  {
    name: "appointments",
    cols: [
      "id", "calendarId", "contactId", "title", "startAt", "endAt", "notes",
      "status", "timezone", "createdAt", "updatedAt",
    ],
  },
  {
    name: "call_history",
    cols: [
      "id", "leadId", "sessionId", "phone", "contactName", "direction",
      "durationSeconds", "disposition", "startedAt", "createdAt",
    ],
  },
  {
    name: "sms_messages",
    cols: ["id", "phone", "direction", "body", "status", "externalId", "channel", "createdAt"],
  },
  {
    name: "email_messages",
    cols: [
      "id", "email", "direction", "subject", "body", "status", "externalId",
      "messageType", "createdAt",
    ],
  },
];

const USERS_COLS = [
  "id", "openId", "name", "email", "loginMethod", "passwordHash", "phone",
  "inviteToken", "inviteSequenceStep", "inviteCronTaskUid", "role",
  "createdAt", "updatedAt", "lastSignedIn",
];

const CHUNK = 500;

function buildConfig(label, urlVars, prefix) {
  const url = urlVars.map((v) => process.env[v]?.trim()).find(Boolean);
  const ssl =
    process.env[`${prefix}_SSL`] === "true" ? { rejectUnauthorized: false } : undefined;
  const common = {
    ssl,
    dateStrings: true, // round-trip TIMESTAMP/DATETIME as literal strings
    timezone: "Z", // interpret those literals as UTC on both ends (no shift)
    connectTimeout: 15000,
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
  };
  if (url) {
    const u = new URL(url);
    return {
      ...common,
      host: u.hostname,
      port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
    };
  }
  const host = process.env[`${prefix}_HOST`];
  const user = process.env[`${prefix}_USER`];
  const database = process.env[`${prefix}_NAME`];
  if (!host || !user || !database) {
    throw new Error(
      `Missing ${label} connection. Set one of ${urlVars.join("/")}, or ` +
        `${prefix}_HOST / ${prefix}_USER / ${prefix}_PASSWORD / ${prefix}_NAME.`,
    );
  }
  return {
    ...common,
    host,
    port: process.env[`${prefix}_PORT`] ? Number(process.env[`${prefix}_PORT`]) : 3306,
    user,
    password: process.env[`${prefix}_PASSWORD`] ?? "",
    database,
  };
}

async function count(conn, table) {
  const [[{ c }]] = await conn.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
  return Number(c);
}

function toRow(def, record) {
  return def.cols.map((col) => {
    let v = record[col];
    if (v !== null && v !== undefined && def.json?.includes(col) && typeof v === "object") {
      v = JSON.stringify(v);
    }
    return v ?? null;
  });
}

async function copyTable(src, tgt, def, execute) {
  const [rows] = await src.query(
    `SELECT ${def.cols.map((c) => `\`${c}\``).join(", ")} FROM \`${def.name}\``,
  );
  if (!execute) {
    console.log(`  ${def.name.padEnd(28)} would copy ${rows.length} rows`);
    return rows.length;
  }
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => toRow(def, r));
    if (chunk.length === 0) break;
    await tgt.query(
      `INSERT INTO \`${def.name}\` (${def.cols.map((c) => `\`${c}\``).join(", ")}) VALUES ?`,
      [chunk],
    );
    inserted += chunk.length;
  }
  console.log(`  ${def.name.padEnd(28)} copied ${inserted} rows`);
  return inserted;
}

async function migrateUsers(src, tgt, execute) {
  const [rows] = await src.query(
    `SELECT ${USERS_COLS.map((c) => `\`${c}\``).join(", ")} FROM \`users\``,
  );
  const targetExisting = await count(tgt, "users");
  if (!execute) {
    console.log(
      `  users                        would DELETE ${targetExisting} seeded target user(s), ` +
        `then import ${rows.length} source users (ids preserved)`,
    );
    const emails = rows.map((r) => r.email).filter(Boolean);
    console.log(`    source emails: ${emails.join(", ") || "(none)"}`);
    return rows.length;
  }
  await tgt.query(`DELETE FROM \`users\``);
  const def = { name: "users", cols: USERS_COLS };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => toRow(def, r));
    await tgt.query(
      `INSERT INTO \`users\` (${USERS_COLS.map((c) => `\`${c}\``).join(", ")}) VALUES ?`,
      [chunk],
    );
  }
  console.log(
    `  users                        deleted ${targetExisting}, imported ${rows.length}`,
  );
  return rows.length;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const execute = args.has("--execute");
  const force = args.has("--force");

  const srcCfg = buildConfig("source (Manus)", ["MANUS_DATABASE_URL"], "MANUS_DB");
  const tgtCfg = buildConfig(
    "target (Railway)",
    ["RAILWAY_DATABASE_URL", "DATABASE_URL"],
    "RAILWAY_DB",
  );

  if (srcCfg.host === tgtCfg.host && srcCfg.database === tgtCfg.database) {
    throw new Error("Source and target point at the same database — aborting.");
  }

  console.log(execute ? "=== EXECUTE (writing) ===" : "=== DRY RUN (no writes) ===");
  console.log(`source: ${srcCfg.user}@${srcCfg.host}:${srcCfg.port}/${srcCfg.database}`);
  console.log(`target: ${tgtCfg.user}@${tgtCfg.host}:${tgtCfg.port}/${tgtCfg.database}\n`);

  const src = await mysql.createConnection(srcCfg);
  const tgt = await mysql.createConnection(tgtCfg);

  try {
    // Safety: every target table except users must be empty.
    console.log("Checking target is empty (all tables except users)...");
    const nonEmpty = [];
    for (const def of TABLES) {
      const c = await count(tgt, def.name);
      if (c > 0) nonEmpty.push(`${def.name} (${c})`);
    }
    if (nonEmpty.length > 0) {
      const msg = `Target already has rows in: ${nonEmpty.join(", ")}.`;
      if (!force) {
        throw new Error(
          `${msg}\nRefusing to load to avoid duplicates/id collisions. ` +
            `Re-run with --force only if you are sure.`,
        );
      }
      console.warn(`WARNING: ${msg} Proceeding because --force was given.\n`);
    } else {
      console.log("OK — all non-users target tables are empty.\n");
    }

    if (execute) await tgt.beginTransaction();

    console.log(execute ? "Copying..." : "Planned copy:");
    let total = 0;
    total += await migrateUsers(src, tgt, execute);
    for (const def of TABLES) {
      total += await copyTable(src, tgt, def, execute);
    }

    if (execute) {
      await tgt.commit();
      console.log(`\nDone. Committed. ${total} rows imported across all tables.`);
      console.log(
        "NEXT STEP: run `pnpm db:seed` against Railway so the admin users " +
          "(admin@scalbl.io, henryfortunatow@gmail.com) get their passwordHash " +
          "reattached (idempotent, upserts by email).",
      );
    } else {
      console.log(
        `\nDry run complete. ${total} rows would be imported. ` +
          `Re-run with --execute to perform the migration.`,
      );
    }
  } catch (err) {
    if (execute) {
      try {
        await tgt.rollback();
        console.error("\nRolled back — no changes were committed to the target.");
      } catch {
        /* ignore rollback errors */
      }
    }
    throw err;
  } finally {
    await src.end().catch(() => {});
    await tgt.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("\nMigration failed:", err?.message ?? err);
  process.exit(1);
});
