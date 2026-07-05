---
name: Crimson Gallery
colors:
  surface: '#fff8f7'
  surface-dim: '#f1d3d0'
  surface-bright: '#fff8f7'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fff0ef'
  surface-container: '#ffe9e7'
  surface-container-high: '#ffe2de'
  surface-container-highest: '#f9dcd9'
  on-surface: '#271816'
  on-surface-variant: '#5b403d'
  inverse-surface: '#3e2c2a'
  inverse-on-surface: '#ffedeb'
  outline: '#8f6f6c'
  outline-variant: '#e4beba'
  surface-tint: '#ba1a20'
  primary: '#af101a'
  on-primary: '#ffffff'
  primary-container: '#d32f2f'
  on-primary-container: '#fff2f0'
  inverse-primary: '#ffb3ac'
  secondary: '#b3272a'
  on-secondary: '#ffffff'
  secondary-container: '#fc5d59'
  on-secondary-container: '#600009'
  tertiary: '#005f7b'
  on-tertiary: '#ffffff'
  tertiary-container: '#00799c'
  on-tertiary-container: '#e9f7ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdad6'
  primary-fixed-dim: '#ffb3ac'
  on-primary-fixed: '#410003'
  on-primary-fixed-variant: '#930010'
  secondary-fixed: '#ffdad7'
  secondary-fixed-dim: '#ffb3ae'
  on-secondary-fixed: '#410004'
  on-secondary-fixed-variant: '#910816'
  tertiary-fixed: '#bee9ff'
  tertiary-fixed-dim: '#7bd1f8'
  on-tertiary-fixed: '#001f2a'
  on-tertiary-fixed-variant: '#004d65'
  background: '#fff8f7'
  on-background: '#271816'
  surface-variant: '#f9dcd9'
typography:
  display-xl:
    fontFamily: Inter
    fontSize: 80px
    fontWeight: '700'
    lineHeight: '1.05'
    letterSpacing: -0.022em
  display-lg:
    fontFamily: Inter
    fontSize: 56px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.022em
  headline-md:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.015em
  body-lg:
    fontFamily: Inter
    fontSize: 19px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: '0'
  body-md:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '400'
    lineHeight: '1.47'
    letterSpacing: -0.01em
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.022em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  section-gap: 120px
  card-padding: 40px
  gutter: 24px
  margin-mobile: 20px
  margin-desktop: auto
---

## Brand & Style
The design system is an exercise in restraint and precision, drawing heavily from editorial luxury and high-end consumer electronics. The aesthetic is "Gallery Minimalist"—a style that treats content as art, utilizing expansive white space (the "Fog" canvas) to create a sense of breathability and prestige.

The personality is authoritative yet welcoming, characterized by massive typographic hierarchies and a strict adherence to a high-contrast color palette. The UI relies on physical presence and structural geometry rather than digital ornamentation like drop shadows. The target audience expects a premium, tactile experience where every interaction feels deliberate and weighted.

## Colors
The palette is dominated by **Fog (#F5F5F7)**, serving as the universal canvas to ground all elements. **Pure White (#FFFFFF)** is used exclusively for interactive cards and content containers, creating depth through subtle tonal shifts rather than shadows.

**Deep Crimson (#D32F2F)** is the "Signal Color," reserved strictly for primary calls to action, critical indicators, and high-value conversion points. **Soft Red (#EF5350)** provides a secondary tier of urgency, used for high-demand badges or status updates. All borders must be rendered as 1px hairlines using the specified 8% opacity to maintain a "barely-there" structural definition.

## Typography
This design system utilizes **Inter** (as the closest accessible alternative to SF Pro) with specific weight and tracking adjustments to mimic high-end hardware marketing. Headlines must be bold and tightly tracked (-0.022em) to create a "locked" visual block. 

The primary body copy is set at **17px** for optimal readability on modern screens, ensuring a balance between information density and elegance. Use the Display XL and LG tiers for hero sections with minimal words to maximize impact.

## Layout & Spacing
The layout follows a **Fixed Grid** philosophy for desktop (max-width 1440px) to maintain the "gallery" feel, and a fluid 4-column system for mobile. 

- **Section Breathing:** Use large vertical gaps (120px+) between major product feature blocks.
- **Card Padding:** Content within 28px-radius cards should have a generous 40px internal padding to ensure elements don't feel crowded near the large corners.
- **Alignment:** Center-aligned layouts are preferred for hero sections; left-aligned grids are used for technical specifications and feature lists.

## Elevation & Depth
Elevation is achieved through **Contrast and Materiality** rather than lighting effects. 

1.  **Level 0 (Base):** Fog (#F5F5F7) background.
2.  **Level 1 (Surface):** Pure White (#FFFFFF) cards. No shadows.
3.  **Level 2 (Overlay):** Glassmorphic panels with `backdrop-filter: blur(20px)` and 80% opacity white fill. These are used for sticky navigation bars and modal overlays.

Hairline borders (1px) provide the only structural separation between white surfaces and the fog background, ensuring the UI feels light and precision-engineered.

## Shapes
The shape language is defined by two extremes: 
- **The Signature Curve:** All primary containers and cards use a **28px border radius**. This creates a soft, organic look that mimics modern industrial design.
- **The Pill:** Buttons, tags, and small badges use a **999px radius** for a full capsule shape.

Strictly avoid intermediate radii (like 4px or 8px) to maintain the distinct visual rhythm of the design system.

## Components
- **Primary Buttons:** Capsule-shaped (pill), Deep Crimson background, White text. No shadows. High-weight ease on hover.
- **Cards:** Pure White, 28px radius, hairline border. Content inside should be vertically stacked with ample white space.
- **Navigation Bar:** Glassmorphic (24px blur) with a hairline bottom border. Text links in dark grey, shifting to black on hover.
- **Badges:** Small capsule shapes using Soft Red (#EF5350) for demand-gen signals (e.g., "New", "Limited Edition").
- **Input Fields:** Subtle grey-outlined capsules that transition to a 1px Crimson border on focus.
- **Motion:** All interactive states must use a **0.344s ease-in-out** transition to provide a sense of "expensive" weight.