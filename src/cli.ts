#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { parsePR } from "./parse-pr.js";
import { getToken, forceReauth } from "./auth.js";
import { fetchDigest, AuthExpiredError, ApiError } from "./api.js";
import { extractFlags } from "./filter.js";
import { formatTerminal, formatJSON } from "./format.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const HELP = `
  \x1b[1mdevin-bugs\x1b[0m — Extract unresolved bugs from Devin AI code reviews

  \x1b[1mUsage:\x1b[0m
    devin-bugs <pr> [options]

  \x1b[1mArguments:\x1b[0m
    pr              GitHub PR URL or shorthand
                    Examples: owner/repo#123
                              https://github.com/owner/repo/pull/123
                              https://app.devin.ai/review/owner/repo/pull/123

  \x1b[1mOptions:\x1b[0m
    --json          Output as JSON (for piping)
    --all           Include analysis/suggestions, not just bugs
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
  console.log("devin-bugs 0.3.1");
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
    const token = await getToken({ noCache: values["no-cache"] });
    console.error("\x1b[32m✓ Authenticated successfully.\x1b[0m");
    console.error(`  Token cached for future use.\n`);
    // Show token expiry
    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1]!, "base64url").toString()
      );
      const exp = new Date(payload.exp * 1000);
      console.error(`  Expires: ${exp.toLocaleString()}`);
    } catch {
      // ignore
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
    console.error(`\x1b[31mAuth error:\x1b[0m ${err.message}`);
    process.exit(1);
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
        console.error(`\x1b[31mError:\x1b[0m ${retryErr.message}`);
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

  // Extract and filter flags
  const flags = extractFlags(digest!, {
    includeAnalysis: values.all,
  });

  // Output
  if (values.json) {
    console.log(formatJSON(flags));
  } else {
    console.log(formatTerminal(flags, pr));
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error(`\x1b[31mFatal error:\x1b[0m ${err.message ?? err}`);
  process.exit(1);
});
