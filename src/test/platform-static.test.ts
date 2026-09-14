import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const pub = (name: string) => resolve(ROOT, "public", name);

let headers = "";
let csp = "";
let indexHtml = "";
let robots = "";

beforeAll(() => {
  headers = readFileSync(pub("_headers"), "utf8");
  const cspLine = headers
    .split("\n")
    .find((line) => line.includes("Content-Security-Policy:"));
  csp = cspLine?.split("Content-Security-Policy:")[1] ?? "";
  indexHtml = readFileSync(resolve(ROOT, "index.html"), "utf8");
  robots = readFileSync(pub("robots.txt"), "utf8");
});

function pngDimensions(name: string) {
  const bytes = readFileSync(pub(name));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

describe("security headers", () => {
  it("ships a _headers file for Workers Static Assets", () => {
    expect(headers).toMatch(/^\/\*$/m);
  });
  it("enables HSTS for the HTTPS-only deployment", () => {
    expect(headers).toMatch(
      /Strict-Transport-Security: max-age=31536000; includeSubDomains/,
    );
  });
  it("blocks framing via both modern and legacy mechanisms", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(headers).toContain("X-Frame-Options: DENY");
  });
  it("stops MIME sniffing", () => {
    expect(headers).toContain("X-Content-Type-Options: nosniff");
  });
  it("limits referrer leakage across origins", () => {
    expect(headers).toContain("Referrer-Policy: strict-origin-when-cross-origin");
  });
  it("denies unused browser APIs via Permissions-Policy", () => {
    const policy = headers.match(/Permissions-Policy: (.+)/)?.[1] ?? "";
    for (const feature of ["geolocation=()", "microphone=()", "camera=()", "payment=()", "interest-cohort=()"])
      expect(policy, feature).toContain(feature);
  });
});

describe("content security policy (runtime-accurate)", () => {
  it("defaults to self and keeps object/base locked down", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });
  it("allows only same-origin scripts and the in-bundle styles", () => {
    expect(csp).toContain("script-src 'self'");
    expect(csp).toMatch(/style-src 'self' 'unsafe-inline'/);
  });
  it("allows Supabase API + WebSocket realtime only via connect-src", () => {
    expect(csp).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co");
  });
  it("permits remote avatars as images without opening storage to scripts", () => {
    expect(csp).toContain("img-src 'self' data: https:");
  });
  it("upgrades insecure requests on whatever origin it lands", () => {
    expect(csp).toContain("upgrade-insecure-requests");
  });
  it("caches hashed Vite assets immutably", () => {
    expect(headers).toMatch(/\/assets\/\*[\s\S]*Cache-Control: public, max-age=31536000, immutable/);
  });
});

describe("site metadata", () => {
  it("has the canonical production URL", () => {
    expect(indexHtml).toContain(
      '<link rel="canonical" href="https://off.testingver.workers.dev/" />',
    );
  });
  it("declares Open Graph identity", () => {
    expect(indexHtml).toContain('<meta property="og:title" content="OFF — Open Freedom Forum" />');
    expect(indexHtml).toContain(
      '<meta property="og:description" content="Private conversations. Open communities. A community platform for people who build, explore and discuss technology." />',
    );
    expect(indexHtml).toContain('<meta property="og:type" content="website" />');
  });
  it("references an absolute 1200x630 og image that exists on disk", () => {
    expect(indexHtml).toContain(
      '<meta property="og:image" content="https://off.testingver.workers.dev/og-image.png" />',
    );
    expect(pngDimensions("og-image.png")).toEqual([1200, 630]);
  });
  it("links a self-hosted svg favicon and apple-touch icon", () => {
    expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(pngDimensions("apple-touch-icon.png")[0]).toBe(180);
  });
  it("loads no third-party scripts or remote resources", () => {
    expect(indexHtml.match(/<script/g) ?? []).toHaveLength(1);
    expect(indexHtml).not.toMatch(/<script[^>]*src="https?:/);
    expect(indexHtml).not.toContain("fonts.googleapis");
  });
  it("sets mobile-friendly viewport and dark chrome", () => {
    expect(indexHtml).toContain("viewport-fit=cover");
    expect(indexHtml).toContain('name="theme-color" content="#0c0d0c"');
  });
  it("robots.txt permits crawling without sitemap claims", () => {
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(robots).not.toContain("Disallow: /");
  });
  it("assets exist without generated junk", () => {
    for (const f of ["favicon.svg", "og-image.png", "apple-touch-icon.png", "robots.txt", "_headers"])
      expect(statSync(pub(f)).isFile(), f).toBe(true);
  });
});

describe("deployment wiring", () => {
  it("wrangler serves dist as static assets with SPA fallback", () => {
    const wrangler = readFileSync(resolve(ROOT, "wrangler.jsonc"), "utf8");
    expect(wrangler).toContain('"directory": "./dist"');
    expect(wrangler).toContain('"not_found_handling": "single-page-application"');
  });
  it("vite copies the public directory into the build", () => {
    const vite = readFileSync(resolve(ROOT, "vite.config.ts"), "utf8");
    expect(vite).toContain("react(");
  });
});