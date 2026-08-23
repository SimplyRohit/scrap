import * as React from "react";

import { Label } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  label?: React.ReactNode;
  index?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  id?: string;
  align?: "left" | "center";
  className?: string;
};

export function SectionHeading({
  label,
  index,
  title,
  description,
  id,
  align = "left",
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn("flex flex-col", align === "center" && "items-center text-center", className)}
    >
      {label ? (
        <Reveal>
          <Label index={index}>{label}</Label>
        </Reveal>
      ) : null}

      <Reveal delay={50}>
        <h2
          id={id}
          className="mt-5 max-w-3xl text-balance text-3xl font-medium leading-[1.08] tracking-[-0.03em] sm:text-4xl md:text-[2.75rem]"
        >
          {title}
        </h2>
      </Reveal>

      {description ? (
        <Reveal delay={100}>
          <p
            className={cn(
              "mt-4 max-w-xl text-pretty text-[15px] leading-relaxed text-muted-foreground",
              align === "center" && "mx-auto",
            )}
          >
            {description}
          </p>
        </Reveal>
      ) : null}
    </div>
  );
}
