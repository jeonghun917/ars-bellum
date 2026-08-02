import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const failures = [];
const results = {
  externalScripts: 0,
  uniqueExternalScripts: 0,
  missingExternalScripts: [],
  externalSyntaxPass: 0,
  inlineScripts: 0,
  inlineSyntaxPass: 0,
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
requireFile('main.js');
requireFile('style.css');

if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8');
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const external = [];
  const inline = [];

  for (const match of scriptTags) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    const srcMatch = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) external.push(srcMatch[1]);
    else if (body.trim()) inline.push(body);
  }

  results.externalScripts = external.length;
  results.uniqueExternalScripts = new Set(external).size;
  results.inlineScripts = inline.length;

  if (results.externalScripts !== results.uniqueExternalScripts) {
    fail(`외부 스크립트 중복: total=${results.externalScripts}, unique=${results.uniqueExternalScripts}`);
  }

  for (const relativePath of external) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
      results.missingExternalScripts.push(relativePath);
      fail(`index.html 스크립트 누락: ${relativePath}`);
      continue;
    }

    const checked = spawnSync(process.execPath, ['--check', absolutePath], {
      encoding: 'utf8'
    });
    if (checked.status !== 0) {
      fail(`JavaScript 문법 오류: ${relativePath}\n${checked.stderr || checked.stdout}`);
    } else {
      results.externalSyntaxPass += 1;
    }
  }

  inline.forEach((source, index) => {
    try {
      new vm.Script(source, { filename: `index.inline.${index + 1}.js` });
      results.inlineSyntaxPass += 1;
    } catch (error) {
      fail(`인라인 JavaScript 문법 오류 #${index + 1}: ${error.message}`);
    }
  });
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
