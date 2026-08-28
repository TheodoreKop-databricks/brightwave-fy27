import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { AppDb } from './index.js';

/**
 * Runs committed SQL migrations from ./drizzle/ at app startup.
 *
 * - Safe to call on every boot: Drizzle's migrator tracks applied migrations
 *   in a meta table and is a no-op if everything is up to date.
 * - In dev, the current user is the project owner (DDL allowed).
 * - In prod, the service principal runs this on first deploy, becomes the
 *   owner of `app` schema, and can run future migrations.
 *
 * NB: the migrations folder path is computed relative to this source file so
 * it resolves both under tsx-watch (dev) and tsdown-bundled (prod).
 */
export async function runMigrations(db: AppDb): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // Dev: server/db/migrate.ts → ../../drizzle
  // Prod (bundled to dist/server.js): dist/ → ../drizzle
  const candidates = [
    resolve(here, '../../drizzle'),
    resolve(here, '../drizzle'),
  ];
  const fs = await import('node:fs');
  const migrationsFolder = candidates.find((p) => fs.existsSync(p));
  if (!migrationsFolder) {
    throw new Error(
      `No Drizzle migrations folder found. Tried: ${candidates.join(', ')}. ` +
        `Run \`npm run db:generate\` first.`,
    );
  }
  await migrate(db, { migrationsFolder });
  await applyPostMigrationDdl(db);
}

/**
 * DDL that Drizzle can't express in the schema and must run after migrate().
 * Idempotent + tolerant: on a shared DB the executing role may not own a table
 * it didn't create (e.g. the app SP vs the dev user), in which case the ALTER
 * is skipped with a warning rather than failing boot — whoever owns the table
 * (or the orchestrator's grant flow) sets it, and setting it twice is a no-op.
 */
async function applyPostMigrationDdl(db: AppDb): Promise<void> {
  // REPLICA IDENTITY FULL on app.workflow_events — required for the Build-1
  // schema-level CDF on `app` to stream full row images to UC.
  try {
    await db.execute(sql`ALTER TABLE app.workflow_events REPLICA IDENTITY FULL`);
  } catch (e) {
    console.warn(
      `[migrate] could not set REPLICA IDENTITY FULL on app.workflow_events (likely not the table owner on a shared DB) — ${(e as Error).message}`,
    );
  }
}
