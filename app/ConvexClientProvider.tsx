"use client";

/**
 * The Convex client for the browser.
 *
 * One client per tab, created at module scope rather than inside the component,
 * so a re-render never drops the websocket and the subscriptions riding on it.
 *
 * Mounted around the analyzer rather than the whole app: the marketing pages are
 * static and have no business opening a socket, and a missing deployment URL
 * should cost you the analyzer, not the site.
 */

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const deploymentUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

const convex = deploymentUrl ? new ConvexReactClient(deploymentUrl) : null;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  // Naming the missing variable is the whole point: without this the first
  // `useQuery` fails with something that never mentions it.
  if (!convex) return <SetupNotice />;

  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}

function SetupNotice() {
  return (
    <main className="mx-auto w-full max-w-2xl grow px-6 py-24">
      <h1 className="text-[22px] font-medium tracking-[-0.025em]">Backend not configured</h1>
      <p className="mt-4 text-[14.5px] leading-relaxed text-muted-foreground">
        The analyzer talks to a Convex deployment, and{" "}
        <code className="font-mono text-[13px] text-foreground">NEXT_PUBLIC_CONVEX_URL</code> is
        not set. Run <code className="font-mono text-[13px] text-foreground">bunx convex dev</code>{" "}
        once — it creates the deployment and writes the variable — then reload.
      </p>
      <p className="mt-4 text-[13.5px] leading-relaxed text-muted-foreground">
        The CLI needs none of this:{" "}
        <code className="font-mono text-[13px] text-foreground">npx riftcli repo .</code> researches
        locally.
      </p>
    </main>
  );
}
