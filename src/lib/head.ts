import { useEffect } from "react";

export const SITE_BASE = "https://off.testingver.workers.dev";
export const SITE_NAME = "OFF — Open Freedom Forum";

export type JsonLdBlock = { id: string; value: unknown };

type HeadArgs = {
  title: string;
  description?: string;
  path: string;
  jsonLd?: JsonLdBlock[];
};

function setMeta(
  attribute: "name" | "property",
  key: string,
  content: string,
) {
  const selfSelector = `meta[${attribute}="${key}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selfSelector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attribute, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export function absoluteUrl(path: string): string {
  return `${SITE_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Per-view document metadata: title, description, canonical URL, Open Graph
 * and JSON-LD structured data. Mutates <head> in place so a static <title>,
 * canonical and OG tags keep working for the home route.
 */
export function useHead({ title, description, path, jsonLd }: HeadArgs) {
  useEffect(() => {
    const url = absoluteUrl(path);
    document.title = title;
    if (description) {
      setMeta("name", "description", description);
      setMeta("property", "og:description", description);
      setMeta("name", "twitter:description", description);
    }
    setMeta("property", "og:title", title);
    setMeta("name", "twitter:title", title);
    setMeta("property", "og:url", url);
    setCanonical(url);

    document.head.querySelectorAll("script[data-ld]").forEach((node) => node.remove());
    for (const block of jsonLd ?? []) {
      const el = document.createElement("script");
      el.type = "application/ld+json";
      el.dataset.ld = block.id;
      el.textContent = JSON.stringify(block.value);
      document.head.appendChild(el);
    }
  }, [title, description, path, JSON.stringify(jsonLd ?? [])]);
}