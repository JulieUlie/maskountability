# Maskountability

Company claims, tested against the evidence. Each entry is one specific public claim made by a company, with the evidence reviewed and a verdict.

**Live:** https://maskountability.julietous.workers.dev

## How it works

- `index.html` lists the published claims, and `case.html` shows one claim with its evidence and verdict.
- The cases live in `cases/` (`cases/index.json` is the index).
- `submit.html` lets anyone suggest a claim. The Worker (`src/worker.js`) stores submissions privately in a Cloudflare D1 database (`schema.sql`). Nothing is published automatically: every case is reviewed by hand first.
- `help.html` explains how to read, search and filter the records.

## Run locally

```bash
npx wrangler d1 execute maskountability-submissions --local --file schema.sql
npx wrangler dev
```

## Deployment

Cloudflare Worker with static assets and D1: `npx wrangler deploy`.
