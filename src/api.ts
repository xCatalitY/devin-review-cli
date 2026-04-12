import { DEVIN_API_BASE } from "./config.js";
import type { DigestResponse } from "./types.js";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class AuthExpiredError extends Error {
  constructor() {
    super("Authentication expired. Re-authenticating...");
    this.name = "AuthExpiredError";
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`Devin API error ${status}: ${body}`);
    this.name = "ApiError";
  }
}

// ---------------------------------------------------------------------------
// Generic request helper
// ---------------------------------------------------------------------------

async function apiRequest<T>(path: string, token: string): Promise<T> {
  const url = `${DEVIN_API_BASE}/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new AuthExpiredError();
    }
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export async function fetchDigest(
  prPath: string,
  token: string
): Promise<DigestResponse> {
  return apiRequest<DigestResponse>(
    `pr-review/digest?pr_path=${encodeURIComponent(prPath)}`,
    token
  );
}

export async function fetchPRInfo(
  prPath: string,
  token: string
): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(
    `pr-review/info?pr_path=${encodeURIComponent(prPath)}`,
    token
  );
}

export async function fetchJobs(
  prPath: string,
  token: string
): Promise<{ jobs: unknown[] }> {
  return apiRequest<{ jobs: unknown[] }>(
    `pr-review/jobs?pr_path=${encodeURIComponent(prPath)}`,
    token
  );
}
