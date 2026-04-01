# Deep Water Swimming Page

Deep Water Swimming Page is a swim-native personal performance homepage built around a small publish pipeline:

```text
raw swim sessions -> canonical private data -> public generated data -> homepage
```

The goal is to make a swimmer's training archive feel deliberate and publishable, instead of looking like a generic fitness export or admin dashboard.

![Deep Water Swimming Page preview](./docs/preview.png)

## What Ships Today

- Vite + React + TypeScript front end
- `build-data` pipeline that normalizes source sessions into private and public artifacts
- a publish-friendly homepage with summary metrics, yearly consistency heatmap, stroke mix, and activity archive
- sample config and sample swim sessions so the project runs on first clone
- a design system in [DESIGN.md](./DESIGN.md) that defines the Deep Pool editorial look

## Product Shape

The current app is intentionally narrow:

- one swimmer profile
- one generated public homepage
- sample JSON as the initial input source
- generated data files checked into neither `public/generated/` nor `data/private/`

This is the first working spine, not the final platform. The current repo proves the contract between import, normalization, publish artifacts, and UI.

## Quick Start

1. Install dependencies.

```bash
npm install
```

2. Generate the private and public artifacts.

```bash
npm run build:data
```

3. Start the local app.

```bash
npm run dev
```

4. Build the production bundle.

```bash
npm run build
```

## Available Scripts

- `npm run build:data`: normalize sample/provider input into generated artifacts
- `npm run dev`: rebuild data first, then start the Vite dev server
- `npm run build`: rebuild data, type-check, and create the production bundle
- `npm run preview`: serve the production build locally

## Repository Layout

```text
sample-data/          demo input sessions
scripts/build-data.mjs
data/private/         canonical private swim records (generated)
public/generated/     public publish artifacts consumed by the app (generated)
src/                  React app shell and Deep Water UI
swim.config.json      swimmer profile + display + provider config
DESIGN.md             visual system source of truth
```

## Data Flow

`scripts/build-data.mjs` currently reads:

- `sample-data/swims.json`
- `swim.config.json`

It then generates:

- `data/private/canonical-swims.json`
- `public/generated/summary.json`
- `public/generated/activities.json`
- `public/generated/latest.json`
- `public/generated/heatmap.json`
- `public/generated/sync-report.json`
- `public/generated/config.json`

The split is deliberate:

- `data/private/` is the fuller canonical layer for future merge/conflict workflows
- `public/generated/` is the publish-safe layer consumed by the homepage

## Configuration

The first-run configuration lives in [swim.config.json](./swim.config.json).

Current sections:

- `profile`: public-facing swimmer identity and summary copy
- `display`: privacy and presentation toggles
- `provider`: selected source plus a lightweight capability matrix

Notable display behavior:

- `startedAt` remains a date key in public activity data for stable charting and archive rendering
- precise timestamps can still be emitted separately when enabled
- exact location and notes stay out of public artifacts unless explicitly turned on

## Sample Data Contract

Each input swim record is expected to include:

- `id`
- `source`
- `sourceActivityId`
- `startedAt`
- `timezone`
- `distanceMeters`
- `durationSeconds`
- `pacePer100mSeconds`
- `poolLengthMeters`
- `laps`

Optional fields currently supported:

- `stroke`
- `swolf`
- `calories`
- `notes`
- `location`

Missing optional fields are preserved as partial-data markers so the UI can expose completeness honestly.

## Design Direction

The visual system is intentionally not a generic sports dashboard. The app follows a dark, editorial "Deep Pool" language:

- tonal depth over visible borders
- large typographic anchors over card grids
- restrained aquatic highlights over loud accent colors
- technical swim data presented as calm, premium publishing

See [DESIGN.md](./DESIGN.md) for the current source of truth.

## Current Scope

Implemented now:

- sample JSON import path
- canonical/private to public/publish split
- partial-data labeling
- sync provenance scaffolding
- Deep Water homepage shell

Planned next:

- real provider ingestion
- provider selection rubric
- manual override and conflict resolution flow
- stronger onboarding and diagnostics
- richer publish controls

## Contributing

This repo is still at the first public spine stage, so the most valuable contributions are:

- provider adapters
- data contract hardening
- visual polish that preserves the Deep Water design language
- publishing and privacy controls
- testing around normalization and generated artifact integrity

If you are changing the UI, keep [DESIGN.md](./DESIGN.md) in sync with the implementation direction.
