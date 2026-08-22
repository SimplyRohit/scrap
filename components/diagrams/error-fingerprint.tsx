"use client";

import * as React from "react";

import { useInView } from "@/hooks/use-in-view";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { ERROR_FRAMES, ERROR_RESULT } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

/** strip application frames → fingerprint → match the index. */
const STEPS = [
  { at: 900, label: "Stripping application frames" },
  { at: 2000, label: "Fingerprinting" },
  { at: 3100, label: "Matching the index" },
];

const LOOP_MS = 6200;

export function ErrorFingerprint() {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.35 });
  const reduced = useReducedMotion();

  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    if (!inView) return;

    if (reduced) {
      const settled = setTimeout(() => setStep(STEPS.length), 0);

      return () => clearTimeout(settled);
    }

    let timers: ReturnType<typeof setTimeout>[] = [];

    const run = () => {
      timers.forEach(clearTimeout);
      timers = [
        setTimeout(() => setStep(0), 0),
        ...STEPS.map((s, i) => setTimeout(() => setStep(i + 1), s.at)),
      ];
    };

    const first = setTimeout(run, 0);
    const loop = setInterval(run, LOOP_MS);

    return () => {
      clearTimeout(first);
      clearInterval(loop);
      timers.forEach(clearTimeout);
    };
  }, [inView, reduced]);

  return (
    <div ref={ref} className="overflow-hidden border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border bg-paper/60 px-5 py-3">
        <span className="font-mono text-[11.5px] text-foreground">stderr</span>
        <span
          className={cn(
            "label transition-colors duration-300",
            step > 0 && step < 4 ? "text-foreground" : "text-foreground/35",
          )}
        >
          {step === 0 ? "received" : (STEPS[Math.min(step, STEPS.length) - 1]?.label ?? "matched")}
        </span>
      </div>

      <div className="space-y-1 px-5 py-4">
        {ERROR_FRAMES.map((frame, i) => {
          const stripped = step >= 1 && frame.kind === "app";

          return (
            <p
              key={frame.text}
              className={cn(
                "font-mono text-[11.5px] leading-[1.75] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                frame.kind === "head" ? "text-critical" : "text-muted-foreground",
                frame.kind !== "head" && "pl-4",
                stripped && "text-foreground/35 line-through opacity-45",
              )}
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              {frame.text}
            </p>
          );
        })}
      </div>

      <div className="border-t border-border px-5 py-4">
        <div
          className={cn(
            "flex flex-wrap items-center gap-3 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
            step >= 2 ? "translate-y-0 opacity-100" : "translate-y-1.5 opacity-0",
          )}
        >
          <span className="label text-muted-foreground">
            fingerprint
          </span>
          <code className="border border-border bg-paper px-2 py-1 font-mono text-[11.5px] text-foreground">
            {ERROR_RESULT.fingerprint}
          </code>
        </div>

        <div
          className={cn(
            "mt-4 transition-all duration-600 ease-[cubic-bezier(0.22,1,0.36,1)]",
            step >= 3 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
          )}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="label text-muted-foreground">
              matched
            </span>
            <span className="font-mono text-[11.5px] text-foreground">{ERROR_RESULT.matched}</span>
          </div>

          <blockquote className="mt-3 border-l border-foreground pl-3.5">
            <p className="accent text-[14.5px] leading-[1.55] text-foreground">
              “{ERROR_RESULT.quote}”
            </p>
            <footer className="mt-1.5 font-mono text-[10.5px] text-muted-foreground">
              {ERROR_RESULT.source}
            </footer>
          </blockquote>
        </div>
      </div>
    </div>
  );
}
