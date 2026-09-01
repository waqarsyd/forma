---
name: Forma Precision Logic
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#45474c'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#75777d'
  outline-variant: '#c5c6cc'
  surface-tint: '#565f70'
  primary: '#040d1b'
  on-primary: '#ffffff'
  primary-container: '#1a2332'
  on-primary-container: '#818a9d'
  inverse-primary: '#bec7db'
  secondary: '#a04100'
  on-secondary: '#ffffff'
  secondary-container: '#ae4900'  # was #fe6b00 until 2026-09-01; white on it measured 2.87:1
  on-secondary-container: '#572000'
  tertiary: '#090d0f'
  on-tertiary: '#ffffff'
  tertiary-container: '#1f2325'
  on-tertiary-container: '#868a8c'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae3f7'
  primary-fixed-dim: '#bec7db'
  on-primary-fixed: '#131c2a'
  on-primary-fixed-variant: '#3e4758'
  secondary-fixed: '#ffdbcc'
  secondary-fixed-dim: '#ffb693'
  on-secondary-fixed: '#351000'
  on-secondary-fixed-variant: '#7a3000'
  tertiary-fixed: '#e0e3e5'
  tertiary-fixed-dim: '#c4c7c9'
  on-tertiary-fixed: '#181c1e'
  on-tertiary-fixed-variant: '#434749'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '450'
    lineHeight: 18px
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  container-max: 1440px
  gutter: 24px
  margin-desktop: 40px
  margin-mobile: 16px
---

## Brand & Style

This design system is engineered for developers and technical architects who demand precision, efficiency, and high-performance tooling. The brand personality is authoritative yet lean, stripping away decorative fluff in favor of structural clarity and functional aesthetics.

The visual direction follows a **Corporate / Modern** style infused with **Minimalist** and **Tactile** accents. It leverages a "core layout engine" theme, utilizing subtle geometric patterns and grid-based alignment to evoke a sense of architectural stability. The emotional response is one of controlled power—users should feel they are interacting with a highly calibrated instrument rather than a standard SaaS application.

## Colors

The palette is anchored by **Deep Charcoal/Navy (#1A2332)**, providing a high-contrast foundation for professional reliability. **Vibrant Orange (#FF6B00)** serves as the primary action color, used sparingly for critical CTAs, progress indicators, and "active state" highlights to draw the eye with mechanical precision.

The neutral scale favors cool grays to maintain a technical feel. Backgrounds utilize a tiered system of off-whites and pale blues to define functional zones without the harshness of pure white. Success, Warning, and Error states should be rendered in desaturated tones to ensure they don't compete with the primary orange brand color.

## Typography

The typographic system balances the modern, sharp personality of **Hanken Grotesk** for headlines with the utilitarian clarity of **Inter** for long-form content. To reinforce the developer-focused nature of the product, **JetBrains Mono** is used for labels, status indicators, and technical metadata.

Hierarchy is maintained through weight and scale rather than decorative shifts. Tight letter-spacing on display styles creates a compact, professional appearance. All technical readouts and "system status" messages must use the monospaced label style to differentiate automated data from user-generated content.

## Layout & Spacing

The system employs a **Fixed Grid** layout for core content areas to ensure predictable alignment of complex data visualization, while sidebars and "comms ports" use fluid percentages. The layout is built on an 8px square grid, ensuring every element is mathematically aligned to the "engine" architecture.

- **Desktop (1280px+):** 12-column grid, 24px gutters, 40px external margins.
- **Tablet (768px - 1279px):** 8-column grid, 16px gutters, 24px margins.
- **Mobile (<768px):** 4-column grid, 12px gutters, 16px margins.

Subtle 1px grid lines (hex: #E2E8F0) may be used as background patterns to guide the eye across wide horizontal spans, emphasizing the "layout engine" theme.

## Elevation & Depth

This design system avoids heavy shadows, instead using **Tonal Layers** and **Low-Contrast Outlines** to communicate depth. The primary canvas is at level 0, with secondary panels (like toolbars and sidebars) using a subtle fill color (#F8FAFC) to create separation.

Modals and popovers utilize a very tight, neutral ambient shadow (4px blur, 5% opacity) paired with a 1px solid border (#CBD5E1). This "technical stacking" approach mimics physical blueprint layers, where depth is clear but never distracting. Interactive elements like cards use a subtle "lift" effect on hover, achieved by changing the border color to the primary brand navy.

## Shapes

The shape language is strictly **Soft (0.25rem)**. This provides enough of a radius to feel modern and accessible while maintaining the sharp, industrial edge required for a technical tool. 

Larger containers (cards, main content areas) use `rounded-lg` (0.5rem) to provide a structural frame. Interactive elements like buttons and input fields stay consistent at 4px. Avoid pill-shapes entirely; all buttons must have clearly defined corners to reflect the "blocks" of the core layout engine.

## Components

### Buttons
Primary buttons use the high-energy **Vibrant Orange (#FF6B00)** with white text. Secondary buttons use a transparent background with a 1px Navy border. All buttons have a fixed height (36px or 44px) and use the `label-caps` typography for a rigorous, military-spec feel.

### Input Fields
Inputs are defined by a 1px border (#CBD5E1) that transitions to Primary Navy on focus. Labels sit outside the field in `code-sm` JetBrains Mono. Use placeholder text sparingly; use helper text below the field for technical instructions.

### Cards & Panels
Cards should not use shadows. Instead, they use a 1px stroke and a slightly different background tint. For the "Core Layout Engine" feel, cards may include a "port" indicator (a small 4x4px orange square in the top-left corner) to signal connectivity.

### Status Chips
Chips are rectangular with 2px roundedness. They use desaturated background tints of the status color (e.g., light green for 'Success') with high-contrast text. All status chips must be paired with an icon for immediate recognition.

### Data Lists
Lists use horizontal 1px dividers. Alternating row colors (zebra striping) are encouraged in data-heavy views to maintain legibility. Hover states on list items should use a subtle blue-gray tint (#F1F5F9).