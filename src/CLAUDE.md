# CLAUDE.md

All source modules for the devin-bugs CLI.

## Files

| File | What | When to read |
| --- | --- | --- |
| `cli.ts` | Entry point: arg parsing (`node:util` parseArgs), orchestration (auth → fetch → filter → format), `--help`/`--json`/`--raw`/`--all`/`--login`/`--logout` flags | Adding CLI flags, changing the main flow |
| `auth.ts` | Auth: localhost HTTP callback server, system browser open (`xdg-open`/`open`), token cache at `~/.config/devin-bugs/token.json`, JWT expiry decode, `DEVIN_TOKEN` env override, Auth0 refresh token flow via `auth.devin.ai/oauth/token` | Changing login flow, token caching, refresh logic, or session handling |
| `api.ts` | Devin API client: `fetchDigest` (`GET pr-review/digest`), `fetchPRInfo`, `fetchJobs`, `AuthExpiredError` for retry-on-401 | Adding API endpoints, changing error handling |
| `filter.ts` | Bug extraction: parses `<!-- devin-review-comment {JSON} -->` hidden headers, emoji severity (`🔴`=severe, `🟡`=warning), filters by resolved/outdated status | Changing which bugs are shown, adapting to API format changes |
| `format.ts` | Output: ANSI terminal formatter with severity badges and word wrap, JSON formatter, strips HTML/markdown noise from descriptions | Changing CLI output appearance |
| `parse-pr.ts` | PR reference parser: accepts `owner/repo#N`, GitHub URLs, Devin review URLs | Adding new input formats |
| `types.ts` | TypeScript interfaces: `DigestResponse`, `ReviewThread`, `ReviewComment`, `LifeguardFlag`, `CachedToken` (with `auth0Cache`), `ParsedPR` | Changing data structures or adding API response fields |
| `config.ts` | Constants: API base URL (`app.devin.ai/api`), XDG paths for token cache and browser profile | Changing paths or URLs |
