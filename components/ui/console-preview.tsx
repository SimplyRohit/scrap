import * as React from "react";

import { Reveal } from "@/components/ui/reveal";
import { CONSOLE_LINES, type ConsoleLine } from "@/lib/marketing/content";
import { SITE } from "@/lib/marketing/site";
import { cn } from "@/lib/utils";

/** The one dark surface on the page — a terminal, drawn as one. */
export function ConsolePreview() {
  return (
    <div className="console border border-foreground/20">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <span className="font-mono text-[11.5px] text-white/70">{SITE.name.toLowerCase()}</span>
        <span className="label text-white/30">terminal</span>
      </div>

      <div className="scroll-slim overflow-x-auto px-5 py-4">
        <div className="min-w-[32rem] space-y-[3px]">
          {CONSOLE_LINES.map((line, i) => (
            <Reveal key={i} delay={i * 45}>
              <Line line={line} />
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Risk tones have to be readable on the console, not on paper. */
const ON_DARK: Record<string, string> = {
  CRITICAL: "border-red-400/40 text-red-300",
  HIGH: "border-amber-400/40 text-amber-300",
  MEDIUM: "border-yellow-400/40 text-yellow-200",
  LOW: "border-white/20 text-white/60",
  SAFE: "border-emerald-400/40 text-emerald-300",
};

function Tag({ level }: { level: string }) {
  return (
    <span className={cn("label inline-flex border px-1.5 py-0.5 text-[9.5px]", ON_DARK[level])}>
      {level}
    </span>
  );
}

function Line({ line }: { line: ConsoleLine }) {
  switch (line.kind) {
    case "prompt":
      return (
        <p className="font-mono text-[12.5px] leading-[1.8]">
          <span className="select-none text-white/30">$ </span>
          <span className="text-white/95">{line.text}</span>
        </p>
      );

    case "meta":
      return (
        <p className="font-mono text-[12px] leading-[1.8] text-white/45">
          <span className="inline-block w-20 text-white/25">{line.label}</span>
          {line.text}
        </p>
      );

    case "rule":
      return <div className="my-2.5 h-px bg-white/10" />;

    case "summary":
      return (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12.5px] leading-[1.8]">
          <span className="text-white/95">{line.pkg}</span>
          <span className="text-white/40">{line.range}</span>
          <Tag level={line.risk} />
          <span className="tabular-nums text-white/70">{line.score}</span>
          <span className="text-white/40">{line.breaking}</span>
        </p>
      );

    case "finding":
      return (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 font-mono text-[12px] leading-[1.8]">
          <Tag level={line.severity} />
          <span className="text-white/40">{line.category}</span>
          <span className="text-white/90">{line.title}</span>
        </p>
      );

    case "quote":
      return (
        <p className="border-l-2 border-signal pl-3 text-[12.5px] leading-relaxed text-white/70">
          “{line.text}”
        </p>
      );

    case "cite":
      return (
        <p className="flex flex-wrap items-baseline gap-x-2 pl-3 font-mono text-[11px] leading-[1.8] text-white/30">
          <span className="underline decoration-white/20 underline-offset-2">{line.text}</span>
          <span>·</span>
          <span>{line.tier}</span>
        </p>
      );

    case "exit":
      return <p className="font-mono text-[12px] leading-[1.8] text-red-300">{line.text}</p>;
  }
}
