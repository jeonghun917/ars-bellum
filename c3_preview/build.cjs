const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');

const ZIP_ID = '1BiIvbMpqMcAQ9yzItUy7EfRbAgv4vb6Y';
const SHA_ID = '1NS2kSjcMZM5VtZjENCpsKdmz6riSTlA5';
const DRIVE = id => `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
const work = path.resolve('.c3-r2-work');
const out = path.resolve('.vercel/output');

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: process.env });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
}
async function getRaw(url, label) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`${label}_http_${r.status}`);
  const type = String(r.headers.get('content-type') || '').toLowerCase();
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error(`${label}_empty`);
  if (type.includes('text/html') || buf.subarray(0, 32).toString('utf8').toLowerCase().includes('<!doctype html')) {
    throw new Error(`${label}_not_raw_file`);
  }
  return buf;
}
function findProjectRoot(dir) {
  const direct = path.join(dir, 'package.json');
  if (fs.existsSync(direct)) return dir;
  const children = fs.readdirSync(dir, { withFileTypes: true }).filter(x => x.isDirectory());
  for (const child of children) {
    const p = path.join(dir, child.name);
    if (fs.existsSync(path.join(p, 'package.json'))) return p;
  }
  throw new Error('r2_project_root_not_found');
}
function copyDir(src, dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

(async () => {
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  const [zipBuf, shaBuf] = await Promise.all([
    getRaw(DRIVE(ZIP_ID), 'r2_zip'),
    getRaw(DRIVE(SHA_ID), 'r2_sha_file'),
  ]);
  const match = shaBuf.toString('utf8').match(/\b[0-9a-fA-F]{64}\b/);
  if (!match) throw new Error('r2_expected_sha_missing');
  const expected = match[0].toLowerCase();
  const actual = sha256(zipBuf);
  if (actual !== expected) throw new Error(`r2_zip_sha_mismatch_${actual}`);
  if (zipBuf[0] !== 0x50 || zipBuf[1] !== 0x4b) throw new Error('r2_not_zip');

  const zipPath = path.join(work, 'r2.zip');
  fs.writeFileSync(zipPath, zipBuf);
  const extract = path.join(work, 'src');
  fs.mkdirSync(extract, { recursive: true });
  new AdmZip(zipPath).extractAllTo(extract, true);
  const root = findProjectRoot(extract);

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!pkg.scripts || !pkg.scripts['rc:preflight']) throw new Error('r2_rc_preflight_script_missing');
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], root);
  run('npm', ['run', 'rc:preflight'], root);

  const generated = path.join(root, '.vercel/output');
  if (!fs.existsSync(path.join(generated, 'config.json'))) throw new Error('r2_build_output_missing');
  copyDir(generated, out);
  const marker = path.join(out, 'static', 'app.js');
  if (!fs.existsSync(marker) || !fs.readFileSync(marker, 'utf8').includes('browser_runtime_gate')) {
    throw new Error('r2_browser_runtime_gate_marker_missing');
  }
  console.log(`C3_R2_DRIVE_TRANSPORT_PASS sha=${actual}`);
})().catch(err => { console.error(err); process.exit(1); });
