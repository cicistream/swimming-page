# Deep Water Swimming Page

An open source, swim-native performance page built around a simple pipeline:

```text
sample/provider data -> canonical private data -> public publish data -> homepage
```

This repo currently ships the first working spine:

- Vite + React + TypeScript front end
- `build-data` pipeline that generates canonical private data and public publish artifacts
- Deep Water design tokens sourced from `DESIGN.md`
- sample config + sample sessions for a forkable first-run path

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Generate data artifacts:

   ```bash
   npm run build:data
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

4. Build for production:

   ```bash
   npm run build
   ```

## Project Structure

```text
sample-data/          demo input sessions
scripts/build-data.mjs
data/private/         canonical private swim records (generated)
public/generated/     public publish artifacts consumed by the app (generated)
src/                  React app shell and Deep Water UI
swim.config.json      profile + display + provider config
DESIGN.md             visual system source of truth
```

## Current Data Contract

Generated public artifacts:

- `summary.json`
- `activities.json`
- `latest.json`
- `heatmap.json`
- `sync-report.json`
- `config.json`

Generated private artifact:

- `data/private/canonical-swims.json`

## Current Scope

Implemented now:

- sample-json input path
- canonical/private -> public/publish split
- partial-data labeling
- sync provenance and stale-state hooks
- Deep Water homepage structure

Planned next:

- real automatic provider
- provider selection rubric
- manual override conflict flow
- richer onboarding and diagnostics

