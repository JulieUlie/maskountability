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

## Tests

Playwright tests in TypeScript: `npm install`, then `npm test`. Playwright wipes a local state folder, creates the table from `schema.sql` in a local D1 and starts `wrangler dev`, so the tests never touch the real review queue. What got stored is checked by reading the local SQLite file read-only.

- `tests/api/`: the submit endpoint. What is stored (status "new", trimmed, control characters stripped, long fields cut), the 422 rules, the honeypot (looks accepted, stores nothing), malformed requests (405, 415, 400, 413), and that private files (`schema.sql`, `src/`, the tests) are never served.
- `tests/ui/`: the register with fictional cases (search, verdict filter, drafts never shown, text never run as HTML), a case page, the submit form (success, server reasons, offline), the theme key, and axe scans of every page.

60 tests, with axe scans of every page in light and dark mode. In v4 they found that the grey secondary text on the home and case pages had a contrast of 4.19:1, under the 4.5:1 of WCAG AA; fixed, and the axe scans now guard it.

## What changed in v5 (23 Nov 2026)

A polish release; each change has a regression test.

- **Form errors point at the field.** A refused submission now names the field at fault (`field` in the 422 answer). The form marks it as invalid, links the error message to it and moves focus there; the mark clears as soon as you edit the field.
- **Dark mode reaches the form controls.** The pages declare `color-scheme`, so the checkbox, the verdict menu and the scrollbars follow the theme instead of staying bright white.
- **No theme flash.** A saved light/dark choice is applied in the page head, before anything is drawn.
- **Safer case pages.** "Original post" only becomes a link for http(s) addresses; a record without evidence or history still renders, and unknown labels show their raw value instead of nothing. Long links wrap at phone width.
- **Calmer list for screen readers and reduced motion.** While you type in the search box only the count is announced, not the whole list again. Cards no longer lift on hover when reduced motion is on, and keyboard focus on a card is clearly visible.
- **Honest help text.** The FAQ said nothing is stored; it now explains that a sent claim (with an optional contact) is stored privately for review. Page titles all end in "· Maskountability", and the case page has the same footer as the others.

## Deployment

Cloudflare Worker with static assets and D1: `npx wrangler deploy`.
