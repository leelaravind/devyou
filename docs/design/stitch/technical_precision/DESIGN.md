---
name: Technical Precision
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#6bd8cb'
  on-secondary: '#003732'
  secondary-container: '#29a195'
  on-secondary-container: '#00302b'
  tertiary: '#ffb786'
  on-tertiary: '#502400'
  tertiary-container: '#df7412'
  on-tertiary-container: '#461f00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#89f5e7'
  secondary-fixed-dim: '#6bd8cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#ffdcc6'
  tertiary-fixed-dim: '#ffb786'
  on-tertiary-fixed: '#311400'
  on-tertiary-fixed-variant: '#723600'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
  evidence-blue: '#3B82F6'
  technical-teal: '#0D9488'
  status-confirmed: '#818CF8'
  status-reproduced: '#F472B6'
  status-ci-verified: '#34D399'
  status-documented: '#94A3B8'
  warning-amber: '#F59E0B'
  destructive-red: '#EF4444'
  diagnostic-node-bg: '#1E293B'
typography:
  headline-lg:
    fontFamily: Geist
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  code-block:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
  env-tag:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 14px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin: 24px
  density-high: 8px
  density-compact: 4px
---

## Brand & Style
The design system is engineered for high-stakes technical troubleshooting, where clarity and information density are paramount. The brand personality is **analytical, stable, and transparent**. It avoids decorative flourishes in favor of utility and "at-a-glance" readability.

The visual style is **Modern Corporate / Technical**, influenced by IDEs and observability platforms. It utilizes a structured "Grid-and-Border" approach, relying on hairline strokes and tonal shifts rather than shadows to define depth. The goal is to evoke the feeling of a well-configured terminal or dashboard: fast, responsive, and authoritative.

## Colors
The system defaults to **Dark Mode**, utilizing a "Deep Charcoal" palette (`#0F172A`) to reduce eye strain during long debugging sessions. Light mode uses a clean "Zinc" scale.

**Verification Palette:**
- **Documented:** Slate gray. Indicates information exists but is not yet validated.
- **Confirmed:** Soft Indigo. Human-verified evidence.
- **Reproduced:** Rose/Pink. Indicates a bug or state has been triggered locally.
- **CI-Verified:** Emerald. Automated system validation.

Primary actions use **Evidence Blue**, while secondary technical configurations use **Technical Teal**.

## Typography
The system uses a tri-font hierarchy:
1. **Geist** for headlines and structural UI components, providing a sharp, technical geometry.
2. **Inter** for body text and descriptive content to ensure high legibility at small sizes.
3. **JetBrains Mono** for all "data-driven" elements, including environment variables, logs, and evidence tags.

All typography is set to a slightly tighter line height than standard consumer apps to accommodate higher information density.

## Layout & Spacing
This design system employs a **Fixed Grid** for the main navigation and a **Fluid Content Area** for diagnostic trees and logs. 

- **Density:** Use an 8px base grid, but allow for 4px increments ("Compact Density") in sidebars and attribute lists.
- **Sidebars:** Fixed width at 280px to maximize the central workspace for code and diagnostic nodes.
- **Breakpoints:**
  - Desktop: 1280px+ (Full visibility of tree + code).
  - Tablet: 768px (Sidebar collapses to icons).
  - Mobile: Not recommended for deep troubleshooting; displays read-only status alerts.

## Elevation & Depth
Depth is conveyed through **Tonal Layering** and **Borders** rather than shadows. 
- **Level 0 (Background):** `#0F172A` (Deep Slate).
- **Level 1 (Containers):** `#1E293B` with a 1px border of `#334155`.
- **Level 2 (Overlays/Popovers):** `#334155` with a subtle 4px blur backdrop.
- **Active State:** Elements are highlighted with a 2px left-border or a subtle inner-glow of the primary color.

## Shapes
The shape language is **Soft (0.25rem)**. This provides enough rounding to feel modern without sacrificing the "industrial" look of a pro tool. 
- **Environment Tags:** Use 4px (Soft) rounding.
- **Action Buttons:** Use 4px (Soft) rounding.
- **Diagnostic Nodes:** Use 6px (custom) to differentiate structural tree elements from standard buttons.
- **Code Blocks:** 0px (Sharp) bottom-corners when attached to headers; 4px elsewhere.

## Components
- **Environment Tags:** Monospaced text inside a subtle bordered pill. Color-coded by category (OS = Blue, Runtime = Teal, Framework = Indigo).
- **Diagnostic Tree Nodes:** Large containers with a vertical status bar on the left. Active nodes use a subtle inner-glow. Failed nodes use a "pulse" stroke of `destructive-red`.
- **Evidence Indicators:** Small, high-contrast labels (all-caps monospaced) that appear next to claims. They should include an icon (e.g., a shield for CI-Verified).
- **Code Blocks:** Syntax-highlighted background using a darker shade than the UI background. Includes a persistent "Copy" button in the top-right and a "Run in Terminal" action if applicable.
- **Destructive Warnings:** High-visibility banners using `destructive-red` borders and a "Warning" icon. Requires a double-click or "Hold to Confirm" interaction.
- **Inputs:** Minimalist design—1px border that turns `evidence-blue` on focus. No drop shadows.