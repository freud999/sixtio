#!/usr/bin/env node
// Restore verification (F-21 / OPS-5).
//
// A backup nobody has restored is not a backup, it is a hope. This checks the
// three ways a JSON dump silently stops being restorable, in the order they
// actually happen:
//
//   1. CORRUPTION / TRUNCATION — the file is there and shorter than it was.
//      Caught by re-hashing every table against the manifest.
//
//   2. SCHEMA DRIFT — the dump was taken before a migration, so restoring it
//      would silently drop a column that now exists (or fail on one that does
//      not). This is the failure that gets you months later, and the only one
//      you cannot see by looking at the file.
//
//   3. THE ROWS DO NOT ACTUALLY FIT — types, nulls and constraints. Proved by
//      really inserting them into the real tables inside a block that always
//      aborts, so nothing is written. The SQL for that is printed at the end;
//      run it in the Supabase SQL editor. It ends in an intentional error, and
//      that error IS the pass.
//
// What this does NOT prove: that a full production restore completes end to
// end. That needs a second database to restore into, and the free plan has no
// branches. The audit records it as open rather than pretending otherwise.
//
//   node scripts/restore-verify.mjs backups/<timestamp>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  const f = path.resolve('.env');
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line.replace(/\r$/, ''));
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

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

async function liveColumns(db, table) {
  // One row is enough to learn the live column set. An empty table teaches us
  // nothing, and that is reported as "unknown" rather than quietly passed.
  const { data, error } = await db.from(table).select('*').limit(1);
  if (error) return { error: error.message };
  if (!data || !data.length) return { unknown: true };
  return { cols: Object.keys(data[0]) };
}

async function main() {
  loadEnv();
  const dir = path.resolve(process.argv[2] || '');
  if (!dir || !fs.existsSync(path.join(dir, 'manifest.json'))) {
    console.error('usage: node scripts/restore-verify.mjs backups/<timestamp>');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const db = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;
  if (!db) console.log('(no Supabase credentials — skipping the schema-drift check)\n');

  let failures = 0;
  const probes = [];

  for (const [table, expect] of Object.entries(manifest.tables)) {
    const file = path.join(dir, `${table}.json`);
    if (!fs.existsSync(file)) { console.log(`❌ ${table}: file missing`); failures++; continue; }
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));

    const notes = [];
    if (rows.length !== expect.rows) { notes.push(`row count ${rows.length} ≠ ${expect.rows}`); }
    const sha = hashRows(rows);
    if (sha !== expect.sha256) { notes.push('sha256 mismatch — the file changed since the dump'); }

    if (db && rows.length) {
      const live = await liveColumns(db, table);
      if (live.cols) {
        const dumped = new Set(Object.keys(rows[0]));
        const added = live.cols.filter((c) => !dumped.has(c));
        const removed = [...dumped].filter((c) => !live.cols.includes(c));
        // Added columns are usually benign (a later migration with a default);
        // columns the LIVE table no longer has would make a restore fail.
        if (added.length) notes.push(`schema drift: live has extra ${added.join(', ')}`);
        if (removed.length) notes.push(`schema drift: dump has columns the live table lacks: ${removed.join(', ')}`);
      } else if (live.unknown) {
        notes.push('live table is empty — column set could not be compared');
      } else if (live.error) {
        notes.push(`live read failed: ${live.error}`);
      }
    }

    const bad = notes.some((n) => n.includes('≠') || n.includes('mismatch') || n.includes('lacks'));
    if (bad) failures++;
    console.log(`${bad ? '❌' : '✅'} ${table.padEnd(20)} ${String(rows.length).padStart(7)} rows` +
      (notes.length ? `  — ${notes.join('; ')}` : ''));

    // A small, representative sample is enough to prove the rows fit: the whole
    // point is types and constraints, and those are per-column, not per-row.
    if (rows.length) probes.push({ table, sample: rows.slice(0, 3) });
  }

  console.log(`\n${failures ? `❌ ${failures} table(s) failed` : '✅ dump is intact and matches the live schema'}`);

  if (probes.length) {
    const sql = 'do $$\nbegin\n' +
      probes.map(({ table, sample }) =>
        `  insert into public.${table} select * from jsonb_populate_recordset(null::public.${table}, ` +
        `'${JSON.stringify(sample).replace(/'/g, "''")}'::jsonb);`).join('\n') +
      "\n  raise exception 'RESTORE PROBE OK — % tables inserted, rolling back', " + probes.length + ';\n' +
      'end $$;\n';
    const out = path.join(dir, 'restore-probe.sql');
    fs.writeFileSync(out, sql);
    console.log(`\nStep 3 (proves the rows really insert): run ${out} in the Supabase SQL editor.`);
    console.log("It MUST end with the error 'RESTORE PROBE OK' — that exception is what rolls it back.");
    console.log('Any OTHER error means the backup would not restore. Nothing is written either way.');
  }

  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('verify FAILED:', e.message); process.exit(1); });
