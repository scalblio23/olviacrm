#!/usr/bin/env node
/**
 * READ-ONLY introspection of the old Manus MySQL database.
 *
 * Dumps SCHEMA ONLY (no row data) plus per-table row counts, so we can diff
 * the Manus schema against Railway's current schema and write a migration plan.
 *
 * It runs only SELECT / SHOW / information_schema queries. It never writes,
 * alters, or drops anything, and it never prints your password.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 * From the repo root, after `pnpm install` (mysql2 is already a dependency):
 *
 *   MANUS_DATABASE_URL='mysql://readonly_user:pass@host:3306/dbname' \
 *     node scripts/dump-manus-schema.mjs
 *
 * or with discrete vars (preferred if the password has @ : / ? characters):
 *
 *   MANUS_DB_HOST=host MANUS_DB_PORT=3306 MANUS_DB_USER=readonly_user \
 *   MANUS_DB_PASSWORD='...' MANUS_DB_NAME=dbname \
 *     node scripts/dump-manus-schema.mjs
 *
 * Add MANUS_DB_SSL=true if the server requires TLS.
 *
 * Output: writes ./manus-schema-dump.txt (schema + row counts only — safe to
 * share/commit; contains no row data and no credentials).
 */

import { writeFileSync } from "node:fs";
import mysql from "mysql2/promise";

function buildConnectionConfig() {
  const url = process.env.MANUS_DATABASE_URL?.trim();
  const ssl =
    process.env.MANUS_DB_SSL === "true"
      ? { rejectUnauthorized: false }
      : undefined;

  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
      ssl,
    };
  }

  const { MANUS_DB_HOST, MANUS_DB_USER, MANUS_DB_PASSWORD, MANUS_DB_NAME } =
    process.env;
  if (!MANUS_DB_HOST || !MANUS_DB_USER || !MANUS_DB_NAME) {
    throw new Error(
      "Provide MANUS_DATABASE_URL, or MANUS_DB_HOST / MANUS_DB_USER / " +
        "MANUS_DB_PASSWORD / MANUS_DB_NAME.",
    );
  }
  return {
    host: MANUS_DB_HOST,
    port: process.env.MANUS_DB_PORT ? Number(process.env.MANUS_DB_PORT) : 3306,
    user: MANUS_DB_USER,
    password: MANUS_DB_PASSWORD ?? "",
    database: MANUS_DB_NAME,
    ssl,
  };
}

async function main() {
  const cfg = buildConnectionConfig();
  console.log(
    `Connecting to ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}` +
      (cfg.ssl ? " (TLS)" : "") +
      " ...",
  );

  const conn = await mysql.createConnection({
    ...cfg,
    // Defensive: read-only intent. We never issue writes regardless.
    multipleStatements: false,
    connectTimeout: 15000,
  });

  const out = [];
  const log = (line = "") => out.push(line);

  log(`-- Manus schema dump`);
  log(`-- database: ${cfg.database}`);
  log(`-- generated: ${new Date().toISOString()}`);
  log("");

  // All base tables in this database.
  const [tables] = await conn.query(
    `SELECT TABLE_NAME, TABLE_ROWS, ENGINE, TABLE_COLLATION
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`,
    [cfg.database],
  );

  log(`-- ${tables.length} table(s) found`);
  log("");

  // Exact row counts (TABLE_ROWS from information_schema is only an estimate).
  log(`=== ROW COUNTS (exact) ===`);
  const counts = {};
  for (const t of tables) {
    const name = t.TABLE_NAME;
    const [[{ c }]] = await conn.query(
      `SELECT COUNT(*) AS c FROM \`${name}\``,
    );
    counts[name] = c;
    log(`${String(c).padStart(10)}  ${name}`);
  }
  log("");

  // Full DDL per table.
  log(`=== CREATE TABLE STATEMENTS ===`);
  for (const t of tables) {
    const name = t.TABLE_NAME;
    const [[row]] = await conn.query(`SHOW CREATE TABLE \`${name}\``);
    const ddl = row["Create Table"] ?? row["Create View"] ?? "";
    log("");
    log(`-- ${name}  (${counts[name]} rows, engine=${t.ENGINE})`);
    log(`${ddl};`);
  }
  log("");

  // Structured column listing — handy for building the column mapping.
  log(`=== COLUMNS (information_schema) ===`);
  const [cols] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
            COLUMN_KEY, COLUMN_DEFAULT, EXTRA
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [cfg.database],
  );
  let currentTable = null;
  for (const col of cols) {
    if (col.TABLE_NAME !== currentTable) {
      currentTable = col.TABLE_NAME;
      log("");
      log(`# ${currentTable}`);
    }
    const flags = [
      col.IS_NULLABLE === "NO" ? "NOT NULL" : "NULL",
      col.COLUMN_KEY ? `key=${col.COLUMN_KEY}` : null,
      col.EXTRA || null,
      col.COLUMN_DEFAULT !== null ? `default=${col.COLUMN_DEFAULT}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    log(`  ${col.COLUMN_NAME}: ${col.COLUMN_TYPE}  [${flags}]`);
  }

  await conn.end();

  const text = out.join("\n");
  const file = "manus-schema-dump.txt";
  writeFileSync(file, text, "utf8");
  console.log(
    `\nDone. ${tables.length} tables introspected. Wrote ./${file}\n` +
      `This file contains schema + row counts only — no row data, no credentials.`,
  );
}

main().catch((err) => {
  console.error("\nIntrospection failed:", err?.message ?? err);
  console.error(
    "If this is a connection/timeout error, confirm the host is reachable " +
      "from this machine and the credentials are correct.",
  );
  process.exit(1);
});
