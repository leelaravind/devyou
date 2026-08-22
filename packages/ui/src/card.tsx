/**
 * Card.
 *
 * DESIGN.md: depth comes from tonal layering and a 1px `outline-variant` hairline,
 * never a `shadow-*` utility — on a "Deep Charcoal" dark-first palette a drop shadow
 * is nearly invisible and reads as a rendering bug rather than elevation, whereas a
 * border reads identically in both themes. No shadow class appears anywhere below,
 * and that omission is intentional, not an oversight.
 *
 * `as` lets a card render as `<article>`/`<section>` when it is a genuine landmark
 * (e.g. one card per search result) without duplicating this component for that case.
 */

import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@devyou/core";

export type CardElement = "div" | "article" | "section";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: CardElement;
  interactive?: boolean;
  padded?: boolean;
}

export function Card({
  as = "div",
  interactive = false,
  padded = true,
  className,
  children,
  ...rest
}: CardProps) {
  const Tag: ElementType = as;

  return (
    <Tag
      className={cn(
        "bg-surface-container border border-outline-variant rounded-lg",
        padded && "p-gutter",
        interactive && "hover:border-outline transition-colors",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
