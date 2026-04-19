# CLAUDE.md

All source modules for the devin-bugs CLI.

## Files

| File | What | When to read |
| --- | --- | --- |
| `cli.ts` | Entry point: arg parsing (`node:util` parseArgs), orchestration (auth → jobs → pickLatestJobVersion → job-result → filter → format), `--help`/`--json`/`--raw`/`--bugs-only`/`--flags-only`/`--include-resolved`/`--watch`/`--login`/`--logout` flags, `AuthRequiredError` handling (exit 10) | Adding CLI flags, changing the main flow |
| `auth.ts` | Auth: `AuthRequiredError` + `isNonInteractive()` detection, localhost HTTP callback server, system browser open, token cache at `~/.config/devin-bugs/token.json`, JWT expiry decode, `DEVIN_TOKEN` env override, Auth0 refresh token flow | Changing login flow, token caching, refresh logic, non-interactive detection |
| `api.ts` | Devin API client: `fetchJobs`, `fetchJobResult`, `pickLatestJobVersion`, `getReviewStatus()` → `ReviewStatus`, `AuthExpiredError` for retry-on-401. Exports `JobsResponse`/`ReviewJob`/`JobVersion` types consumed by `cli.ts`. | Adding API endpoints, changing error handling |
| `watch.ts` | `--watch` poll loop: `watchReview()` polls jobs every 10s, prints stage progress to stderr, `WatchTimeoutError` on 10-min timeout | Changing watch polling behavior, timeout, or progress output |
| `filter.ts` | Finding extraction: maps `lifeguard_result.bugs[]` and `lifeguard_result.analyses[]` into the unified `LifeguardFlag` shape. Default filter drops bugs with `resolved_by_devin: true`; `bugsOnly`/`flagsOnly` toggles control which arrays are surfaced. | Changing which findings are shown or how they're mapped |
| `format.ts` | Output: `formatTerminal()` with status banner + per-finding badges (BUG/INVESTIGATE/FLAG), `formatJSON()` with `{ status, bugs, analyses }` envelope, `formatStatusBanner()` for review progress | Changing CLI output appearance |
| `parse-pr.ts` | PR reference parser: accepts `owner/repo#N`, bare number (git remote inference), GitHub URLs, Devin review URLs | Adding new input formats |
| `types.ts` | TypeScript interfaces: `JobResultResponse`, `LifeguardBug`, `LifeguardAnalysis`, `LifeguardFlag` (unified output shape), `CachedToken`, `ParsedPR`, `ReviewStatus` | Changing data structures or adding API response fields |
| `config.ts` | Constants: API base URL (`app.devin.ai/api`), XDG paths for token cache and browser profile | Changing paths or URLs |
