#!/usr/bin/env node
// Backup (F-21 / OPS-5).
//
// THE FINDING THAT MADE THIS NECESSARY, measured 2026-08-05: the Supabase
// organisation is on the FREE plan, and the free plan has no automatic backups
// and no point-in-time recovery. So the answer to "when did we last back up"
// was not "a while ago" — it was "never, and there is nothing to restore from".
// Every user, every answer, every match and every message lives in exactly one
// place, and a dropped table or a wrong `delete` ends the product.
//
// This writes a full logical dump of every public table as JSON, plus a
// manifest with a row count and a SHA-256 per table. The hashes are what make
// `restore-verify.mjs` able to prove a restore worked rather than assume it.
//
// Photos are NOT in here. They live in Storage, are ~80 KB per user, and are
// re-uploadable by the user; the database is the part that cannot be recreated.
// A photo backup is a separate job and is listed as such in the audit rather
// than silently implied by this one.
//
//   node scripts/backup.mjs [outDir]     # default: ./backups/<timestamp>
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (reads .env like the dev
// server). The dump contains real personal data — it is as sensitive as the
// database. Keep it off shared drives and out of git (.gitignore covers it).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Same order the app writes them in, so a manual partial restore of the first
// few tables still satisfies foreign keys.
const TABLES = [
  'users', 'profiles', 'answers', 'matches', 'messages',
  'ai_reports', 'analytics_events', 'referral_rewards', 'reports',
  'signup_sources', 'star_deposits', 'star_transactions',
];

const PAGE = 1000;

function loadEnv() {
  // Mirrors scripts/dev-server.js: no dependency, no surprises.
  const f = path.resolve('.env');
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      // .replace(/\r$/) matters: a CRLF .env silently appends a carriage return
      // to every value, which turns a perfectly good URL into an invalid one.
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line.replace(/\r$/, ''));
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

/** Stable hash: key order must not change the digest, or a client-library
 *  upgrade would look like data loss on the next verify. */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort()
    .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function hashRows(rows) {
  const h = crypto.createHash('sha256');
  for (const r of rows) h.update(stableStringify(r));
  return h.digest('hex');
}

async function dumpTable(db, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    // Paged, and ordered — an unordered range read can repeat or skip rows
    // between pages, which would produce a dump that looks complete and is not.
    const { data, error } = await db.from(table).select('*')
      .order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) {
      // Not every table has an `id`; fall back to an unordered read and say so.
      if (/column .*id.* does not exist/i.test(error.message)) {
        const { data: d2, error: e2 } = await db.from(table).select('*').range(from, from + PAGE - 1);
        if (e2) throw new Error(`${table}: ${e2.message}`);
        rows.push(...(d2 || []));
        if (!d2 || d2.length < PAGE) break;
        continue;
      }
      throw new Error(`${table}: ${error.message}`);
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (put them in .env)');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(process.argv[2] || path.join('backups', stamp));
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = { takenAt: new Date().toISOString(), tables: {} };
  let total = 0;
  for (const table of TABLES) {
    const rows = await dumpTable(db, table);
    fs.writeFileSync(path.join(outDir, `${table}.json`), JSON.stringify(rows, null, 0));
    manifest.tables[table] = { rows: rows.length, sha256: hashRows(rows) };
    total += rows.length;
    console.log(`${table.padEnd(20)} ${String(rows.length).padStart(7)} rows`);
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\n${total} rows -> ${outDir}`);
  // A backup nobody has restored is not a backup, it is a hope. Say so every
  // time, so the reminder cannot be forgotten the way the backup itself was.
  console.log('NOT VERIFIED YET. Run: node scripts/restore-verify.mjs ' + outDir);
}

main().catch((e) => { console.error('backup FAILED:', e.message); process.exit(1); });
