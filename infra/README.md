# Sync Trigger Worker

This Worker receives a browser request from the deployed site and relays it to GitHub as a `repository_dispatch` event.

## Files

- `infra/sync-trigger-worker.js`: Worker entrypoint
- `wrangler.toml`: Wrangler deployment config

## First-time setup

1. Authenticate Wrangler:

```bash
npx wrangler login
```

2. Set the required GitHub secret on the Worker:

```bash
npx wrangler secret put GITHUB_TOKEN
```

The token should be able to trigger repository dispatch events for `cicistream/swimming-page`.

3. If needed, update the public vars in `wrangler.toml`:

- `ALLOWED_ORIGIN`
- `GITHUB_OWNER`
- `GITHUB_REPO`

## Local development

Create a local `.dev.vars` file at the repo root:

```bash
GITHUB_TOKEN=your_github_token
```

Then run:

```bash
npm run worker:dev
```

## Deploy

```bash
npm run worker:deploy
```

After deploy, copy the Worker URL and set it as `VITE_SYNC_TRIGGER_URL` for the site build.
