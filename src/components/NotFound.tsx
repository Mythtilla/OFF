import { useHead } from "../lib/head";
import { Link } from "../lib/Link";

export function NotFound({ path }: { path: string }) {
  useHead({
    title: "404 — Page not found · OFF",
    description: "This page doesn't exist on OFF.",
    path: "/404",
  });

  return (
    <main className="not-found">
      <header>
        <b>OFF</b>
        <span>Open Freedom Forum</span>
      </header>
      <h1>Page not found</h1>
      <p>
        No page exists at <code>{path === "/not-found" ? "this address" : path}</code>.
      </p>
      <Link className="primary" to="/">
        Back to OFF <span>→</span>
      </Link>
    </main>
  );
}