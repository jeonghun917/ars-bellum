// Measures the 3D battle in a browser at scale (M2_SPEC section 11.2): 100 against 100, three scenarios, three
// runs each, recording frame times (average FPS, median, p95 and p99), draw calls, triangles, the JS heap and
// fixed ticks dropped. Nothing passes or fails here: the numbers are written out as they are, with the browser
// and its graphics (a machine without a GPU draws with SwiftShader, in software, far slower than a phone's
// GPU: such numbers show where the cost is, not what a player will see).
//
//   node tools/m2_scale_render.mjs [--per-side 100] [--runs 3] [--seconds 60] [--out test-results/m2-scale-render.json]
//
// Scenarios:
//   approach  the third-person camera behind the player while both sides close and meet;
//   overview  the tactical camera over the whole field while they fight;
//   rout      as approach, and each side's second line (about a third of it) ordered to retreat once they
//             meet: routing men and bolts together.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => (value.startsWith("--") ? [...pairs, [value.slice(2), all[i + 1]]] : pairs), []));
const PER_SIDE = Number(args["per-side"] ?? 100);
const RUNS = Number(args.runs ?? 3);
const SECONDS = Number(args.seconds ?? 60);
const OUT = args.out ?? "test-results/m2-scale-render.json";
const PORT = Number(process.env.PORT || 4188);
const SCENARIOS = ["approach", "overview", "rout"];

const server = spawn(process.execPath, ["tests/support/static-server.mjs", "."], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await new Promise((resolve) => setTimeout(resolve, 800));
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-precise-memory-info"]
});
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

async function run(scenario) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${PORT}/m2_prototype.html`);
  await page.waitForFunction(() => window.ArsM2Diagnostics?.getSnapshot().fixedTickCount > 0, null, { timeout: 120_000 });
  const graphics = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  // The large battle, both sides sent in.
  const loaded = await page.evaluate(async ({ perSide, scenario }) => {
    const { buildScaleSnapshot } = await import("/m2/fixtures/m2_scale_fixture.js");
    const receipt = window.ArsM2Battle.loadSnapshot(buildScaleSnapshot({ perSide }));
    if (!receipt.ok) return receipt;
    window.ArsM2Battle.start();
    const s = window.ArsM2Battle.getSnapshot();
    for (const f of s.formations.filter((x) => x.sideId === "ally")) {
      window.ArsM2Battle.issueCommand({ commandId: `go_${f.formationId}`, type: "formation_attack", formationId: f.formationId, targetFormationId: f.formationId.replace("ally", "enemy") });
    }
    if (scenario === "overview") document.getElementById("m2Tactical")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    // Frame times, from a frame counter of the measuring page's own (the battle keeps its one loop).
    window.__frames = [];
    let last = performance.now();
    const count = (now) => { window.__frames.push(now - last); last = now; window.__frameLoop = requestAnimationFrame(count); };
    window.__frameLoop = requestAnimationFrame(count);
    return { ok: true };
  }, { perSide: PER_SIDE, scenario });
  if (!loaded.ok) throw new Error(JSON.stringify(loaded));
  const samples = [];
  let broken = false;
  const started = Date.now();
  while (Date.now() - started < SECONDS * 1000) {
    await page.waitForTimeout(1000);
    const sample = await page.evaluate(() => {
      const d = window.ArsM2Diagnostics.getSnapshot();
      return { drawCalls: d.drawCalls, triangles: d.triangles, droppedTicks: d.droppedTicks, fixedTickCount: d.fixedTickCount, attacks: d.projectileLaunchCount, heapMb: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null };
    });
    samples.push(sample);
    if (scenario === "rout" && !broken && sample.fixedTickCount > 200) {
      broken = true;
      // About a third of each side runs (its second line ordered to retreat): routing men and bolts together.
      await page.evaluate(() => {
        for (const id of ["ally_line_2", "enemy_line_2"]) window.ArsM2Battle.issueCommand({ commandId: `run_${id}`, type: "formation_retreat", formationId: id });
      });
    }
  }
  const frames = await page.evaluate(() => { cancelAnimationFrame(window.__frameLoop); return window.__frames.slice(5); });
  await page.close();
  const sorted = [...frames].sort((a, b) => a - b);
  const mean = frames.reduce((s, x) => s + x, 0) / Math.max(1, frames.length);
  const last = samples.at(-1) || {};
  return {
    graphics,
    frames: frames.length,
    averageFps: +(1000 / mean).toFixed(1),
    medianFrameMs: +quantile(sorted, 0.5).toFixed(1),
    p95FrameMs: +quantile(sorted, 0.95).toFixed(1),
    p99FrameMs: +quantile(sorted, 0.99).toFixed(1),
    maxDrawCalls: Math.max(...samples.map((s) => s.drawCalls || 0)),
    maxTriangles: Math.max(...samples.map((s) => s.triangles || 0)),
    peakHeapMb: samples.some((s) => s.heapMb !== null) ? +Math.max(...samples.map((s) => s.heapMb || 0)).toFixed(1) : "NOT_AVAILABLE",
    droppedTicks: last.droppedTicks ?? null,
    fixedTicks: last.fixedTickCount ?? null,
    pageErrors: errors,
  };
}

const report = { format: "ars-bellum-m2-scale-render/v1", perSide: PER_SIDE, runs: RUNS, secondsEach: SECONDS, browser: browser.version(), scenarios: {} };
try {
  for (const scenario of SCENARIOS) {
    report.scenarios[scenario] = [];
    for (let r = 0; r < RUNS; r += 1) {
      const result = await run(scenario);
      report.scenarios[scenario].push(result);
      console.log(`${scenario.padEnd(8)} run ${r + 1}: ${result.averageFps} fps (median ${result.medianFrameMs} ms, p95 ${result.p95FrameMs}, p99 ${result.p99FrameMs}), draw calls <= ${result.maxDrawCalls}, triangles <= ${result.maxTriangles}, heap <= ${result.peakHeapMb} MB, dropped ticks ${result.droppedTicks} [${result.graphics}]`);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
