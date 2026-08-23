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

type Placed = { x: number; y: number; label: string; detail: string; note?: string };

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

/**
 * The whole snake as one path, INPUT to OUTPUT.
 *
 * The edges are drawn as seven separate segments because each one animates in
 * on its own delay. A current has to cross the node boxes as well as the gaps
 * between them, so it needs the continuous version — same geometry, one stroke.
 */
const FLOW = [
  `M ${COL_X[0] + NODE_W / 2} ${MID_TOP}`,
  `H ${TURN_X}`,
  `V ${MID_BOTTOM}`,
  `H ${RETURN_X}`,
].join(" ");

/** One pass, and the pause before the first, in milliseconds. */
const FLOW_MS = 9000;
const FLOW_START_MS = 1100;

const SEG_A = TURN_X - RETURN_X;
const SEG_B = MID_BOTTOM - MID_TOP;
const FLOW_LENGTH = SEG_A + SEG_B + SEG_A;

/**
 * Where along the flow the packet enters a given stage.
 *
 * Derived from the geometry rather than typed out, so moving a column moves the
 * lighting with it. The turn is the awkward one: the packet enters INDEX going
 * down the right-hand side, not along the bottom row.
 */
function entryDistance(node: Placed): number {
  if (node.y === ROW_Y[0]) return Math.max(0, node.x - RETURN_X);
  if (node.x <= TURN_X && TURN_X <= node.x + NODE_W) return SEG_A + (ROW_Y[1] - MID_TOP);

  return SEG_A + SEG_B + (TURN_X - (node.x + NODE_W));
}

export function PipelineFlow() {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.25 });
  const svgRef = React.useRef<SVGSVGElement | null>(null);

  // Dash length has to match the real path, so it is measured rather than guessed.
  // Re-measured when the current appears: it only mounts once the diagram is on
  // screen, so a mount-only effect would leave it on the fallback length and
  // show two lit segments instead of one.
  React.useEffect(() => {
    const paths = svgRef.current?.querySelectorAll<SVGPathElement>("path.draw, path.flow-current");

    paths?.forEach((path) => {
      path.style.setProperty("--len", String(path.getTotalLength()));
    });
  }, [inView]);

  return (
    <div ref={ref}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Pipeline: input, research, normalize, knowledge, index, retrieval, evidence, output, with verified fixes written back to the index."
        className="w-full"
        style={{ "--flow-duration": `${FLOW_MS}ms` } as React.CSSProperties}
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

        {/* The current, behind the boxes: it lights the gaps between stages and
            is hidden where a stage sits, which is the shape of the pipeline. */}
        {inView ? (
          <>
            <path
              d={FLOW}
              className="flow-current fill-none stroke-mark/70"
              strokeWidth="1.5"
              strokeLinecap="round"
              style={{ animationDelay: `${FLOW_START_MS}ms` } as React.CSSProperties}
            />
            {/* Behind the boxes on purpose: a dot drawn over a card covers the
                text and reads as a blemish rather than as movement. */}
            <circle
              r="3"
              className="flow-packet fill-mark"
              style={
                {
                  "--flow-path": `path('${FLOW}')`,
                  animationDelay: `${FLOW_START_MS}ms`,
                } as React.CSSProperties
              }
            />
          </>
        ) : null}

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

            {/* The stage the packet is currently inside. */}
            {inView ? (
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx="2"
                className="stage-lit fill-mark/[0.07] stroke-mark/60"
                strokeWidth="1"
                style={
                  {
                    animationDelay: `${FLOW_START_MS + (entryDistance(node) / FLOW_LENGTH) * FLOW_MS}ms`,
                  } as React.CSSProperties
                }
              />
            ) : null}
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

            {node.note ? (
              <g>
                <rect
                  x={node.x + 16}
                  y={node.y + NODE_H + 10}
                  width={node.note.length * 6.2 + 16}
                  height={17}
                  rx="2"
                  className="fill-mark/10 stroke-mark/45"
                  strokeWidth="1"
                />
                <text
                  x={node.x + 24}
                  y={node.y + NODE_H + 22}
                  className="fill-mark font-mono text-[9.5px] tracking-[0.1em] uppercase"
                >
                  {node.note}
                </text>
              </g>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}
