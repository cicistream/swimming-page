# Design System: Deep Pool Editorial

## 1. Overview & Creative North Star: "The Architectural Submersion"
This design system moves away from the aggressive technicality of typical data dashboards toward a "High-End Editorial" experience. The Creative North Star is **Architectural Submersion**.

We are not building a flat interface; we are designing an Olympic-grade pool viewed through clear, still water. The aesthetic is clean, precise, and intentionally quiet. We break the "template" look by utilizing significant negative space, asymmetric typographic anchors, and a hierarchy defined by depth and light rather than lines and boxes. Every element should feel like it has physical weight, submerged in a deep, navy-tinted void.

## 2. Colors: Tonal Depth & The Pool Water Glow
The palette is anchored by the transition from the deep, navy-tinted `surface` (`#070f17`) to the electric, vibrant `primary` Pool Water Blue (`#61cdff`).

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using `1px` solid borders for sectioning or containment.

Boundaries must be defined through:
- **Background Shifts:** Placing a `surface-container-high` element against a `surface` background.
- **Negative Space:** Using the `spacing` tokens to create structural "moats" between content blocks.

### Surface Hierarchy & Nesting
Treat the UI as a series of stacked architectural slabs.
- **Base Layer:** `surface` (`#070f17`).
- **Secondary Content:** `surface-container-low` (`#0b141d`).
- **Interactive/Raised Elements:** `surface-container-high` (`#16212b`).
- **Signature Glow:** Use `primary` (`#61cdff`) sparingly for high-intent actions, creating a "bioluminescent" contrast against the dark navy.

### The "Glass & Gradient" Rule
To achieve the "editorial" polish, use linear gradients on primary components. A transition from `primary` to `primary-container` at a `135deg` angle mimics the way light hits the surface of water. Floating overlays must use `surface-container-highest` at `80%` opacity with a `24px` backdrop blur.

## 3. Typography: Technical Precision
We utilize **Space Grotesk** across all scales. The font's tabular qualities and geometric construction provide the "architectural" feel required.

- **Display Scale (`display-lg` to `display-sm`):** Used for "Hero Metrics." Treat these as graphic elements. Use `on-surface` color with a slight letter-spacing reduction (`-0.02em`) to make them feel tighter and more premium.
- **Headline & Title:** These drive the editorial narrative. Use `headline-lg` for section starts, often positioned asymmetrically (for example, far left with a wide right margin).
- **Body & Label:** Use `body-md` for standard reading. Labels (`label-md`) should always be in uppercase with `+0.05em` letter spacing to denote "metadata" or technical specs.

The hierarchy communicates authority: large, thin-weight headlines command attention, while small, high-contrast labels provide the "technical" detail.

## 4. Elevation & Depth: The Submerged Tile Effect
We do not use standard Material Design drop shadows. Depth is achieved through **Tonal Layering** and **Inner Refraction**.

- **The Tile Heat Map:** To achieve the "ceramic pool tile" look, use `roundedness-2` (moderate) roundedness. Apply a subtle `inner-shadow` (`0px 2px 4px rgba(255, 255, 255, 0.05)`) and a linear gradient from the base color to a `10%` lighter variant. This creates the "submerged" ceramic feel.
- **Ambient Shadows:** For floating modals, use a "Deep Sea Shadow": `0px 24px 48px rgba(0, 0, 0, 0.5)`. The shadow must be wide and soft, suggesting the element is floating high above the pool floor.
- **The "Ghost Border" Fallback:** If a separation is required for accessibility, use `outline-variant` at `15%` opacity. Never use a `100%` opaque border.

## 5. Components

### Buttons
- **Primary:** Gradient fill (`primary` to `primary-container`), `roundedness-2` roundedness. No border. Text is `on-primary-fixed` (dark blue) for maximum legibility.
- **Secondary:** Surface-only. Use `surface-container-highest` as the background. On hover, transition the background to `surface-bright`.
- **Tertiary:** Text-only in `primary` color. High-letter spacing `label-md` style.

### Pool Tile Grid (Custom Heat Map)
- **Geometry:** `roundedness-2` squares.
- **Spacing:** `spacing-0` (minimal) gap to mimic thin grout lines.
- **States:** Empty tiles use `surface-container-lowest`. Active tiles use a range from `secondary-container` to `primary`.

### Input Fields
- **Container:** `surface-container-low` background with a `Ghost Border` (`10%` `outline`).
- **Focus State:** No thick border. Instead, the background shifts to `surface-container-high` and the `Ghost Border` increases to `40%` opacity in `primary` blue.

### Cards & Lists
- **Rule:** Zero dividers.
- **Structure:** Use `spacing-2` (normal) as a vertical gap between list items. Use a slight background tint shift (`surface` to `surface-container-low`) on hover to define the row.

## 6. Do's and Don'ts

### Do:
- **Use Intentional Asymmetry:** Align text to a `12-column` grid but leave columns `1-3` or `10-12` empty to create a premium editorial "breath."
- **Embrace the Dark:** Let the `surface` color dominate. The "Deep Pool" feel comes from the vastness of the dark navy.
- **Layer with Logic:** Always place higher-priority information on a "higher" (lighter) surface container.

### Don't:
- **Don't use "Pure" Black:** Always use the navy-tinted `surface` (`#070f17`) to maintain the underwater atmosphere.
- **Don't use Hard Borders:** If you feel the need for a line, use a `1px` height `surface-container-high` block instead of a stroke.
- **Don't Over-Round:** Stick to `roundedness-2` for tiles and `roundedness-3` for cards. Excessive rounding (pill shapes) breaks the architectural rigor.
