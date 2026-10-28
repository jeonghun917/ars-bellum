// Runs every check and writes test-results/results.json: one entry per id in tests/checks.json,
// each PASS, FAIL or NOT_TESTED, and always with a reason when it is not PASS.
// Exit code is 0 only when every listed check passed and no unlisted check appeared.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const outDir = path.join(root, 'test-results');
fs.mkdirSync(outDir, { recursive: true });
const { checks } = JSON.parse(fs.readFileSync(path.join(root, 'tests/checks.json'), 'utf8'));
const results = new Map();
const unlisted = [];
const stages = [];

function record(id, status, reason = null, detail = null) {
  if (!checks.some((check) => check.id === id)) { unlisted.push(id); return; }
  results.set(id, { status, ...(reason ? { reason } : {}), ...(detail ? { detail } : {}) });
}

function run(name, command, args, env = {}) {
  const started = Date.now();
  const proc = spawnSync(command, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  const stage = { name, exitCode: proc.status, signal: proc.signal, ms: Date.now() - started };
  if (proc.error) stage.error = proc.error.message;
  stages.push(stage);
  fs.writeFileSync(path.join(outDir, `${name}.log`), `${proc.stdout || ''}\n${proc.stderr || ''}`);
  return proc;
}

const firstLine = (text) => String(text || '').split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 300) || 'no output';

// 1. Main game source check (one check).
{
  const proc = run('m1-static', process.execPath, ['verify.mjs']);
  if (proc.error) record('m1.source.static', 'NOT_TESTED', `harness_error:${proc.error.message}`);
  else record('m1.source.static', proc.status === 0 ? 'PASS' : 'FAIL', proc.status === 0 ? null : firstLine(proc.stderr || proc.stdout));
}

// 2. 3D battle simulation checks (m2_verify.mjs writes one entry per legacy name).
{
  const file = path.join(outDir, 'm2-unit.json');
  fs.rmSync(file, { force: true });
  const proc = run('m2-unit', process.execPath, ['m2_verify.mjs']);
  let report = null;
  try { report = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* handled below */ }
  for (const check of checks.filter((c) => c.source === 'm2_verify.mjs')) {
    const entry = report?.checks?.[check.legacyId];
    if (!report) record(check.id, 'NOT_TESTED', `harness_error:${proc.error?.message || firstLine(proc.stderr || proc.stdout)}`);
    else if (!entry) record(check.id, 'NOT_TESTED', 'no_result');
    else record(check.id, entry.status === 'PASS' ? 'PASS' : 'FAIL', entry.status === 'PASS' ? null : 'assertion_failed', entry.detail ?? null);
  }
  const known = new Set(checks.map((c) => c.legacyId).filter(Boolean));
  for (const name of Object.keys(report?.checks || {})) if (!known.has(name)) unlisted.push(`m2_verify:${name}`);
}

// 3. Browser checks (Playwright JSON report; a test title starts with "[check.id]").
{
  const file = path.join(outDir, 'playwright.json');
  fs.rmSync(file, { force: true });
  const proc = run('browser', process.execPath, ['node_modules/@playwright/test/cli.js', 'test']);
  let report = null;
  try { report = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* handled below */ }
  const browserChecks = checks.filter((c) => c.kind === 'browser');
  if (!report) {
    const output = `${proc.stdout || ''}\n${proc.stderr || ''}`;
    const reason = /Executable doesn't exist|browserType\.launch/.test(output) ? 'browser_missing'
      : /webServer|Timed out waiting .* from config\.webServer/.test(output) ? 'page_server_failed'
        : `harness_error:${proc.error?.message || firstLine(proc.stderr || proc.stdout)}`;
    for (const check of browserChecks) record(check.id, 'NOT_TESTED', reason);
  } else {
    const specs = [];
    const walk = (suite) => { for (const spec of suite.specs || []) specs.push(spec); for (const child of suite.suites || []) walk(child); };
    for (const suite of report.suites || []) walk(suite);
    for (const spec of specs) {
      const id = /^\[([^\]]+)\]/.exec(spec.title)?.[1];
      if (!id) { unlisted.push(`untagged:${spec.title}`); continue; }
      const last = spec.tests?.[0]?.results?.at(-1);
      if (!last) { record(id, 'NOT_TESTED', 'no_result'); continue; }
      if (last.status === 'passed') record(id, 'PASS');
      else if (last.status === 'skipped') record(id, 'NOT_TESTED', 'skipped');
      else {
        const message = firstLine((last.error?.message || last.errors?.[0]?.message || '').replace(/\u001b\[[0-9;]*m/g, ''));
        // The test never reached the game when the browser could not start: that is not a game failure.
        if (/browserType\.launch|Executable doesn't exist|executable doesn't exist/.test(message)) record(id, 'NOT_TESTED', `browser_missing:${message}`);
        else record(id, 'FAIL', last.status === 'timedOut' ? `timeout:${message}` : `assertion_failed:${message}`);
      }
    }
    for (const error of report.errors || []) stages.at(-1).reportError = firstLine(error.message);
  }
}

// Every listed check gets an entry; a missing one is NOT_TESTED with a reason, never silently absent.
for (const check of checks) if (!results.has(check.id)) record(check.id, 'NOT_TESTED', 'no_result');

const git = (args) => { const p = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); return p.status === 0 ? p.stdout.trim() : null; };
const entries = checks.map((check) => ({ id: check.id, title: check.title, ...results.get(check.id) }));
const count = (status) => entries.filter((entry) => entry.status === status).length;
const summary = { total: entries.length, pass: count('PASS'), fail: count('FAIL'), notTested: count('NOT_TESTED'), unlisted: unlisted.length };
const overall = summary.pass === summary.total && unlisted.length === 0 ? 'PASS' : 'FAIL';
const payload = {
  format: 'ars-bellum-results/v1',
  overall,
  summary,
  sourceHead: git(['rev-parse', 'HEAD']),
  sourceTree: git(['rev-parse', 'HEAD^{tree}']),
  workingTreeClean: git(['status', '--porcelain']) === '',
  generatedAt: new Date().toISOString(),
  node: process.version,
  stages,
  unlisted,
  checks: entries,
};
fs.writeFileSync(path.join(outDir, 'results.json'), `${JSON.stringify(payload, null, 2)}\n`);

for (const entry of entries) if (entry.status !== 'PASS') console.log(`${entry.status.padEnd(10)} ${entry.id}  (${entry.reason})`);
for (const id of unlisted) console.log(`UNLISTED   ${id}`);
console.log(`${overall}: ${summary.pass}/${summary.total} passed, ${summary.fail} failed, ${summary.notTested} not tested, ${summary.unlisted} unlisted`);
process.exit(overall === 'PASS' ? 0 : 1);
