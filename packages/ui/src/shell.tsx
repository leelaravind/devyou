/**
 * Application shell: top navigation, sidebar, split view.
 *
 * The split view is the layout the UX research calls for (R-25): "the Map" on the
 * left — the diagnostic tree, its history, its branches — and "the Territory" on the
 * right, holding the active node's commands, expected output and warnings.
 *
 * It collapses to a stacked layout below 1024px (R-36). That threshold is a token
 * (`--breakpoint-split`) rather than a literal, because the responsive test asserts
 * against the same number and a layout whose breakpoint is written twice is a layout
 * that eventually has two breakpoints.
 */

import type { ReactNode } from "react";
import { cn } from "@devyou/core";
import { Icon, type IconName } from "./icon.js";

/* ---------------------------------------------------------------------------
   Top navigation
   --------------------------------------------------------------------------- */

export interface NavLink {
  label: string;
  href: string;
  current?: boolean;
}

export interface TopNavProps {
  links?: NavLink[];
  /** Rendered between the brand and the links — normally the compact search field. */
  search?: ReactNode;
  /** Rendered at the trailing edge — account, theme toggle. */
  actions?: ReactNode;
  className?: string;
}

export function TopNav({ links = [], search, actions, className }: TopNavProps) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "sticky top-0 z-50 flex h-16 w-full items-center justify-between gap-gutter border-b border-outline-variant bg-surface-container-low px-margin",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-gutter">
        <a
          href="/"
          className="font-headline text-headline-md font-bold tracking-tight text-primary"
        >
          DEV.ITISYOU
        </a>
        {search && <div className="hidden min-w-0 md:block">{search}</div>}
      </div>

      <div className="flex items-center gap-density-high">
        <div className="hidden items-center gap-density-high md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={link.current ? "page" : undefined}
              className={cn(
                "rounded px-3 py-2 font-mono text-label-caps uppercase transition-colors",
                link.current
                  ? "text-on-surface"
                  : "text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface",
              )}
            >
              {link.label}
            </a>
          ))}
        </div>
        {actions}
      </div>
    </nav>
  );
}

/* ---------------------------------------------------------------------------
   Sidebar
   --------------------------------------------------------------------------- */

export interface SidebarItem {
  label: string;
  href: string;
  icon: IconName;
  current?: boolean;
}

export interface SidebarProps {
  items: SidebarItem[];
  footer?: ReactNode;
  header?: ReactNode;
  label?: string;
  className?: string;
}

/**
 * Fixed at 280px on desktop — DESIGN.md pins it there "to maximize the central
 * workspace for code and diagnostic nodes". Below the split breakpoint it becomes a
 * horizontal scroller rather than an icon rail: on a phone, an icon-only rail of six
 * near-identical glyphs is a guessing game, and the labels cost one line.
 */
export function Sidebar({ items, header, footer, label = "Sections", className }: SidebarProps) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex shrink-0 gap-density-compact border-outline-variant bg-surface-container-low",
        "max-split:dv-scroll-thin max-split:w-full max-split:overflow-x-auto max-split:border-b max-split:p-density-high",
        "split:w-sidebar split:flex-col split:border-r split:p-gutter",
        className,
      )}
    >
      {header && <div className="hidden pb-gutter split:block">{header}</div>}

      <ul className="flex list-none gap-density-compact max-split:flex-row split:flex-1 split:flex-col">
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "flex items-center gap-density-high rounded px-3 py-2 font-mono text-body-sm whitespace-nowrap transition-colors",
                item.current
                  ? "bg-surface-container-high text-on-surface dv-node-active"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
              )}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
            </a>
          </li>
        ))}
      </ul>

      {footer && <div className="hidden pt-gutter split:block">{footer}</div>}
    </nav>
  );
}

/* ---------------------------------------------------------------------------
   Split view
   --------------------------------------------------------------------------- */

export interface SplitViewProps {
  /** "The Map" — the diagnostic tree and its state. */
  map: ReactNode;
  /** "The Territory" — the active node's detail. */
  territory: ReactNode;
  mapLabel?: string;
  territoryLabel?: string;
  className?: string;
}

/**
 * Below 1024px the two panes stack, and the Territory comes **first** in the DOM.
 *
 * That ordering is the mobile resolution the plan requires (§1): the core flow on a
 * phone is Test → Result → Next Step, so the active step must be what the reader
 * lands on. The Map is still present and still interactive — plan §1 overrides
 * DESIGN.md's "mobile is read-only" — but it moves below the fold rather than
 * pushing the actual work off it.
 */
export function SplitView({
  map,
  territory,
  mapLabel = "Diagnostic tree",
  territoryLabel = "Current step",
  className,
}: SplitViewProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col-reverse split:flex-row", className)}>
      <section
        aria-label={mapLabel}
        className="dv-scroll-thin min-w-0 overflow-y-auto border-outline-variant p-margin max-split:border-t split:w-[360px] split:shrink-0 split:border-r"
      >
        {map}
      </section>
      <section
        aria-label={territoryLabel}
        className="dv-scroll-thin min-w-0 flex-1 overflow-y-auto p-margin"
      >
        {territory}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Page frame
   --------------------------------------------------------------------------- */

export interface PageProps {
  children: ReactNode;
  /** Constrains to the 1280px content width the design uses. Off for full-bleed
   *  layouts such as the diagnostic session. */
  contained?: boolean;
  className?: string;
}

export function Page({ children, contained = true, className }: PageProps) {
  return (
    <main
      id="main"
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        contained && "mx-auto w-full max-w-[1280px] px-margin py-12",
        className,
      )}
    >
      {children}
    </main>
  );
}

/** The first focusable element on every page. Plan §18. */
export function SkipLink() {
  return (
    <a href="#main" className="dv-skip-link">
      Skip to content
    </a>
  );
}
