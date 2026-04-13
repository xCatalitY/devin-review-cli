# CLAUDE.md

All source modules for the devin-bugs CLI.

## Files

| File | What | When to read |
| --- | --- | --- |
| `cli.ts` | Entry point: arg parsing (`node:util` parseArgs), orchestration (auth → watch/fetch → filter → format), `--help`/`--json`/`--raw`/`--all`/`--watch`/`--login`/`--logout` flags, `AuthRequiredError` handling (exit 10) | Adding CLI flags, changing the main flow |
| `auth.ts` | Auth: `AuthRequiredError` + `isNonInteractive()` detection, localhost HTTP callback server, system browser open, token cache at `~/.config/devin-bugs/token.json`, JWT expiry decode, `DEVIN_TOKEN` env override, Auth0 refresh token flow | Changing login flow, token caching, refresh logic, non-interactive detection |
| `api.ts` | Devin API client: `fetchDigest` (`GET pr-review/digest`), `fetchPRInfo`, `fetchJobs`, `getReviewStatus()` → `ReviewStatus`, `AuthExpiredError` for retry-on-401 | Adding API endpoints, changing error handling |
| `watch.ts` | `--watch` poll loop: `watchReview()` polls jobs every 10s, prints stage progress to stderr, `WatchTimeoutError` on 10-min timeout | Changing watch polling behavior, timeout, or progress output |
| `filter.ts` | Bug extraction: parses `<!-- devin-review-comment {JSON} -->` hidden headers, emoji severity (`🔴`=severe, `🟡`=warning), filters by resolved/outdated status | Changing which bugs are shown, adapting to API format changes |
| `format.ts` | Output: `formatTerminal()` with status banner + severity badges, `formatJSON()` with `{ status, bugs }` envelope, `formatStatusBanner()` for review progress | Changing CLI output appearance |
| `parse-pr.ts` | PR reference parser: accepts `owner/repo#N`, bare number (git remote inference), GitHub URLs, Devin review URLs | Adding new input formats |
| `types.ts` | TypeScript interfaces: `DigestResponse`, `ReviewThread`, `ReviewComment`, `LifeguardFlag`, `CachedToken`, `ParsedPR`, `ReviewStatus` | Changing data structures or adding API response fields |
| `config.ts` | Constants: API base URL (`app.devin.ai/api`), XDG paths for token cache and browser profile | Changing paths or URLs |
