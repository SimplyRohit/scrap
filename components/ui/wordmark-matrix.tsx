"use client";

import * as React from "react";

import { useReducedMotion } from "@/hooks/use-reduced-motion";

const GLYPHS: Record<string, string[]> = {
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
};

const WORD = "RIFT";
const GLYPH_W = 5;
const GLYPH_H = 7;
const GAP = 1;
const UNIT = 100;
const CELL = 74;

const COLS = WORD.length * GLYPH_W + (WORD.length - 1) * GAP;

type Cell = { x: number; y: number; cx: number; cy: number };

const CELLS: Cell[] = WORD.split("").flatMap((char, glyphIndex) => {
  const rows = GLYPHS[char];
  const offset = glyphIndex * (GLYPH_W + GAP);

  return rows.flatMap((row, y) =>
    row
      .split("")
      .map((bit, x) =>
        bit === "1"
          ? {
              x: (offset + x) * UNIT,
              y: y * UNIT,
              cx: (offset + x) * UNIT + CELL / 2,
              cy: y * UNIT + CELL / 2,
            }
          : null,
      )
      .filter((cell): cell is Cell => cell !== null),
  );
});

const REST_OPACITY = 0.07;
const PEAK_OPACITY = 0.9;
const INFLUENCE = 620;
const FALLOFF = 1.15;

/**
 * The wordmark as a dot matrix that lights up around the pointer. Cells are
 * written to directly rather than through state — there are ~120 of them and
 * they update every frame.
 */
export function WordmarkMatrix() {
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const cellRefs = React.useRef<(SVGRectElement | null)[]>([]);
  const pointer = React.useRef<{ x: number; y: number } | null>(null);
  const levels = React.useRef<Float32Array>(new Float32Array(CELLS.length));
  const reduced = useReducedMotion();

  React.useEffect(() => {
    if (reduced) return;

    const svg = svgRef.current;

    if (!svg) return;

    let frame = 0;
    let settled = false;
    let onScreen = false;

    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;

        if (onScreen && !frame) frame = requestAnimationFrame(tick);
      },
      { rootMargin: "200px" },
    );

    const toLocal = (clientX: number, clientY: number) => {
      const rect = svg.getBoundingClientRect();

      return {
        x: ((clientX - rect.left) / rect.width) * (COLS * UNIT),
        y: ((clientY - rect.top) / rect.height) * (GLYPH_H * UNIT),
      };
    };

    const onMove = (event: PointerEvent) => {
      pointer.current = toLocal(event.clientX, event.clientY);
      settled = false;
    };

    const onLeave = () => {
      pointer.current = null;
      settled = false;
    };

    function tick() {
      if (!onScreen) {
        frame = 0;
        return;
      }

      frame = requestAnimationFrame(tick);

      if (settled) return;

      const point = pointer.current;
      let moving = false;

      for (let i = 0; i < CELLS.length; i++) {
        const cell = CELLS[i];
        let target = 0;

        if (point) {
          const distance = Math.hypot(cell.cx - point.x, cell.cy - point.y);

          target = Math.max(0, 1 - distance / INFLUENCE) ** FALLOFF;
        }

        const level = levels.current[i];
        const next = level + (target - level) * 0.16;

        if (Math.abs(next - level) > 0.001) moving = true;

        levels.current[i] = next;

        const node = cellRefs.current[i];

        if (!node) continue;

        node.style.opacity = String(REST_OPACITY + next * (PEAK_OPACITY - REST_OPACITY));
        node.style.transform = `scale(${1 + next * 0.16})`;
      }

      if (!moving && !point) settled = true;
    }

    observer.observe(svg);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${COLS * UNIT - (UNIT - CELL)} ${GLYPH_H * UNIT - (UNIT - CELL)}`}
      className="w-full"
      aria-hidden="true"
      focusable="false"
    >
      {CELLS.map((cell, i) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          ref={(node) => {
            cellRefs.current[i] = node;
          }}
          x={cell.x}
          y={cell.y}
          width={CELL}
          height={CELL}
          className="fill-foreground [transform-box:fill-box] [transform-origin:center]"
          style={{ opacity: REST_OPACITY }}
        />
      ))}
    </svg>
  );
}
