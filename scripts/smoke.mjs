import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = globalThis.process.cwd();
const PORT = 4387;
const BASE = `http://127.0.0.1:${PORT}`;
const viteBin = resolve(ROOT, "node_modules", "vite", "bin", "vite.js");

let failures = 0;
let server = null;

function pass(msg) {
  console.log(`  ok  ${msg}`);
}

function fail(msg) {
  failures += 1;
  console.error(`FAIL  ${msg}`);
}

function findChrome() {
  const candidates = [
    globalThis.process.env.CHROME_BIN,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ["--version"], { stdio: "ignore" });
    if (r.status === 0) return c;
  }
  return null;
}

async function waitForServer(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.status === 200) return true;
    } catch {
      /* not ready yet */
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
  }
  return false;
}

async function get(url) {
  return fetch(url, { signal: AbortSignal.timeout(10000) });
}

const chrome = findChrome();
if (!chrome) {
  console.log("SKIP: Chrome not found; install Chrome (or set CHROME_BIN) to run the UI smoke.");
  globalThis.process.exit(0);
}
if (!existsSync(resolve(ROOT, "dist", "index.html")) || !existsSync(viteBin)) {
  console.error("Run `npm run build` before the smoke test.");
  globalThis.process.exit(1);
}

console.log(`[smoke] starting vite preview on ${BASE} (chrome: ${chrome})`);
server = spawn(
  globalThis.process.execPath,
  [viteBin, "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
);
let serverLog = "";
server.stderr.on("data", (d) => (serverLog += String(d)));
server.stdout.on("data", (d) => (serverLog += String(d)));

if (!(await waitForServer(BASE))) {
  fail(`preview server did not come up: ${serverLog.split("\n").slice(-3).join(" | ")}`);
  server.kill();
  globalThis.process.exit(1);
}

const html = await (await get(`${BASE}/`)).text();
pass("GET / returns 200");
for (const needle of ['<div id="root">', 'rel="canonical"', 'property="og:image"', '<link rel="icon" type="image/svg+xml"']) {
  if (html.includes(needle)) pass(`index.html contains ${needle}`);
  else fail(`index.html missing ${needle}`);
}

const modules = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
if (modules.length === 0) fail("no module scripts found in index.html");
let entryOk = modules.length > 0;
let createRootSeen = false;
for (const src of modules) {
  const res = await get(`${BASE}${src}`);
  if (res.status !== 200) {
    if (src === modules[0]) entryOk = false;
  } else if ((await res.text()).includes("createRoot")) {
    createRootSeen = true;
  }
}
if (entryOk && createRootSeen) pass("app entry serves and bundles createRoot");
else fail("module bundle missing, not the app entry, or react-dom split wrong");

for (const asset of ["favicon.svg", "robots.txt", "_headers", "apple-touch-icon.png", "og-image.png"]) {
  const res = await get(`${BASE}/${asset}`);
  if (res.status === 200) pass(`serves ${asset}`);
  else fail(`missing ${asset} (HTTP ${res.status})`);
}

const ogPng = new Uint8Array(await (await get(`${BASE}/og-image.png`)).arrayBuffer());
if (ogPng[0] === 0x89 && ogPng[1] === 0x50 && ogPng[2] === 0x4e && ogPng[3] === 0x47) pass("og-image.png is a PNG");
else fail("og-image.png is not a PNG");

const dome = spawn(chrome, ["--headless", "--disable-gpu", "--no-sandbox", "--dump-dom", BASE], {
  stdio: ["ignore", "pipe", "pipe"],
});
let dom = "";
let chromeErr = "";
dome.stdout.on("data", (d) => (dom += String(d)));
dome.stderr.on("data", (d) => (chromeErr += String(d)));
await new Promise((resolveEnd) => dome.on("close", resolveEnd));

if (dom.includes("<title>OFF — Open Freedom Forum</title>")) pass("rendered title is correct");
else fail("rendered title mismatch");

const renderedMarkers = [
  "Configuration required.",
  "Talk freely.",
  "Enter OFF",
  "Continue the conversation.",
  "Loading…",
];
const seen = renderedMarkers.find((m) => dom.includes(m));
if (seen) pass(`app hydrated and rendered: "${seen}"`);
else fail("root element did not render app content");

const consoleErrors = chromeErr
  .split("\n")
  .map((line) => line.trim())
  .filter((l) => /CONSOLE|Uncaught|ReferenceError|TypeError|SyntaxError|is not defined/.test(l))
  .filter((l) => !/Uncaught \(in promise\)/u.test(l));
if (consoleErrors.length === 0) pass("no uncaught page errors in console");
else {
  fail("page console errors:");
  for (const e of consoleErrors.slice(0, 10)) console.error("    " + e);
}

server.kill();
console.log(failures === 0 ? "\n[smoke] PASS" : `\n[smoke] FAILED (${failures})`);
globalThis.process.exit(failures === 0 ? 0 : 1);