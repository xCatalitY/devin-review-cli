// ---------------------------------------------------------------------------
// PR reference
// ---------------------------------------------------------------------------

export interface ParsedPR {
  owner: string;
  repo: string;
  number: number;
  /** e.g. "github.com/owner/repo/pull/123" */
  prPath: string;
}

// ---------------------------------------------------------------------------
// Cached auth token
// ---------------------------------------------------------------------------

export interface CachedToken {
  accessToken: string;
  /** epoch ms when token was obtained */
  obtainedAt: number;
  /** epoch ms when token expires (from JWT `exp` claim) */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Devin Digest API response (partial — fields we care about)
// ---------------------------------------------------------------------------

export interface DigestResponse {
  id: number;
  title: string;
  state: string;
  author?: { login: string; avatar_url?: string; is_bot?: boolean };
  head_ref: string;
  base_ref: string;
  additions: number;
  deletions: number;
  review_threads: ReviewThread[];
  comments: ReviewComment[];
  reviews: Review[];
  checks: Check[];
  [key: string]: unknown;
}

export interface ReviewThread {
  is_resolved: boolean;
  is_outdated: boolean;
  resolved_by?: { login: string; avatar_url?: string } | null;
  comments: ReviewComment[];
}

export interface ReviewComment {
  id: number | string;
  body: string;
  body_html?: string;
  /** Non-null means this is a Devin review comment */
  devin_review_id?: string | null;
  /** Structured metadata header hidden from display */
  hidden_header?: string | null;
  html_url?: string | null;
  author?: { login: string; avatar_url?: string; is_bot?: boolean };
  pull_request_review?: { id: number; state: string } | null;
  reaction_groups?: unknown[];
  [key: string]: unknown;
}

export interface Review {
  id: number;
  body: string;
  body_html?: string;
  state: string;
  author?: { login: string; avatar_url?: string; is_bot?: boolean };
  devin_review_id?: string | null;
  [key: string]: unknown;
}

export interface Check {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  workflow_name?: string;
  is_required?: boolean;
}

// ---------------------------------------------------------------------------
// Extracted bug/flag
// ---------------------------------------------------------------------------

export interface LifeguardFlag {
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  side: "LEFT" | "RIGHT";
  title: string;
  description: string;
  severity: string;
  recommendation: string;
  needsInvestigation: boolean;
  type: "lifeguard-bug" | "lifeguard-analysis";
  /** Source thread resolution status */
  isResolved: boolean;
  isOutdated: boolean;
  /** URL to the comment on GitHub */
  htmlUrl: string | null;
}
