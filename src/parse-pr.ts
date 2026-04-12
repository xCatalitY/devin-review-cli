import type { ParsedPR } from "./types.js";

const GITHUB_URL_RE =
  /(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const SHORTHAND_RE = /^([^/#]+)\/([^/#]+)#(\d+)$/;
const PATH_RE = /^([^/#]+)\/([^/#]+)\/pull\/(\d+)$/;

/** Also accept Devin review URLs: app.devin.ai/review/owner/repo/pull/123 */
const DEVIN_URL_RE =
  /(?:https?:\/\/)?app\.devin\.ai\/review\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

export function parsePR(input: string): ParsedPR {
  const match =
    input.match(GITHUB_URL_RE) ??
    input.match(DEVIN_URL_RE) ??
    input.match(SHORTHAND_RE) ??
    input.match(PATH_RE);

  if (!match) {
    throw new Error(
      `Invalid PR reference: ${input}\n` +
        `Expected: owner/repo#123 or https://github.com/owner/repo/pull/123`
    );
  }

  const [, owner, repo, num] = match;
  return {
    owner: owner!,
    repo: repo!,
    number: parseInt(num!, 10),
    prPath: `github.com/${owner}/${repo}/pull/${num}`,
  };
}
