import { execFileSync } from "node:child_process";
import type { ParsedPR } from "./types.js";

const GITHUB_URL_RE =
  /(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const SHORTHAND_RE = /^([^/#]+)\/([^/#]+)#(\d+)$/;
const PATH_RE = /^([^/#]+)\/([^/#]+)\/pull\/(\d+)$/;
const BARE_NUMBER_RE = /^#?(\d+)$/;

/** Also accept Devin review URLs: app.devin.ai/review/owner/repo/pull/123 */
const DEVIN_URL_RE =
  /(?:https?:\/\/)?app\.devin\.ai\/review\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

/**
 * Try to infer owner/repo from the current git remote.
 * Returns null if not in a git repo or remote isn't GitHub.
 */
function inferRepoFromGit(): { owner: string; repo: string } | null {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // HTTPS: https://github.com/owner/repo.git
    const https = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (https) return { owner: https[1]!, repo: https[2]! };

    // SSH: git@github.com:owner/repo.git
    const ssh = url.match(/github\.com:([^/]+)\/([^/.]+)/);
    if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
  } catch {
    // Not a git repo or no remote
  }
  return null;
}

export function parsePR(input: string): ParsedPR {
  const match =
    input.match(GITHUB_URL_RE) ??
    input.match(DEVIN_URL_RE) ??
    input.match(SHORTHAND_RE) ??
    input.match(PATH_RE);

  if (match) {
    const [, owner, repo, num] = match;
    return {
      owner: owner!,
      repo: repo!,
      number: parseInt(num!, 10),
      prPath: `github.com/${owner}/${repo}/pull/${num}`,
    };
  }

  // Try bare PR number (e.g. "49" or "#49") — infer repo from git remote
  const bareMatch = input.match(BARE_NUMBER_RE);
  if (bareMatch) {
    const git = inferRepoFromGit();
    if (git) {
      const num = bareMatch[1]!;
      return {
        owner: git.owner,
        repo: git.repo,
        number: parseInt(num, 10),
        prPath: `github.com/${git.owner}/${git.repo}/pull/${num}`,
      };
    }
    throw new Error(
      `Cannot resolve PR #${bareMatch[1]} — not in a GitHub repo.\n` +
        `Use the full form: owner/repo#${bareMatch[1]}`
    );
  }

  throw new Error(
    `Invalid PR reference: ${input}\n` +
      `Expected: owner/repo#123, #123 (in a git repo), or https://github.com/owner/repo/pull/123`
  );
}
