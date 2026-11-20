#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// No connection strings are accepted: every SQL command targets this disposable
// cluster's private Unix socket, with TCP disabled and inherited PG settings removed.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
const config = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8', env });
const bin = process.env.PG_BIN || (config.status === 0 ? config.stdout.trim() : '');
if (!bin) {
  console.error('PostgreSQL server tools are required. Install PostgreSQL or set PG_BIN to its bin directory.');
  process.exit(1);
}
try {
  for (const tool of ['initdb', 'pg_ctl', 'psql']) accessSync(join(bin, tool), constants.X_OK);
} catch (error) {
  console.error(`PostgreSQL server tools not found in ${bin}: ${error.message}`);
  process.exit(1);
}
if (process.getuid?.() === 0) {
  console.error('Run database tests as a non-root user; PostgreSQL refuses root-owned clusters.');
  process.exit(1);
}

// macOS's usual tmpdir is too long for a PostgreSQL Unix socket path.
const temp = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'beanlog-pg-'));
const data = join(temp, 'data');
const log = join(temp, 'postgres.log');
let startAttempted = false;
let cleaned = false;

function run(tool, args, input) {
  const result = spawnSync(join(bin, tool), args, {
    env, input, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${tool} failed: ${result.error?.message || result.status}\n${result.stdout || ''}${result.stderr || ''}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function sql(source) {
  return run('psql', ['-X', '-w', '-h', temp, '-p', '55432', '-U', 'beanlog_test', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q'], source);
}

function apply(path) {
  const output = sql(readFileSync(join(root, path), 'utf8'));
  for (const line of output.split('\n')) {
    if (/WARNING:|PASS:/.test(line)) console.log(line);
  }
}

function cleanup() {
  if (cleaned) return;
  if (startAttempted && existsSync(join(data, 'postmaster.pid'))) {
    run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '30', 'stop']);
  }
  rmSync(temp, { recursive: true, force: true });
  cleaned = true;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    try { cleanup(); } catch (error) { console.error(error.message); }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

try {
  run('initdb', ['-D', data, '--username=beanlog_test', '--auth-local=trust', '--auth-host=reject',
    '--no-locale', '--encoding=UTF8']);
  startAttempted = true;
  run('pg_ctl', ['-D', data, '-l', log, '-w', '-t', '30', '-o',
    `-F -k ${temp} -p 55432 -c listen_addresses='' -c unix_socket_permissions=0700`, 'start']);
  console.log('Testing only a disposable PostgreSQL cluster (no TCP listener).');
  apply('supabase/tests/bootstrap.sql');
  apply('supabase/schema.sql');
  apply('supabase/tests/database_regression.sql');
  apply('supabase/tests/legacy_fixture.sql');
  apply('supabase/patch_2026-02-12_auth_rls.sql');
  apply('supabase/tests/legacy_regression.sql');
  // Reintroduce the historical permissions to test the new migration separately.
  apply('supabase/tests/legacy_fixture.sql');
  apply('supabase/tests/upgrade_fixture.sql');
  for (let pass = 1; pass <= 2; pass += 1) {
    apply('supabase/patch_2026-09-14_atomic_save_and_ownership.sql');
    apply('supabase/tests/legacy_regression.sql');
    apply('supabase/tests/upgrade_regression.sql');
    apply('supabase/tests/database_regression.sql');
    console.log(`PASS: dated migration and database regressions, pass ${pass}`);
  }
  // Fresh-schema definitions must remain equivalent after a repeat installation.
  apply('supabase/schema.sql');
  apply('supabase/tests/legacy_regression.sql');
  apply('supabase/tests/database_regression.sql');
  console.log('PASS: repeated schema installation');
  apply('supabase/tests/beverage_upgrade_fixture.sql');
  apply('supabase/patch_2026-09-14_atomic_save_and_ownership.sql');
  for (let pass = 1; pass <= 2; pass += 1) {
    apply('supabase/patch_2026-11-20_beverage_categories.sql');
    apply('supabase/tests/beverage_regression.sql');
  }
} catch (error) {
  console.error(error.message);
  if (existsSync(log)) console.error(readFileSync(log, 'utf8').split('\n').slice(-25).join('\n'));
  process.exitCode = 1;
} finally {
  try {
    cleanup();
    console.log('Stopped PostgreSQL and removed the temporary cluster.');
  } catch (error) {
    console.error(`Cleanup failed; retained ${temp}: ${error.message}`);
    process.exitCode = 1;
  }
}
