# Deep Water Design System

Source of truth derived from the Stitch project `projects/17698181578014891845` on March 31, 2026.

Project titles observed in Stitch:
- `Activity Log`
- `Deep Water Aquatic Performance Tracker`

Core screens observed in Stitch:
- `Deep Pool Activity Log (Theme Applied)`
- `Session Deep-Dive (Deep Pool Theme)`
- `Deep Pool Integrations (Theme Applied)`

## 1. Product Direction

This product is a dark, editorial swimming analytics experience. It should not feel like a cheerful fitness dashboard or a generic SaaS admin panel. The intended mood is technical, immersive, and cinematic: closer to a premium marine instrument panel than a social workout app.

The core idea is "deep water performance intelligence":
- large performance numbers
- dense but elegant swim telemetry
- atmospheric depth through tonal layering
- restrained, deliberate highlights in aqua and green

## 2. Visual North Star

Stitch's embedded design brief describes the direction as an oceanic, monolithic interface built from deep navy surfaces with glowing aquatic accents.

Design principles:
- Prefer tonal layers over borders.
- Prefer asymmetry over rigid card grids.
- Prefer large editorial hero moments over many equal-weight widgets.
- Prefer depth and atmosphere over flat utility UI.
- Prefer precision and calm over playful fitness branding.

## 3. Typography

Explicit Stitch theme tokens:
- Headline font: `Space Grotesk`
- Body font: `Inter`
- Label font: `Inter`

Usage guidance:
- Use `Space Grotesk` for hero headings, key metrics, section openers, and standout numbers.
- Use `Inter` for body copy, labels, chart annotations, table-like data, and navigation.
- Keep headline tracking slightly tight for a more engineered feel.
- Use tabular numerals for times, distances, pace values, and split data.

Suggested type scale for implementation:
- Hero metric: `56-72px`, `Space Grotesk`, weight `600-700`
- Page title: `36-48px`, `Space Grotesk`, weight `600`
- Section title: `24-30px`, `Space Grotesk`, weight `500-600`
- Card title: `18-22px`, `Inter`, weight `600`
- Body: `15-17px`, `Inter`, weight `400`
- Label/meta: `12-14px`, `Inter`, weight `500`

## 4. Color System

These values come directly from Stitch's `namedColors` plus the theme overrides.

### Foundation

- Background: `#0d141d`
- Surface: `#0d141d`
- Surface low: `#151c26`
- Surface default container: `#19202a`
- Surface high: `#242a34`
- Surface highest: `#2e353f`
- Surface lowest: `#080f18`
- Surface variant: `#2e353f`

### Text

- Primary text: `#dce3f0`
- Secondary text: `#c1c7cb`
- Muted outline text: `#8b9295`

### Brand / Accent

- Primary: `#00dfc1`
- Primary fixed: `#26fedc`
- Primary container: `#002d25`
- Secondary: `#b0c9e8`
- Secondary container: `#314863`
- Tertiary: `#6bdc96`
- Tertiary container: `#002e16`

### Theme Overrides Present In Stitch

- Override primary: `#00F5D4`
- Override secondary: `#102A43`
- Override tertiary: `#48BB78`
- Override neutral: `#050B14`

Implementation guidance:
- Use the foundation surfaces as the actual layout system.
- Use aqua primary sparingly for emphasis, active states, chart focus, and key actions.
- Use green tertiary for improvement, positive deltas, or successful states.
- Use secondary blue for supporting data, secondary charts, or integration-related UI.
- Avoid pure black and avoid white backgrounds.

## 5. Layout And Spacing

Explicit Stitch token:
- `spacingScale = 1`

Practical spacing system:
- `4px` micro spacing
- `8px` tight internal spacing
- `12px` compact grouping
- `16px` default card padding rhythm
- `24px` section padding
- `32px` major block separation
- `48px` page section separation
- `64px+` hero breathing room

Layout rules:
- Let one hero metric or headline dominate each page.
- Use wide gutters and generous negative space.
- Group related swim stats in quiet tonal blocks instead of visually boxing everything.
- Prefer 2-column or asymmetric desktop compositions over uniform 4-card dashboards.

