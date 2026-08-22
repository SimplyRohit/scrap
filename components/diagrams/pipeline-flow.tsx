"use client";

import * as React from "react";

import { useInView } from "@/hooks/use-in-view";
import { PIPELINE_STAGES } from "@/lib/marketing/content";

const W = 920;
const H = 316;

const NODE_W = 186;
const NODE_H = 64;

const ROW_Y = [36, 176] as const;
/** Left-to-right on the top row, right-to-left on the bottom — one snake. */
const COL_X = [10, 248, 486, 724] as const;

type Placed = { x: number; y: number; label: string; detail: string };

const NODES: Placed[] = PIPELINE_STAGES.map((stage, i) => {
  const top = i < 4;
  const column = top ? i : 3 - (i - 4);

  return { x: COL_X[column], y: ROW_Y[top ? 0 : 1], ...stage };
});

const MID_TOP = ROW_Y[0] + NODE_H / 2;
const MID_BOTTOM = ROW_Y[1] + NODE_H / 2;
const TURN_X = COL_X[3] + NODE_W / 2;
const RETURN_X = COL_X[0] + NODE_W / 2;
const RETURN_Y = ROW_Y[1] + NODE_H + 32;

/** Straight runs between adjacent stages, plus the turn down to the second row. */
const EDGES = [
  `M ${COL_X[0] + NODE_W} ${MID_TOP} H ${COL_X[1]}`,
  `M ${COL_X[1] + NODE_W} ${MID_TOP} H ${COL_X[2]}`,
  `M ${COL_X[2] + NODE_W} ${MID_TOP} H ${COL_X[3]}`,
  `M ${TURN_X} ${ROW_Y[0] + NODE_H} V ${ROW_Y[1]}`,
  `M ${COL_X[3]} ${MID_BOTTOM} H ${COL_X[2] + NODE_W}`,
  `M ${COL_X[2]} ${MID_BOTTOM} H ${COL_X[1] + NODE_W}`,
  `M ${COL_X[1]} ${MID_BOTTOM} H ${COL_X[0] + NODE_W}`,
];

/** Where each edge ends, and which way it points. */
const HEADS = [
  { x: COL_X[1], y: MID_TOP, dir: "right" },
  { x: COL_X[2], y: MID_TOP, dir: "right" },
  { x: COL_X[3], y: MID_TOP, dir: "right" },
  { x: TURN_X, y: ROW_Y[1], dir: "down" },
  { x: COL_X[2] + NODE_W, y: MID_BOTTOM, dir: "left" },
  { x: COL_X[1] + NODE_W, y: MID_BOTTOM, dir: "left" },
  { x: COL_X[0] + NODE_W, y: MID_BOTTOM, dir: "left" },
] as const;

const head = ({ x, y, dir }: (typeof HEADS)[number]) => {
  if (dir === "right") return `M ${x - 7} ${y - 4} L ${x} ${y} L ${x - 7} ${y + 4}`;
  if (dir === "left") return `M ${x + 7} ${y - 4} L ${x} ${y} L ${x + 7} ${y + 4}`;

  return `M ${x - 4} ${y - 7} L ${x} ${y} L ${x + 4} ${y - 7}`;
};

const FEEDBACK = `M ${RETURN_X} ${ROW_Y[1] + NODE_H} V ${RETURN_Y} H ${TURN_X} V ${ROW_Y[1] + NODE_H}`;

export function PipelineFlow() {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.25 });
  const svgRef = React.useRef<SVGSVGElement | null>(null);

  // Dash length has to match the real path, so it is measured rather than guessed.
  React.useEffect(() => {
    const paths = svgRef.current?.querySelectorAll<SVGPathElement>("path.draw");

    paths?.forEach((path) => {
      path.style.setProperty("--len", String(path.getTotalLength()));
    });
  }, []);

  return (
    <div ref={ref}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Pipeline: input, research, normalize, knowledge, index, retrieval, evidence, output, with verified fixes written back to the index."
        className="w-full"
      >
        {EDGES.map((d, i) => (
          <path
            key={d}
            d={d}
            className="draw fill-none stroke-foreground/25"
            data-shown={inView}
            strokeWidth="1"
            style={{ "--draw-delay": `${180 + i * 90}ms` } as React.CSSProperties}
          />
        ))}

        <g
          className="reveal fill-none stroke-foreground/25"
          data-shown={inView}
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ "--reveal-delay": "900ms" } as React.CSSProperties}
        >
          {HEADS.map((spec, i) => (
            <path key={i} d={head(spec)} />
          ))}
        </g>

        <path
          d={FEEDBACK}
          className="reveal fill-none stroke-faint"
          data-shown={inView}
          strokeWidth="1"
          strokeDasharray="3 4"
          style={{ "--reveal-delay": "1000ms" } as React.CSSProperties}
        />

        <text
          x={W / 2}
          y={RETURN_Y - 8}
          textAnchor="middle"
          className="reveal fill-muted-foreground label"
          data-shown={inView}
          style={{ "--reveal-delay": "1200ms" } as React.CSSProperties}
        >
          verified fixes written back
        </text>

        {NODES.map((node, i) => (
          <g
            key={node.label}
            className="reveal"
            data-shown={inView}
            style={{ "--reveal-delay": `${i * 90}ms` } as React.CSSProperties}
          >
            <rect
              x={node.x}
              y={node.y}
              width={NODE_W}
              height={NODE_H}
              rx="2"
              className="fill-panel stroke-foreground/25"
              strokeWidth="1"
            />
            <text
              x={node.x + 16}
              y={node.y + 27}
              className="fill-foreground font-mono text-[11.5px] tracking-[0.14em]"
            >
              {node.label}
            </text>
            <text
              x={node.x + 16}
              y={node.y + 47}
              className="fill-muted-foreground font-mono text-[10px]"
            >
              {node.detail}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
