import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Sharp rectangles, no rounding. One hover: a block of colour wipes up from the
 * bottom edge behind the label, which sits above it on `relative z-10`.
 */
const button = cva(
  [
    "group/btn relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 overflow-hidden",
    "border font-medium whitespace-nowrap select-none",
    "transition-colors duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
    "active:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "border-foreground bg-foreground text-background hover:text-signal-ink",
        signal: "border-signal-ink/25 bg-signal text-signal-ink hover:text-background",
        outline: "border-border bg-transparent text-foreground hover:border-foreground/40",
        ghost: "border-transparent text-muted-foreground hover:text-foreground",
      },
      // Heights are fixed rather than derived from padding, so a button and a
      // CopyCommand set side by side always line up.
      size: {
        xs: "label h-8 px-2.5 [&_svg]:size-3",
        sm: "h-9 px-3.5 text-[13px] [&_svg]:size-3.5",
        md: "h-11 px-5 text-[14px] [&_svg]:size-4",
        lg: "h-12 px-5 text-[15px] [&_svg]:size-4",
        icon: "size-9 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type Tone = NonNullable<VariantProps<typeof button>["variant"]>;

/** What the wipe is made of, per variant. */
const WIPE: Record<Tone, string> = {
  primary: "bg-signal",
  signal: "bg-foreground",
  outline: "bg-secondary",
  ghost: "bg-secondary",
};

function Inner({ variant, children }: { variant: Tone; children: React.ReactNode }) {
  return (
    <>
      <span aria-hidden className={cn("wipe-layer z-0", WIPE[variant])} />
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </>
  );
}

type ButtonProps = React.ComponentPropsWithoutRef<"button"> & VariantProps<typeof button>;

export function Button({
  variant = "primary",
  size,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button className={cn(button({ variant, size }), className)} {...props}>
      <Inner variant={variant ?? "primary"}>{children}</Inner>
    </button>
  );
}

type ButtonLinkProps = React.ComponentPropsWithoutRef<"a"> & VariantProps<typeof button>;

export function ButtonLink({
  variant = "primary",
  size,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <a className={cn(button({ variant, size }), className)} {...props}>
      <Inner variant={variant ?? "primary"}>{children}</Inner>
    </a>
  );
}

/** An arrow that nudges when its button is hovered. */
export function ButtonArrow({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn(
        "size-4 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/btn:translate-x-0.5",
        className,
      )}
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

export { button as buttonVariants };