## 6. Shape, Borders, And Depth

Explicit Stitch theme token:
- Roundness: `ROUND_FOUR`

Interpretation for implementation:
- Default radius should land around `4px`
- Rarely exceed `8px`

Depth rules:
- Avoid hard 1px borders as the default containment strategy.
- Define hierarchy through darker and lighter surface steps.
- Use blur, glow, and tonal contrast more than drop shadows.
- If a separator is necessary, use very low-contrast lines derived from `#41484b`.

## 7. Components

### Hero Stats

- Oversized swim metrics
- Supporting metadata beneath, not beside, when possible
- Optional soft aqua gradient or glow for primary number emphasis

### Data Cards

- Background from `surface low` or `surface container`
- Minimal chrome
- No obvious card-outline UI
- Internal grouping through spacing and typographic hierarchy

### Charts

- Borderless or near-borderless
- Aqua as the main active series
- Green reserved for positive trend or PR-like moments
- Horizontal grid only, very faint
- Avoid visual clutter and dense legends

### Session Deep Dive

Based on the observed screen set, this page should emphasize:
- split times
- pace or cadence-like metrics
- stroke or performance breakdowns
- a strong hero summary at the top

### Integrations

The integrations page should still inherit the same premium look:
- dark containers
- restrained logo treatment
- clean status presentation
- no bright marketplace-card aesthetic

## 8. Motion

Motion should feel fluid and underwater, not playful.

Guidelines:
- Use soft fade and upward drift on entrance
- Keep transitions around `180-280ms`
- Use slightly slower chart reveal timings for hero data
- Avoid bouncy springs
- Use subtle glow transitions for hover and active states

## 9. Imagery And Visual Language

The visual system should feel aquatic without becoming literal.

Do:
- use gradients that suggest depth, pressure, and low light
- use charts and numbers as the main "visual art"
- use glow sparingly, like bioluminescent signal cues

Do not:
- use cartoon waves, droplets, or sports-app mascots
- use tropical/beach palette cues
- use bright cyan everywhere

## 10. Responsive Behavior

Observed Stitch screens are desktop-first, so mobile behavior should be derived carefully.

Responsive guidance:
- Keep hero metric first on mobile
- Collapse asymmetric desktop layouts into a single editorial column
- Preserve large type moments, but reduce hero sizes aggressively
- Convert side-by-side stat clusters into stacked groups with clear spacing
- Let charts overflow horizontally only if they remain readable

Suggested breakpoints:
- Mobile: `< 768px`
- Tablet: `768px - 1199px`
- Desktop: `1200px+`

## 11. Implementation Notes

Recommended CSS custom properties:

```css
:root {
  --bg: #0d141d;
  --surface-lowest: #080f18;
  --surface-low: #151c26;
  --surface: #19202a;
  --surface-high: #242a34;
  --surface-highest: #2e353f;
  --text: #dce3f0;
  --text-muted: #c1c7cb;
  --outline-soft: #41484b;
  --primary: #00dfc1;
  --primary-bright: #00F5D4;
  --secondary: #102A43;
  --tertiary: #48BB78;
  --radius-sm: 4px;
  --radius-md: 8px;
}
```

Frontend implementation guardrails:
- Default page background should be `--bg`.
- Build sections from layered surfaces, not white cards on dark backgrounds.
- `Space Grotesk` and `Inter` should be loaded early and treated as part of the brand.
- Use tabular numerals in all swim metric UI.
- Keep shadows soft and rare.

## 12. What Is Explicit Vs Inferred

Explicit from Stitch:
- dark color mode
- `Space Grotesk` headline font
- `Inter` body and label fonts
- `ROUND_FOUR`
- core color tokens listed above
- project/page naming around activity log, deep dive, integrations, and aquatic performance tracking

Inferred for implementation:
- exact breakpoint system
- exact font sizes
- exact motion timing
- final spacing scale mapping in CSS
- exact hero and chart compositions for mobile

When implementation choices are unclear, stay faithful to the mood first:
editorial, deep, technical, calm, and premium.
