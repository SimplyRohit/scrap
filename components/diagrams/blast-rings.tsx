"use client";

import * as React from "react";

import { useInView } from "@/hooks/use-in-view";
import { RADIUS_RINGS } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

const W = 760;
const H = 500;

const CX = 70;
const CY = 250;

const RADII = [160, 300, 440] as const;

/** Where each ring's nodes sit, in degrees off the horizontal. */
const ANGLES: readonly (readonly number[])[] = [[0], [-30, 0, 30], [-28, -9.5, 9.5, 28]];

const ARC_SPAN = 30;

const point = (r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;

  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
};

/** A ring is drawn as the arc that actually carries nodes, not a full circle. */
const arc = (r: number) => {
  const a = point(r, -ARC_SPAN);
  const b = point(r, ARC_SPAN);

  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${r} ${r} 0 0 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
};

export function BlastRings() {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.3 });
  const [active, setActive] = React.useState<number | null>(null);

  return (
    <div ref={ref}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="One upgrade, three rings of impact: the package itself, the packages that depend on it, and the files in your source that import a changed symbol."
        className="w-full"
      >
        {/* The shockwave. One circle, scaled from the epicentre. */}
        <circle
          cx={CX}
          cy={CY}
          r={RADII[2]}
          fill="none"
          strokeWidth="1"
          className="radius-pulse stroke-signal-ink"
          style={{ "--ox": `${CX}px`, "--oy": `${CY}px` } as React.CSSProperties}
        />

        {RADII.map((r, ring) => (
          <path
            key={r}
            d={arc(r)}
            fill="none"
            strokeWidth="1"
            strokeDasharray={ring === 2 ? "3 5" : undefined}
            className={cn(
              "transition-[stroke,opacity] duration-400",
              active === ring ? "stroke-foreground" : "stroke-foreground/25",
              inView ? "opacity-100" : "opacity-0",
            )}
            style={{ transitionDelay: `${ring * 120}ms` }}
          />
        ))}

        {/* Epicentre. */}
        <g className={cn("transition-opacity duration-500", inView ? "opacity-100" : "opacity-0")}>
          <circle cx={CX} cy={CY} r="7" className="fill-foreground" />
          <text
            x={CX - 14}
            y={CY + 4}
            textAnchor="end"
            className="fill-muted-foreground label text-[10.5px]"
          >
            bump
          </text>
        </g>

        {RADIUS_RINGS.map((ring, i) =>
          ring.nodes.map((node, j) => {
            const { x, y } = point(RADII[i], ANGLES[i][j]);
            const dimmed = active !== null && active !== i;

            return (
              <g
                key={node}
                className={cn(
                  "transition-opacity duration-400",
                  inView ? (dimmed ? "opacity-30" : "opacity-100") : "opacity-0",
                )}
                style={{ transitionDelay: `${200 + i * 160 + j * 70}ms` }}
              >
                <circle
                  cx={x}
                  cy={y}
                  r="4"
                  className={cn(
                    "transition-colors duration-300",
                    active === i ? "fill-signal-ink" : "fill-paper stroke-foreground/25",
                  )}
                  strokeWidth="1"
                />
                <text
                  x={x + 12}
                  y={y + 4}
                  className={cn(
                    "font-mono text-[11.5px] transition-colors duration-300",
                    active === i ? "fill-foreground" : "fill-muted-foreground",
                  )}
                >
                  {node}
                </text>
              </g>
            );
          }),
        )}
      </svg>

      <ul className="mt-6 grid border-t border-border sm:grid-cols-3">
        {RADIUS_RINGS.map((ring, i) => (
          <li
            key={ring.label}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            data-active={active === i}
            className="row-mark border-border pl-4 pt-4 transition-colors duration-250 sm:border-l sm:first:border-l-0"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={cn(
                  "text-[14px] font-medium tracking-tight transition-colors duration-250",
                  active === i ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {ring.label}
              </span>
              <span className="ml-auto pr-4 font-mono text-[11px] tabular-nums text-foreground/35">
                {ring.nodes.length}
              </span>
            </div>
            <p className="mt-1 pr-4 text-[12.5px] leading-[1.55] text-muted-foreground">{ring.note}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
