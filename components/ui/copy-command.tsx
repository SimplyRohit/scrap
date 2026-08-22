"use client";

import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/** Heights mirror the button scale so the two can sit on one line. */
const shell = cva(
  [
    "group/copy inline-flex max-w-full cursor-pointer items-center gap-2.5 border bg-panel text-left",
    "transition-colors duration-200 hover:bg-secondary active:translate-y-px",
  ],
  {
    variants: {
      size: {
        sm: "h-9 px-3 text-[12px]",
        md: "h-11 px-3.5 text-[13px]",
        lg: "h-12 px-4 text-[13.5px]",
      },
    },
    defaultVariants: { size: "md" },
  },
);

type CopyCommandProps = VariantProps<typeof shell> & {
  command: string;
  className?: string;
};

export function CopyCommand({ command, size, className }: CopyCommandProps) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), 1800);

    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      // Clipboard is unavailable (insecure origin, denied permission). The
      // command is selectable either way, so there is nothing to recover from.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy "${command}" to the clipboard`}
      className={cn(shell({ size }), className)}
    >
      <span aria-hidden className="select-none font-mono text-muted-foreground">
        $
      </span>

      <span className="truncate font-mono text-foreground/80 transition-colors duration-200 group-hover/copy:text-foreground">
        {command}
      </span>

      <span className="relative ml-1 grid size-3.5 shrink-0 place-items-center">
        <CopyGlyph
          className={cn(
            "absolute transition-all duration-200",
            copied
              ? "scale-75 opacity-0"
              : "scale-100 text-muted-foreground opacity-60 group-hover/copy:opacity-100",
          )}
        />
        <CheckGlyph
          className={cn(
            "absolute text-mark transition-all duration-200",
            copied ? "scale-100 opacity-100" : "scale-75 opacity-0",
          )}
        />
      </span>

      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}

const glyph = "size-3.5";

function CopyGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn(glyph, className)}
    >
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5h1.5" />
    </svg>
  );
}

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn(glyph, className)}
    >
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}
