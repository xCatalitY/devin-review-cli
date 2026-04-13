#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { parsePR } from "./parse-pr.js";
import { getToken, forceReauth, AuthRequiredError } from "./auth.js";
import { fetchDigest, fetchJobs, getReviewStatus, AuthExpiredError, ApiError } from "./api.js";
import { extractFlags } from "./filter.js";
import { formatTerminal, formatJSON } from "./format.js";
import { watchReview, WatchTimeoutError } from "./watch.js";
import type { ReviewStatus } from "./types.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const HELP = `
  \x1b[1mdevin-bugs\x1b[0m — Extract unresolved bugs from Devin AI code reviews

  \x1b[1mUsage:\x1b[0m
    devin-bugs <pr> [options]

  \x1b[1mArguments:\x1b[0m
    pr              GitHub PR URL, shorthand, or just a number (in a git repo)
                    Examples: owner/repo#123
                              49 (infers repo from git remote)
                              https://github.com/owner/repo/pull/123
                              https://app.devin.ai/review/owner/repo/pull/123

  \x1b[1mOptions:\x1b[0m
    --json          Output as JSON (for piping)
    --all           Include analysis/suggestions, not just bugs
    --watch         Poll until Devin review completes, show progress
    --raw           Dump raw API response (debug)
    --no-cache      Force re-authentication
    --login         Just authenticate, don't fetch anything
    --logout        Clear stored credentials
    --help, -h      Show this help
    --version, -v   Show version

  \x1b[1mEnvironment:\x1b[0m
    DEVIN_TOKEN     Skip browser auth, use this token directly

  \x1b[1mExamples:\x1b[0m
    devin-bugs owner/repo#46
    devin-bugs owner/repo#46 --json
    devin-bugs owner/repo#46 --all --raw
    DEVIN_TOKEN=xxx devin-bugs owner/repo#46
`;

function printHelp(): void {
  console.log(HELP);
}

function printVersion(): void {
  console.log("devin-bugs 0.6.0");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        all: { type: "boolean", default: false },
        watch: { type: "boolean", default: false },
        raw: { type: "boolean", default: false },
        "no-cache": { type: "boolean", default: false },
        login: { type: "boolean", default: false },
        logout: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (err: any) {
    console.error(`\x1b[31mError:\x1b[0m ${err.message}`);
    process.exit(1);
  }

  const { values, positionals } = parsed;

  if (values.help) {
    printHelp();
    return;
  }
  if (values.version) {
    printVersion();
    return;
  }

  // --logout: clear credentials and exit
  if (values.logout) {
    const { clearAuth } = await import("./auth.js");
    clearAuth();
    return;
  }

  // --login: just authenticate and exit
  if (values.login) {
    let token: string;
    try {
      token = await getToken({ noCache: values["no-cache"] });
    } catch (err: any) {
      if (err instanceof AuthRequiredError) {
        console.error(`\x1b[33m⚠ Authentication required\x1b[0m`);
        console.error(`  devin-bugs needs you to log in via your browser.`);
        console.error(`  Run: \x1b[1mdevin-bugs --login\x1b[0m`);
        console.error(`  Or set DEVIN_TOKEN environment variable for non-interactive use.`);
        process.exit(10);
      }
      throw err;
    }
    console.error("\x1b[32m✓ Authenticated successfully.\x1b[0m");
    console.error(`  Token cached for future use.\n`);
    // Show token expiry
    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1]!, "base64url").toString()
      );
      const exp = new Date(payload.exp * 1000);
      console.error(`  Expires: ${exp.toLocaleString()}`);
    } catch (err) {
      console.error(`\x1b[33m▸ Could not decode token expiry: ${err instanceof Error ? err.message : err}\x1b[0m`);
    }
    return;
  }

  // Require a PR argument
  if (positionals.length === 0) {
    console.error("\x1b[31mError:\x1b[0m Missing PR argument.\n");
    printHelp();
    process.exit(1);
  }

  const prInput = positionals[0]!;
  let pr;
  try {
    pr = parsePR(prInput);
  } catch (err: any) {
    console.error(`\x1b[31mError:\x1b[0m ${err.message}`);
    process.exit(1);
  }

  // Get auth token
  let token: string;
  try {
    token = await getToken({ noCache: values["no-cache"] });
  } catch (err: any) {
    if (err instanceof AuthRequiredError) {
      console.error(`\x1b[33m⚠ Authentication required\x1b[0m`);
      console.error(`  devin-bugs needs you to log in via your browser.`);
      console.error(`  Run: \x1b[1mdevin-bugs --login\x1b[0m`);
      console.error(`  Or set DEVIN_TOKEN environment variable for non-interactive use.`);
      process.exit(10);
    }
    console.error(`\x1b[31mAuth error:\x1b[0m ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // --watch: poll until review completes
  if (values.watch) {
    try {
      const watchStatus = await watchReview(pr.prPath, token, pr);
      if (watchStatus.status === "no_review") {
        console.error(`\x1b[33m○ No Devin review triggered for ${pr.owner}/${pr.repo}#${pr.number}\x1b[0m`);
        process.exit(0);
      }
      if (watchStatus.status === "failed") {
        console.error(`\x1b[31m✗ Devin review failed for ${pr.owner}/${pr.repo}#${pr.number}\x1b[0m`);
        process.exit(0);
      }
      // completed — fall through to fetch digest and show bugs
    } catch (err) {
      if (err instanceof WatchTimeoutError) {
        console.error(`\x1b[31m✗ ${err.message}\x1b[0m`);
        process.exit(1);
      }
      throw err;
    }
  }

  // Fetch digest (with one retry on auth failure)
  let digest;
  try {
    digest = await fetchDigest(pr.prPath, token);
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      // Re-authenticate and retry
      console.error("\x1b[33m▸ Token expired, re-authenticating...\x1b[0m");
      try {
        token = await forceReauth();
        digest = await fetchDigest(pr.prPath, token);
      } catch (retryErr: any) {
        if (retryErr instanceof AuthRequiredError) {
          console.error(`\x1b[33m⚠ Authentication required\x1b[0m`);
          console.error(`  devin-bugs needs you to log in via your browser.`);
          console.error(`  Run: \x1b[1mdevin-bugs --login\x1b[0m`);
          console.error(`  Or set DEVIN_TOKEN environment variable for non-interactive use.`);
          process.exit(10);
        }
        console.error(`\x1b[31mError:\x1b[0m ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
        process.exit(1);
      }
    } else if (err instanceof ApiError) {
      if (err.status === 404) {
        console.error(
          `\x1b[31mError:\x1b[0m PR not found or no Devin review exists for ${pr.owner}/${pr.repo}#${pr.number}`
        );
      } else {
        console.error(`\x1b[31mAPI error ${err.status}:\x1b[0m ${err.body}`);
      }
      process.exit(1);
    } else {
      throw err;
    }
  }

  // --raw: dump full response
  if (values.raw) {
    console.log(JSON.stringify(digest, null, 2));
    return;
  }

  // Always fetch job status for review state
  let reviewStatus: ReviewStatus | undefined;
  try {
    const jobsData = await fetchJobs(pr.prPath, token);
    reviewStatus = getReviewStatus(jobsData);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[33m▸ Could not fetch review status: ${msg}\x1b[0m`);
  }

  // Extract and filter flags
  const flags = extractFlags(digest!, {
    includeAnalysis: values.all,
  });

  // Output
  if (values.json) {
    console.log(formatJSON(flags, reviewStatus));
  } else {
    console.log(formatTerminal(flags, pr, reviewStatus));
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error(`\x1b[31mFatal error:\x1b[0m ${err.message ?? err}`);
  process.exit(1);
});
