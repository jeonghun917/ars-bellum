// Turns the Playwright JSON report of the 3D battle checks into m2_ci_browser_verification_result.json:
// one entry per check id with PASS / FAIL / NOT_TESTED, and a reason whenever it is not PASS.
// Exit code 0 only when every check passed.
import fs from 'node:fs';

const reportPath = process.argv[2] || 'test-results/playwright.json';
const outPath = process.argv[3] || 'm2_ci_browser_verification_result.json';
const env = process.env;
const firstLine = (text) => String(text || '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 300) || 'no message';

let report = null;
let reason = null;
try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (error) { reason = `report_missing:${error.code || error.message}`; }

const checks = {};
if (report) {
  const specs = [];
  const walk = (suite) => { for (const spec of suite.specs || []) specs.push(spec); for (const child of suite.suites || []) walk(child); };
  for (const suite of report.suites || []) walk(suite);
  for (const spec of specs) {
    const id = /^\[([^\]]+)\]/.exec(spec.title)?.[1] || spec.title;
    const last = spec.tests?.[0]?.results?.at(-1);
    if (!last) { checks[id] = { status: 'NOT_TESTED', reason: 'no_result' }; continue; }
    if (last.status === 'passed') { checks[id] = { status: 'PASS' }; continue; }
    const message = firstLine(last.error?.message || last.errors?.[0]?.message);
    checks[id] = /browserType\.launch|xecutable doesn't exist/.test(message)
      ? { status: 'NOT_TESTED', reason: `browser_missing:${message}` }
      : { status: 'FAIL', reason: `${last.status}:${message}` };
  }
  if (!specs.length) reason = 'no_checks_ran';
  for (const error of report.errors || []) reason = reason || `harness_error:${firstLine(error.message)}`;
}

const statuses = Object.values(checks).map((c) => c.status);
const result = reason || !statuses.length ? 'NOT_TESTED'
  : statuses.every((s) => s === 'PASS') ? 'PASS'
    : statuses.includes('FAIL') ? 'FAIL' : 'NOT_TESTED';
const out = {
  testedHead: env.M2_TESTED_HEAD || null,
  workflowRunId: env.GITHUB_RUN_ID || null,
  workflowRunAttempt: env.GITHUB_RUN_ATTEMPT || null,
  scope: 'M2_1_03_ACTUAL_CHROME_WEBGL2',
  generatedAt: new Date().toISOString(),
  result,
  reason: result === 'PASS' ? null : reason || 'some_checks_not_passed',
  checks,
};
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${result}${out.reason ? ` (${out.reason})` : ''}: ${statuses.filter((s) => s === 'PASS').length}/${statuses.length} passed`);
for (const [id, c] of Object.entries(checks)) if (c.status !== 'PASS') console.log(`  ${c.status} ${id} (${c.reason})`);
process.exit(result === 'PASS' ? 0 : 1);
