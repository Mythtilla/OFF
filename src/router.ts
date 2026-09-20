import { useEffect, useState } from "react";
import { canonicalizeUsername, usernamePattern } from "./services/auth/username";

export type Route =
  | { name: "landing" }
  | { name: "auth" }
  | { name: "onboarding" }
  | { name: "profile"; username: string }
  | { name: "notfound"; path: string };

export function parsePath(pathname: string): Route {
  const path = pathname.replace(/\/index\.html$/, "") || "/";
  if (path === "/") return { name: "landing" };
  if (path === "/auth") return { name: "auth" };
  if (path === "/onboarding") return { name: "onboarding" };
  const match = /^\/u\/([^/]+)/.exec(path);
  if (match) {
    const username = canonicalizeUsername(match[1]);
    if (usernamePattern.test(username)) return { name: "profile", username };
  }
  return { name: "notfound", path };
}

export function pathFor(route: Route): string {
  switch (route.name) {
    case "landing":
      return "/";
    case "auth":
      return "/auth";
    case "onboarding":
      return "/onboarding";
    case "profile":
      return `/u/${route.username}`;
    default:
      return "/not-found";
  }
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (window.location.pathname === path) return;
  if (opts.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parsePath(window.location.pathname));
  useEffect(() => {
    const onpop = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener("popstate", onpop);
    return () => window.removeEventListener("popstate", onpop);
  }, []);
  return route;
}