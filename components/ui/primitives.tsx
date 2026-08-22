import * as React from "react";

import { cn } from "@/lib/utils";

/** The measure everything is set against. */
export function Container({ className, children }: React.ComponentProps<"div">) {
  return (
    <div className={cn("mx-auto w-full max-w-[76rem] px-7 sm:px-12 lg:px-16", className)}>
      {children}
    </div>
  );
}

/** The two vertical rules that run the height of the page. */
export function Frame() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="mx-auto h-full w-full max-w-[76rem] border-x" />
    </div>
  );
}

/** An opaque plate the width of the frame, to sit over a blueprint field. */
export function Plate({ className }: { className?: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className={cn("mx-auto h-full w-full max-w-[76rem] bg-paper", className)} />
    </div>
  );
}

export function Section({
  className,
  children,
  id,
  frame = true,
  as: Tag = "section",
  ...props
}: React.ComponentProps<"section"> & { frame?: boolean; as?: React.ElementType }) {
  return (
    <Tag id={id} className={cn("relative", className)} {...props}>
      {frame ? <Frame /> : null}
      {children}
    </Tag>
  );
}

/** A blueprint field — grid plus registration crosses. */
export function Field({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="bp-grid absolute inset-0" />
      <div className="bp-cross absolute inset-0" />
    </div>
  );
}

export function Backdrop() {
  return (
    <>
      <Field className="pointer-events-none absolute inset-0 overflow-hidden" />
      <Plate />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden"
      >
        <div className="mx-auto h-full w-full max-w-[76rem]">
          <Field className="mask-fade-b relative h-full w-full" />
        </div>
      </div>
    </>
  );
}

export function EdgeField() {
  return (
    <Field className="mask-fade-l pointer-events-none absolute inset-0 overflow-hidden" />
  );
}

/** `[ 04 ]  THE PLATFORM` — the only eyebrow in the system. */
export function Label({
  children,
  className,
  index,
}: React.ComponentProps<"div"> & { index?: string }) {
  return (
    <div className={cn("label flex items-center gap-2 text-muted-foreground", className)}>
      {index ? <span className="text-foreground/35">[ {index} ]</span> : null}
      <span>{children}</span>
    </div>
  );
}

/** One italic clause per headline. */
export function Accent({ children }: { children: React.ReactNode }) {
  return <em className="accent font-normal">{children}</em>;
}

export function Panel({
  children,
  className,
  corners = false,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  corners?: boolean;
  as?: React.ElementType;
}) {
  return (
    <Tag className={cn("relative border bg-panel", className)}>
      {corners ? <Corners /> : null}
      {children}
    </Tag>
  );
}

/** Four register marks, the way a drawing is pinned to a board. */
export function Corners() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {[
        "-left-[3px] -top-[3px]",
        "-right-[3px] -top-[3px]",
        "-left-[3px] -bottom-[3px]",
        "-right-[3px] -bottom-[3px]",
      ].map((position) => (
        <span
          key={position}
          className={cn("absolute size-[5px] bg-foreground/40", position)}
        />
      ))}
    </div>
  );
}

/** A cell in a bordered grid — the repeating unit of every feature section. */
export function Cell({
  index,
  title,
  body,
  children,
  className,
}: {
  index: string;
  title: React.ReactNode;
  body?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("cell group flex h-full flex-col p-7", className)}>
      <span className="label text-foreground/35 transition-colors duration-300 group-hover:text-foreground">
        [ {index} ]
      </span>
      <h3 className="mt-4 text-[17px] font-medium tracking-[-0.02em]">{title}</h3>
      {body ? (
        <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{body}</p>
      ) : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}

export function Marquee({
  children,
  duration = 40,
  className,
}: {
  children: React.ReactNode;
  duration?: number;
  className?: string;
}) {
  return (
    <div className={cn("mask-x-fade group relative w-full min-w-0 overflow-hidden", className)}>
      <div
        className="flex w-max animate-marquee items-center group-hover:[animation-play-state:paused]"
        style={{ "--marquee-duration": `${duration}s` } as React.CSSProperties}
      >
        {children}
        {children}
      </div>
    </div>
  );
}
