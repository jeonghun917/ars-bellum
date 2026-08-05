import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];
const result = {
  phase: "M2-0",
  requiredFiles: 0,
  esmSyntaxPass: 0,
  vendorHashPass: 0,
  remoteImports: [],
  forbiddenReferences: [],
  rawAnimationFrameCalls: [],
  publicApis: [],
  htmlModuleScripts: []
};

function fail(message) {
  failures.push(message);
  console.error(`FAIL: ${message}`);
}

const required = [
  "m2_prototype.html",
  "m2_prototype.css",
  "m2/M2_Bootstrap.js",
  "m2/M2_Config.js",
  "m2/M2_CombatProfiles.js",
  "m2/M2_BattleSnapshot.js",
  "m2/M2_Diagnostics.js",
  "m2/M2_RendererThree.js",
  "m2/M2_BattleRuntime.js",
  "m2/fixtures/m2_technical_fixture_v1.js",
  "vendor/three/r184/three.module.min.js",
  "vendor/three/r184/three.core.min.js",
  "vendor/three/r184/LICENSE",
  "vendor/three/r184/MANIFEST.json"
];

for (const relative of required) {
  if (fs.existsSync(path.join(root, relative))) result.requiredFiles += 1;
  else fail(`required file missing: ${relative}`);
}

const moduleFiles = [];
function collectModules(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectModules(absolute);
    else if (entry.isFile() && entry.name.endsWith(".js")) moduleFiles.push(absolute);
  }
}
const m2Directory = path.join(root, "m2");
if (fs.existsSync(m2Directory)) collectModules(m2Directory);

const importPatterns = [
  /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
  /import\s*\(\s*["']([^"']+)["']\s*\)/g
];
const forbiddenTokens = ["GameClock", "ArsSimulationTime", "localStorage", "ArsSaveService", "ArsGameState"];

for (const absolute of moduleFiles.sort()) {
  const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
  const source = fs.readFileSync(absolute, "utf8");
  const syntax = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: source,
    encoding: "utf8"
  });
  if (syntax.status === 0) result.esmSyntaxPass += 1;
  else fail(`ESM syntax error: ${relative}\n${syntax.stderr || syntax.stdout}`);

  for (const pattern of importPatterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (/^(?:https?:)?\/\//i.test(specifier)) {
        result.remoteImports.push(`${relative}:${specifier}`);
        fail(`remote import forbidden: ${relative}:${specifier}`);
      }
    }
  }

  if (/requestAnimationFrame\s*\(/.test(source)) {
    result.rawAnimationFrameCalls.push(relative);
    fail(`raw requestAnimationFrame forbidden: ${relative}`);
  }

  for (const token of forbiddenTokens) {
    if (source.includes(token)) {
      result.forbiddenReferences.push(`${relative}:${token}`);
      fail(`forbidden reference: ${relative}:${token}`);
    }
  }
}

const runtimePath = path.join(root, "m2/M2_BattleRuntime.js");
const runtimeSource = fs.existsSync(runtimePath) ? fs.readFileSync(runtimePath, "utf8") : "";
if (!runtimeSource.includes("setAnimationLoop(this.#boundFrame)")) fail("animation owner start contract missing");
if (!runtimeSource.includes("setAnimationLoop(null)")) fail("animation owner dispose contract missing");
for (const absolute of moduleFiles) {
  const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
  if (!["m2/M2_BattleRuntime.js", "m2/M2_RendererThree.js"].includes(relative)) {
    const source = fs.readFileSync(absolute, "utf8");
    if (source.includes("setAnimationLoop")) fail(`animation owner duplicate: ${relative}`);
  }
}

const htmlPath = path.join(root, "m2_prototype.html");
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const tags = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script>/gi)].map((match) => match[0]);
  const scripts = tags.map((tag) => ({
    src: tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || null,
    type: tag.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || null
  }));
  result.htmlModuleScripts = scripts.map((entry) => entry.src);
  if (scripts.length !== 1 || scripts[0].src !== "m2/M2_Bootstrap.js" || scripts[0].type !== "module") {
    fail("m2_prototype.html must load exactly one M2_Bootstrap module");
  }
  for (const forbidden of ["GameClock.js", "SimTime.js", "Campaign.js", "main.js", "BattleEngine.js", "Renderer.js", "index.html"]) {
    if (html.includes(forbidden)) fail(`M2 entry forbidden runtime load: ${forbidden}`);
  }
}

const bootstrapPath = path.join(root, "m2/M2_Bootstrap.js");
if (fs.existsSync(bootstrapPath)) {
  const source = fs.readFileSync(bootstrapPath, "utf8");
  const apiNames = [...source.matchAll(/window\.(ArsM2[A-Za-z0-9_]*)\s*=/g)].map((match) => match[1]).sort();
  result.publicApis = apiNames;
  if (JSON.stringify(apiNames) !== JSON.stringify(["ArsM2Battle", "ArsM2Diagnostics"])) {
    fail(`public API mismatch: ${apiNames.join(",")}`);
  }
}

const manifestPath = path.join(root, "vendor/three/r184/MANIFEST.json");
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.release !== "r184" || manifest.packageVersion !== "0.184.0" || manifest.runtimeNetworkImport !== false) {
    fail("Three.js vendor manifest metadata mismatch");
  }
  for (const record of manifest.files || []) {
    const absolute = path.join(root, "vendor/three/r184", record.path);
    if (!fs.existsSync(absolute)) {
      fail(`vendor manifest file missing: ${record.path}`);
      continue;
    }
    const bytes = fs.readFileSync(absolute);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest !== record.sha256 || bytes.length !== record.size) fail(`vendor hash/size mismatch: ${record.path}`);
    else result.vendorHashPass += 1;
  }
}

const summary = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  ...result,
  failureCount: failures.length,
  failures
};
fs.writeFileSync(path.join(root, "m2_verification_result.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
