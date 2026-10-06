# RAT — Repo Analysis Tool

A web dashboard for analysing git repositories. RAT ingests repositories two ways —
deep-clone from a remote URL, or upload a zip containing the `.git` directory — and
computes the metrics defined in the COMS3011A test brief:

- **File metrics** — added lines, removed lines, growth, churn
- **Directory metrics** — the same, rolled up across immediate children
- **Repository metrics** — directory metrics on the repo root
- **Commit-set metrics** — aggregates over a filtered set of commits (time range or
  manual selection), plus modifications, modification frequency and churn rate
- **Author metrics** — author modifications, author churn and ownership

## Quickstart

Requires Node.js 18+ and a git binary on PATH.

```bash
npm install

# Development: API on http://localhost:3001, dashboard on http://localhost:5173
npm run dev

# Tests
npm test

# Production build: serves the dashboard + API on http://localhost:3001
npm run build
npm start
```

## Feature checklist

- [x] F0 — Scaffold: Express API + React (Vite) dashboard
- [ ] F1 — Repository ingestion: remote URL clone + zip upload, multi-repo registry
- [ ] F2 — Metric engine: all five metric categories, with fixture-repo tests
- [ ] F3 — Metrics dashboard: charts, tables, filters (path, author, time range)
- [ ] F4 — Author merging: `.mailmap` support + manual merging
- [ ] F5 — Commit-set selection: searchable commit browser, explicit commit sets
- [ ] F6 — Scale & polish: validated against large (~100k commit) repositories

## Architecture

- `server/` — Node.js + Express API. Repositories are cloned/unpacked under `data/`
  (gitignored) and analysed via the git CLI; metrics are computed by a pure engine in
  `server/lib/`.
- `client/` — React 18 + Vite dashboard.

## AI Declaration

Developed with AI assistance (Qoder AI coding assistant) for planning, implementation
and testing, alongside manual review and testing by the author.

> Note: adjust this declaration to match the course's required AI-usage policy.
