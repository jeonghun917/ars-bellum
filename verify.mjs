import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const failures = [];
const results = {
  externalScripts: 0,
  uniqueExternalScripts: 0,
  missingExternalScripts: [],
  inlineScripts: 0,
  forbiddenAbsolutePaths: []
};

function fail(message) {
  failures.push(message);
  console.error(`FAIL: ${message}`);
}

function requireFile(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`필수 파일 누락: ${relativePath}`);
  }
  return absolutePath;
}

const indexPath = requireFile('index.html');
requireFile('src/main.js');

// Every module reachable from index.html: it must exist, parse as an ES module, and every relative
// import it makes must point at a file that exists.
function listModules(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listModules(absolutePath));
    else if (entry.name.endsWith('.js')) out.push(absolutePath);
  }
  return out;
}

if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8');
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const external = scriptTags.map((m) => (m[1] ?? '').match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]).filter(Boolean);
  results.externalScripts = external.length;
  results.uniqueExternalScripts = new Set(external).size;
  results.inlineScripts = scriptTags.length - external.length;
  for (const relativePath of external) {
    if (!fs.existsSync(path.join(root, relativePath))) {
      results.missingExternalScripts.push(relativePath);
      fail(`index.html 스크립트 누락: ${relativePath}`);
    }
  }
}

results.modules = 0;
results.moduleSyntaxPass = 0;
results.unresolvedImports = [];
for (const absolutePath of fs.existsSync(path.join(root, 'src')) ? listModules(path.join(root, 'src')) : []) {
  const relativePath = path.relative(root, absolutePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  results.modules += 1;
  const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
  if (checked.status !== 0) fail(`JavaScript 문법 오류: ${relativePath}\n${checked.stderr || checked.stdout}`);
  else results.moduleSyntaxPass += 1;
  for (const match of source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    const target = path.resolve(path.dirname(absolutePath), match[1] || match[2]);
    if (!fs.existsSync(target)) {
      results.unresolvedImports.push(`${relativePath} -> ${match[1] || match[2]}`);
      fail(`가져오는 파일 없음: ${relativePath} -> ${match[1] || match[2]}`);
    }
  }
}

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!/\.(?:html|js|mjs|json|css|md|txt)$/i.test(entry.name)) continue;
  const absolutePath = path.join(root, entry.name);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const forbiddenUnix = '/' + 'mnt' + '/data';
  const forbiddenWindows = 'C:' + '\\' + 'Users' + '\\';
  if (content.includes(forbiddenUnix) || content.includes(forbiddenWindows)) {
    results.forbiddenAbsolutePaths.push(entry.name);
    fail(`세션 전용 절대 경로 포함: ${entry.name}`);
  }
}

const summary = {
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  ...results,
  failureCount: failures.length,
  failures
};

console.log(JSON.stringify(summary, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
