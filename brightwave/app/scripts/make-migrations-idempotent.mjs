#!/usr/bin/env node
/**
 * Post-process drizzle-kit's generated SQL to be IDEMPOTENT.
 *
 * Why: this app's Lakebase already has the `app` schema pre-provisioned (Build 1),
 * and drizzle/ is a gitignored build artifact regenerated from scratch on every
 * build (no committed meta snapshot) — so `generate` always emits a single 0000
 * migration containing `CREATE SCHEMA "app"` + `CREATE TABLE "app".*`. Against a
 * DB where those already exist (or when the __drizzle_migrations journal doesn't
 * line up after a fresh regeneration), a plain `CREATE` throws "already exists"
 * and runMigrations() fails the whole boot.
 *
 * Rewriting every CREATE to `CREATE ... IF NOT EXISTS` makes runMigrations a safe
 * no-op when objects exist and a correct create when they don't (e.g. a brand-new
 * table like app.workflow_events). Non-destructive and regeneration-proof.
 *
 * Runs as the second half of `npm run db:generate` (see package.json), so it is
 * applied on every path — local dev, smoke test, and the deployed container build.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../drizzle');

/** Apply `IF NOT EXISTS` after a DDL keyword only when not already present. */
const rules = [
  [/CREATE SCHEMA (?!IF NOT EXISTS)"/g, 'CREATE SCHEMA IF NOT EXISTS "'],
  [/CREATE TABLE (?!IF NOT EXISTS)"/g, 'CREATE TABLE IF NOT EXISTS "'],
  [/CREATE UNIQUE INDEX (?!IF NOT EXISTS)"/g, 'CREATE UNIQUE INDEX IF NOT EXISTS "'],
  [/CREATE INDEX (?!IF NOT EXISTS)"/g, 'CREATE INDEX IF NOT EXISTS "'],
];

let files;
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
} catch {
  console.log('[idempotent-migrations] no drizzle/ dir — nothing to do');
  process.exit(0);
}

let changed = 0;
for (const f of files) {
  const p = resolve(dir, f);
  const before = readFileSync(p, 'utf8');
  let after = before;
  for (const [re, to] of rules) after = after.replace(re, to);
  if (after !== before) {
    writeFileSync(p, after);
    changed++;
  }
}
console.log(`[idempotent-migrations] processed ${files.length} file(s), rewrote ${changed}`);
