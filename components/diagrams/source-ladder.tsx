"use client";

import * as React from "react";

import { useInView } from "@/hooks/use-in-view";
import { SOURCE_TIERS } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

/**
 * The authority ladder. Bars are the weight each tier carries into confidence
 * scoring, so the shape of the list is the scoring rule, drawn.
 */
export function SourceLadder() {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.3 });
  const [hovered, setHovered] = React.useState<number | null>(null);

  return (
    <div ref={ref} className="border bg-panel">
      <div className="flex items-center justify-between border-b border-border bg-paper/60 px-5 py-3">
        <span className="font-mono text-[11.5px] text-foreground">source ladder</span>
        <span className="label flex items-center gap-1.5 text-foreground/35">
          <span>read in this order</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5">
            <i aria-hidden className="size-1.5 bg-mark" />
            unlocked by bright data
          </span>
        </span>
      </div>

      <ul className="p-2">
        {SOURCE_TIERS.map((tier, i) => {
          const active = hovered === i;

          return (
            <li key={tier.tier}>
              <div
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                data-active={active}
                className="row-mark flex items-center gap-4 px-3 py-2.5 pl-4 transition-colors duration-300 hover:bg-foreground/[0.03]"
              >
                <span className="w-5 shrink-0 font-mono text-[11px] tabular-nums text-foreground/35">
                  {String(i + 1).padStart(2, "0")}
                </span>

                <span className="w-36 shrink-0">
                  <span
                    className={cn(
                      "block text-[13.5px] transition-colors duration-250",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {tier.label}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-foreground/35">
                    {tier.tier}
                  </span>
                </span>

                <span className="relative hidden h-1.5 grow bg-secondary sm:block">
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 origin-left transition-all duration-800 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      active ? "bg-mark" : "bg-foreground/25",
                    )}
                    style={{
                      width: inView ? `${tier.weight * 100}%` : "0%",
                      transitionDelay: `${i * 90}ms`,
                    }}
                  />
                </span>

                <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                  {tier.weight.toFixed(2)}
                </span>
              </div>

              <p
                aria-hidden={!active}
                className={cn(
                  "h-5 pl-12 text-[12.5px] leading-5 text-muted-foreground",
                  "transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  active ? "translate-y-0 opacity-100" : "-translate-y-0.5 opacity-0",
                )}
              >
                {tier.note}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
