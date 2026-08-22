/**
 * Icons.
 *
 * The Stitch screens use Google's Material Symbols icon font. This package ships
 * inline SVG paths instead, for three reasons that outweigh matching the reference
 * implementation exactly:
 *
 * 1. An icon font is a render-blocking third-party request on every page, on a
 *    product whose core promise is fast triage.
 * 2. A font that fails to load renders ligature text — the literal word
 *    "bug_report" in place of an icon. Inline SVG has no such failure mode.
 * 3. Icons here carry meaning (R-34: state is never colour alone), so they must be
 *    present when the state is present, not when a font finishes downloading.
 *
 * The glyph set is drawn to match Material Symbols Outlined at 24px on a 24-unit
 * grid, so the visual reference still holds.
 *
 * Accessibility: an icon is `aria-hidden` unless given a `label`. A decorative icon
 * beside a text label that announces itself is noise; an icon carrying the only
 * meaning must announce itself. There is no third case.
 */

import type { SVGProps } from "react";
import { cn } from "@devyou/core";

const PATHS = {
  search: "M9.5 3a6.5 6.5 0 0 1 5.25 10.34l5.46 5.45-1.42 1.42-5.45-5.46A6.5 6.5 0 1 1 9.5 3Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z",
  check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  check_circle:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1.3 11.3-3-3 1.4-1.4 1.6 1.6 4.6-4.6 1.4 1.4Z",
  error:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 3h2v6h-2Zm0 8h2v2h-2Z",
  warning: "M1 21 12 2l11 19Zm3.47-2h15.06L12 6ZM11 10h2v5h-2Zm0 6h2v2h-2Z",
  info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 3h2v2h-2Zm0 4h2v6h-2Z",
  help: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-.1 3a3.1 3.1 0 0 0-3.1 3h2a1.1 1.1 0 1 1 1.8.9c-.9.7-1.6 1.3-1.6 2.6h2c0-.6.3-.9 1-1.5A3 3 0 0 0 11.9 7ZM11 16h2v2h-2Z",
  bug_report:
    "M19 8h-2.8a5 5 0 0 0-1.2-1.3L16.6 5 15.2 3.6l-2 2A5 5 0 0 0 12 5.5c-.4 0-.8 0-1.2.1l-2-2L7.4 5l1.6 1.7A5 5 0 0 0 7.8 8H5v2h2.1v1H5v2h2.1v1H5v2h2.8a5 5 0 0 0 8.4 0H19v-2h-2.1v-1H19v-2h-2.1v-1H19Zm-6 9h-2v-2h2Zm0-4h-2v-2h2Z",
  network_check:
    "M2 9.5 4 11.5A11.3 11.3 0 0 1 12 8a11.3 11.3 0 0 1 8 3.5l2-2A14.1 14.1 0 0 0 12 5 14.1 14.1 0 0 0 2 9.5Zm5 5 2 2a5.6 5.6 0 0 1 6 0l2-2a8.5 8.5 0 0 0-10 0ZM10 19l2 2 2-2a2.8 2.8 0 0 0-4 0Z",
  database:
    "M12 2c-4.4 0-8 1.3-8 3v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5c0-1.7-3.6-3-8-3Zm0 2c3.9 0 6 1.1 6 1s-2.1 1-6 1-6-1.1-6-1 2.1-1 6-1Zm6 15c0 .1-2.1 1-6 1s-6-.9-6-1v-2.6A16 16 0 0 0 12 17a16 16 0 0 0 6-1.6Zm0-5c0 .1-2.1 1-6 1s-6-.9-6-1v-2.6A16 16 0 0 0 12 12a16 16 0 0 0 6-1.6Zm0-5c0 .1-2.1 1-6 1s-6-.9-6-1V7.4A16 16 0 0 0 12 9a16 16 0 0 0 6-1.6Z",
  verified:
    "m12 1 2.6 2.6 3.6-.5.5 3.6L21 9.4 19.4 12 21 14.6l-2.3 2.7-.5 3.6-3.6-.5L12 23l-2.6-2.6-3.6.5-.5-3.6L3 14.6 4.6 12 3 9.4l2.3-2.7.5-3.6 3.6.5Zm-1.2 14.4 5.7-5.7-1.4-1.4-4.3 4.3-2-2-1.4 1.4Z",
  hub: "M11 3v4.1a3 3 0 0 0-1.9 1.4L5.7 6.6A3 3 0 1 0 4.7 8.3l3.4 1.9a3 3 0 0 0 0 1.6l-3.4 1.9a3 3 0 1 0 1 1.7l3.4-1.9a3 3 0 0 0 1.9 1.4V19h2v-4.1a3 3 0 0 0 1.9-1.4l3.4 1.9a3 3 0 1 0 1-1.7l-3.4-1.9a3 3 0 0 0 0-1.6l3.4-1.9a3 3 0 1 0-1-1.7l-3.4 1.9A3 3 0 0 0 13 7.1V3Z",
  account_circle:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3a3.2 3.2 0 1 1 0 6.4A3.2 3.2 0 0 1 12 5Zm0 15a8 8 0 0 1-5.6-2.3c0-1.9 3.7-3 5.6-3s5.6 1.1 5.6 3A8 8 0 0 1 12 20Z",
  content_copy:
    "M16 1H4a2 2 0 0 0-2 2v14h2V3h12Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11Z",
  terminal:
    "M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 14H4V8h16ZM6.5 10 5 11.4l2.1 2.1L5 15.6 6.5 17l3.5-3.5Zm5 5H17v2h-5.5Z",
  chevron_right: "M9.3 6.7 14.6 12l-5.3 5.3-1.4-1.4L11.8 12 7.9 8.1Z",
  chevron_left: "M14.7 6.7 9.4 12l5.3 5.3 1.4-1.4L12.2 12l3.9-3.9Z",
  expand_more: "M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6Z",
  expand_less: "M12 8l6 6-1.4 1.4L12 10.8 7.4 15.4 6 14Z",
  arrow_back: "M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20Z",
  close: "M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12Z",
  menu: "M3 6h18v2H3Zm0 5h18v2H3Zm0 5h18v2H3Z",
  filter: "M10 18h4v-2h-4Zm-7-12v2h18V6Zm3 7h12v-2H6Z",
  history:
    "M13 3a9 9 0 0 0-9 9H1l3.9 3.9.1.1L9 12H6a7 7 0 1 1 2.1 5l-1.4 1.4A9 9 0 1 0 13 3Zm-1 5v5l4.3 2.5.7-1.2-3.5-2.1V8Z",
  schedule:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-.5 3v5.5l4.7 2.8.8-1.3-4-2.4V7Z",
  shield:
    "M12 1 3 5v6c0 5.6 3.8 10.7 9 12 5.2-1.3 9-6.4 9-12V5Zm0 2.2 7 3.1V11c0 4.5-2.9 8.6-7 9.9-4.1-1.3-7-5.4-7-9.9V6.3Z",
  science:
    "M13 3v6.6l4.8 8.3A2 2 0 0 1 16 21H8a2 2 0 0 1-1.7-3.1L11 9.6V3Zm-2 7.1-3.3 5.7h8.6L13 10.1V5h-2ZM9 3h6v2H9Z",
  lightbulb:
    "M12 2a7 7 0 0 0-4 12.7V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.3A7 7 0 0 0 12 2Zm-2 15v-3.4l-.9-.6a5 5 0 1 1 5.8 0l-.9.6V17Zm0 3h4v1a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1Z",
  build:
    "M22 7.5 18.5 11 16 8.5 19.5 5a5 5 0 0 0-6.4 6.4l-9 9 2.5 2.5 9-9A5 5 0 0 0 22 7.5Z",
  fingerprint:
    "M12 2a9.8 9.8 0 0 0-5.6 1.8l1.2 1.6a7.8 7.8 0 0 1 8.8 0l1.2-1.6A9.8 9.8 0 0 0 12 2Zm0 4a6 6 0 0 0-6 6v3h2v-3a4 4 0 0 1 8 0v5h2v-5a6 6 0 0 0-6-6Zm0 4a2 2 0 0 0-2 2v8h2v-8h2v6h2v-6a2 2 0 0 0-2-2Z",
  visibility:
    "M12 5C6.5 5 2.7 9.6 1 12c1.7 2.4 5.5 7 11 7s9.3-4.6 11-7c-1.7-2.4-5.5-7-11-7Zm0 12c-3.9 0-6.9-3-8.4-5C5.1 10 8.1 7 12 7s6.9 3 8.4 5c-1.5 2-4.5 5-8.4 5Zm0-8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Z",
  block:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM4 12a8 8 0 0 1 12.9-6.3L5.7 16.9A7.9 7.9 0 0 1 4 12Zm8 8a7.9 7.9 0 0 1-4.9-1.7L18.3 7.1A8 8 0 0 1 12 20Z",
  add: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6Z",
  sync: "M12 4V1L8 5l4 4V6a6 6 0 0 1 5.2 9l1.5 1.5A8 8 0 0 0 12 4Zm0 14a6 6 0 0 1-5.2-9L5.3 7.5A8 8 0 0 0 12 20v3l4-4-4-4Z",
  link: "M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12ZM8 13h8v-2H8Zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10Z",
  description:
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm4 18H6V4h7v5h5ZM8 12h8v2H8Zm0 4h8v2H8Z",
  account_tree:
    "M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3ZM7 9H4V5h3Zm10 8h3v4h-3Zm0-12h3v4h-3Z",
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  name: IconName;
  /** Pixel size. Defaults to 20 — the density this design system uses in UI chrome. */
  size?: number;
  /**
   * Accessible name. Supply it when the icon is the only carrier of meaning; omit it
   * when adjacent text already says the same thing.
   */
  label?: string;
}

export function Icon({ name, size = 20, label, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={cn("shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
