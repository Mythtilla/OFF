import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotFound } from "../components/NotFound";
import { absoluteUrl } from "../lib/head";
import { parsePath, pathFor, type Route } from "../router";

const root = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

describe("router paths", () => {
  it("maps the known surface to routes", () => {
    expect(parsePath("/")).toEqual({ name: "landing" });
    expect(parsePath("/index.html")).toEqual({ name: "landing" });
    expect(parsePath("/auth")).toEqual({ name: "auth" });
    expect(parsePath("/onboarding")).toEqual({ name: "onboarding" });
  });
  it("parses profile slugs and canonicalizes the username", () => {
    expect(parsePath("/u/Alex_")).toEqual({ name: "profile", username: "alex_" });
    expect(parsePath("/u/alex")).toEqual({ name: "profile", username: "alex" });
  });
  it("rejects invalid or unknown paths with a notfound route", () => {
    expect(parsePath("/nope")).toEqual({ name: "notfound", path: "/nope" });
    expect(parsePath("/u/ab")).toEqual({ name: "notfound", path: "/u/ab" });
    expect(parsePath(`/u/${"v".repeat(33)}`)).toEqual({
      name: "notfound",
      path: `/u/${"v".repeat(33)}`,
    });
  });
  it("round-trips via pathFor", () => {
    const route: Route = { name: "profile", username: "alex" };
    expect(pathFor(route)).toBe("/u/alex");
    expect(pathFor(parsePath(pathFor(route)))).toBe(pathFor(route));
  });
});

describe("page head", () => {
  it("builds absolute URLs from the canonical origin", () => {
    expect(absoluteUrl("/")).toBe("https://off.testingver.workers.dev/");
    expect(absoluteUrl("/u/alex")).toBe("https://off.testingver.workers.dev/u/alex");
  });

  it("index.html carries robots, og image alt and canonical static metadata", () => {
    const html = root("index.html");
    expect(html).toContain('rel="canonical" href="https://off.testingver.workers.dev/"');
    expect(html).toContain('property="og:image" content="https://off.testingver.workers.dev/og-image.png"');
    expect(html).toContain('property="og:image:alt" content="OFF — Open Freedom Forum"');
    expect(html).toContain('name="robots" content="index, follow, max-image-preview:large"');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(html).toContain('<meta name="theme-color" content="#0c0d0c" />');
    expect(html).toContain("<title>OFF — Open Freedom Forum</title>");
  });
});

describe("crawler surface", () => {
  it("robots.txt references the sitemap and blocks non-indexable surface", () => {
    const robots = root("public/robots.txt");
    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Disallow: /auth");
    expect(robots).toContain("Disallow: /u/");
    expect(robots).toContain("Sitemap: https://off.testingver.workers.dev/sitemap.xml");
  });
  it("sitemap.xml is well-formed with the home location", () => {
    const sitemap = root("public/sitemap.xml");
    expect(sitemap).toContain("<urlset ");
    expect(sitemap).toContain("https://off.testingver.workers.dev/</loc>");
    expect(sitemap).not.toContain("/auth");
  });
  it("llms.txt is a truthful, secret-free index", () => {
    const llms = root("public/llms.txt");
    for (const token of ["off", "pseudonym", "no ads", "cloudflare workers"]) {
      expect(llms.toLowerCase()).toContain(token);
    }
    expect(llms.toLowerCase()).not.toContain("sk-");
    expect(llms.toLowerCase()).not.toContain("password");
  });
});

describe("NotFound page", () => {
  it("renders exactly one heading, the diagnostic path and an internal link", () => {
    const html = renderToStaticMarkup(<NotFound path="/nope" />);
    const headings = html.match(/<h1/g) ?? [];
    expect(headings).toHaveLength(1);
    expect(html).toContain("Page not found");
    expect(html).toContain("/nope");
    expect(html).toContain('href="/"');
  });
});