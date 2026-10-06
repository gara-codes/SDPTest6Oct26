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
- [x] F1 — Repository ingestion: remote URL clone + zip upload, multi-repo registry
- [x] F2 — Metric engine: all five metric categories, with fixture-repo tests
- [x] F3 — Metrics dashboard: charts, tables, filters (path, author, time range)
- [x] F4 — Author merging: `.mailmap` support + manual merging
- [x] F5 — Commit-set selection: searchable commit browser, explicit commit sets
- [x] F6 — Scale & polish: verified against large repositories — cJSON (1.1k commits),
  redis (12k), git (82k, 61k non-merge) — engine totals match independent
  `git log | awk` sums exactly on all three; first parse of git takes ~30s and every
  subsequent query answers from the parse cache in ~0.3s

## Using the dashboard

- **Ingest** — clone by URL or upload a zip that contains the repository's `.git`.
  Multiple repositories are kept side by side; remove them from the cards.
- **Dashboard tab** — eight metric cards for the selected path (root by default),
  a monthly added/removed timeline, an immediate-children table (click a row or the
  breadcrumbs to drill into directories), and author ownership. **From/To** date
  fields select the commit set \(H_t / H_{i,j}, range `[from, to)`); the **Author**
  dropdown filters contribution to one canonical author.
- **Authors tab** — merge multiple git identities into one author (tick rows,
  "Merge selected") and undo with "Unmerge". Merges persist per repository and are
  applied on top of any `.mailmap` found in the repo.
- **Commits tab** — search and paginate the commit log, tick any subset and
  "Apply as commit set". The dashboard then computes every metric over exactly that
  explicit commit selection.

## Metric definitions

For a commit set H (default: all non-merge commits), each commit's numstat lines are
attributed to the post-commit path (rename-aware via `--find-renames=50%`; binary
files are not measured):

- **added(o, H)** / **removed(o, H)** — total lines added/removed on object o
- **growth(o, H) = added − removed**
- **churn(o, H) = added + removed**
- **modifications(o, H)** — number of commits in H that touch o
- **mod frequency(o, H) = modifications(o, H) / |H|**
- **churn rate(o, H) = churn(o, H) / |H|**
- **author churn(a, o, H)** — churn on o attributable to author a (after mailmap +
  manual merging); **ownership(o) = author churn / object churn**

Directory values are the sum over contained files (recursive); the repository is the
root directory. Commit windows use the committer date: H_t = {c : t_c ≥ t},
H_{i,j} = {c : i ≤ t_c < j}.

## API overview

| Route | Purpose |
| --- | --- |
| `GET /api/health` | liveness |
| `GET /api/repos` | list registry (status: cloning / extracting / ready / error) |
| `POST /api/repos/clone` | `{ url }` — deep clone in the background |
| `POST /api/repos/upload` | multipart `zip` file containing `.git` |
| `DELETE /api/repos/:id` | remove repo + data |
| `GET/POST /api/repos/:id/metrics` | compute metrics (`path`, `since`, `until`, `author`, `commits[]`) |
| `GET /api/repos/:id/authors` | canonical authors + member identities + commit counts |
| `POST /api/repos/:id/authors/merge` | `{ members: [...] }` merge identities |
| `POST /api/repos/:id/authors/unmerge` | `{ member }` undo a merge group |
| `GET /api/repos/:id/commits` | paginated, searchable commit log |

## Architecture

- `server/` — Node.js + Express API. Repositories are cloned/unpacked under `data/`
  (gitignored) and analysed via the git CLI (`git log -z --numstat` with rename
  detection, parsed once and cached in an LRU); metrics are computed by a pure engine
  in `server/lib/` over interned path/author tables.
- `client/` — React 18 + Vite dashboard (Recharts for the timeline).
- `server/test/` — `node:test` suites: ingestion lifecycle and metric-engine
  fixtures with hand-computed expected values (renames, deletions, binary files,
  merge exclusion, mailmap, commit windows, explicit sets).

## AI Declaration

Developed with AI assistance (Qoder AI coding assistant) for planning, implementation
and testing, alongside manual review and testing by the author. All generated code
was reviewed, run and adjusted by the author before being committed.

> Note: adjust this declaration to match the course's required AI-usage policy.
