import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import {
  TOKEN_PATH,
  DEVIN_APP_URL,
  TOKEN_REFRESH_MARGIN_SEC,
} from "./config.js";
import type { CachedToken } from "./types.js";

// ---------------------------------------------------------------------------
// Auth errors
// ---------------------------------------------------------------------------

/**
 * Thrown when authentication is required but we're in a non-interactive
 * context (CI, piped stdin, DEVIN_BUGS_NONINTERACTIVE). The CLI should
 * catch this and exit with code 10.
 */
export class AuthRequiredError extends Error {
  constructor() {
    super(
      "Authentication required\n" +
      "  devin-bugs needs you to log in via your browser.\n" +
      "  Run: devin-bugs --login\n" +
      "  Or set DEVIN_TOKEN environment variable for non-interactive use."
    );
    this.name = "AuthRequiredError";
  }
}

/** Detect non-interactive context where browser login can't work. */
function isNonInteractive(): boolean {
  return (
    !!process.env.CI ||
    !!process.env.DEVIN_BUGS_NONINTERACTIVE ||
    !process.stdin.isTTY
  );
}

// ---------------------------------------------------------------------------
// JWT helpers (no library — just decode the payload for `exp`)
// ---------------------------------------------------------------------------

function base64UrlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function decodeTokenExpiry(jwt: string): number {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  const payload = JSON.parse(base64UrlDecode(parts[1]!));
  if (typeof payload.exp !== "number") throw new Error("JWT missing exp claim");
  return payload.exp * 1000; // convert to epoch ms
}

// ---------------------------------------------------------------------------
// Token cache (disk)
// ---------------------------------------------------------------------------

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function readCachedToken(): CachedToken | null {
  try {
    if (!existsSync(TOKEN_PATH)) return null;
    const raw = readFileSync(TOKEN_PATH, "utf-8");
    const parsed = JSON.parse(raw) as CachedToken;
    if (!parsed.accessToken || !parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedToken(
  accessToken: string,
  auth0Cache?: Record<string, string>
): CachedToken {
  ensureDir(dirname(TOKEN_PATH));
  const expiresAt = decodeTokenExpiry(accessToken);
  const cached: CachedToken = {
    accessToken,
    obtainedAt: Date.now(),
    expiresAt,
    ...(auth0Cache && Object.keys(auth0Cache).length > 0 ? { auth0Cache } : {}),
  };
  writeFileSync(TOKEN_PATH, JSON.stringify(cached, null, 2));
  return cached;
}

// ---------------------------------------------------------------------------
// Refresh token flow
// ---------------------------------------------------------------------------

/**
 * Try to refresh the access token using stored Auth0 cache data.
 *
 * Auth0 SPA SDK stores tokens in localStorage under keys like:
 *   @@auth0spajs@@::{clientId}::{audience}::{scope}
 * The value is JSON with { body: { refresh_token, ... } }
 *
 * To refresh, POST to https://{domain}/oauth/token with:
 *   { grant_type: "refresh_token", client_id, refresh_token }
 *
 * We extract clientId from the cache key and domain from the
 * `auth0.{clientId}.is.authenticated` cookie name pattern.
 */
async function tryRefreshToken(cached: CachedToken): Promise<string | null> {
  if (!cached.auth0Cache) return null;

  // Find the @@auth0spajs@@ entry with a refresh_token
  let refreshToken: string | null = null;
  let clientId: string | null = null;
  let audience: string | null = null;

  for (const [key, value] of Object.entries(cached.auth0Cache)) {
    if (!key.startsWith("@@auth0spajs@@")) continue;

    // Key format: @@auth0spajs@@::{clientId}::{audience}::{scope}
    const parts = key.split("::");
    const keyClientId = parts[1];
    const keyAudience = parts[2];

    try {
      const parsed = JSON.parse(value) as {
        body?: { refresh_token?: string; [k: string]: unknown };
      };
      if (parsed.body?.refresh_token) {
        refreshToken = parsed.body.refresh_token;
        clientId = keyClientId ?? null;
        audience = keyAudience ?? null;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!refreshToken || !clientId) return null;

  // Extract Auth0 domain from the JWT issuer claim (e.g. "https://auth.devin.ai/")
  let domain: string | null = null;
  try {
    const payload = JSON.parse(base64UrlDecode(cached.accessToken.split(".")[1]!));
    if (typeof payload.iss === "string") {
      domain = new URL(payload.iss).hostname;
    }
  } catch {
    // ignore
  }

  if (!domain) {
    console.error("\x1b[33m▸ Could not determine Auth0 domain for token refresh.\x1b[0m");
    return null;
  }

  // Call Auth0 token endpoint
  try {
    const tokenUrl = `https://${domain}/oauth/token`;
    console.error(`\x1b[33m▸ Refreshing token via ${tokenUrl}\x1b[0m`);
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
        ...(audience ? { audience } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`\x1b[33m▸ Refresh failed (${res.status}): ${body.slice(0, 100)}\x1b[0m`);
      return null;
    }

    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
    };

    if (!data.access_token) return null;

    // Update the cached auth0 entry with new refresh token if rotated
    if (data.refresh_token && cached.auth0Cache) {
      for (const [key, value] of Object.entries(cached.auth0Cache)) {
        if (!key.startsWith("@@auth0spajs@@")) continue;
        try {
          const parsed = JSON.parse(value);
          if (parsed.body?.refresh_token) {
            parsed.body.refresh_token = data.refresh_token;
            parsed.body.access_token = data.access_token;
            cached.auth0Cache[key] = JSON.stringify(parsed);
            break;
          }
        } catch {
          continue;
        }
      }
    }

    console.error("\x1b[32m✓ Token refreshed!\x1b[0m\n");
    return data.access_token;
  } catch (err) {
    console.error(`\x1b[33m▸ Refresh error: ${err instanceof Error ? err.message : err}\x1b[0m`);
    return null;
  }
}

function clearCachedToken(): void {
  try {
    if (existsSync(TOKEN_PATH)) unlinkSync(TOKEN_PATH);
  } catch {
    // ignore
  }
}

function isTokenValid(cached: CachedToken): boolean {
  return cached.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_SEC * 1000;
}

// ---------------------------------------------------------------------------
// Open URL in system browser (safe — no shell interpolation)
// ---------------------------------------------------------------------------

function openBrowser(url: string): void {
  const opener =
    process.platform === "darwin"
      ? { cmd: "open", args: [url] }
      : process.platform === "win32"
        ? { cmd: "cmd", args: ["/c", "start", "", url] }
        : { cmd: "xdg-open", args: [url] };

  execFile(opener.cmd, opener.args, (err) => {
    if (err) {
      console.error(`\x1b[33m▸ Could not open browser automatically.\x1b[0m`);
      console.error(`  Open this URL manually: ${url}\n`);
    }
  });
}

// ---------------------------------------------------------------------------
// Local callback server
// ---------------------------------------------------------------------------

/**
 * The capture page served at localhost. It instructs the user to:
 * 1. Log in to Devin in a new tab
 * 2. Paste a one-liner in the browser console that sends the token back
 *
 * This is the same pattern as many CLIs that can't do standard OAuth.
 * The one-liner calls __HACK__getAccessToken() on app.devin.ai and
 * POSTs the result to our localhost callback.
 */
function buildCapturePage(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>devin-bugs — Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #141414; color: #e0e0e0;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 2rem;
    }
    .card {
      background: #1e1e1e; border: 1px solid #333; border-radius: 12px;
      padding: 2.5rem; max-width: 560px; width: 100%;
    }
    h1 { font-size: 1.25rem; color: #fff; margin-bottom: 0.5rem; }
    .subtitle { color: #888; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .step {
      display: flex; gap: 0.75rem; margin-bottom: 1.25rem;
      padding: 0.75rem; border-radius: 8px; background: #252525;
    }
    .step-num {
      flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%;
      background: #3b82f6; color: #fff; font-size: 0.75rem; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .step-text { font-size: 0.9rem; line-height: 1.5; }
    .step-text a { color: #60a5fa; text-decoration: none; }
    .step-text a:hover { text-decoration: underline; }
    code {
      background: #0d1117; color: #7ee787; padding: 0.5rem 0.75rem;
      border-radius: 6px; display: block; font-size: 0.8rem;
      margin-top: 0.5rem; cursor: pointer; border: 1px solid #333;
      word-break: break-all; position: relative;
    }
    code:hover { border-color: #3b82f6; }
    code::after {
      content: 'click to copy'; position: absolute; right: 8px; top: 8px;
      font-size: 0.65rem; color: #888; font-family: sans-serif;
    }
    .success {
      display: none; padding: 1rem; border-radius: 8px;
      background: #052e16; border: 1px solid #16a34a; text-align: center;
    }
    .success h2 { color: #4ade80; font-size: 1rem; }
    .success p { color: #86efac; font-size: 0.85rem; margin-top: 0.5rem; }
    .waiting {
      text-align: center; padding: 1rem; color: #888;
      font-size: 0.85rem; margin-top: 0.5rem;
    }
    .dot { animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
  </style>
</head>
<body>
  <div class="card">
    <h1>devin-bugs</h1>
    <p class="subtitle">Authenticate with Devin to extract PR review data</p>

    <div id="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text">
          <a href="${DEVIN_APP_URL}" target="_blank" rel="noopener">
            Open app.devin.ai</a> and log in with GitHub
        </div>
      </div>

      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text">
          Open the browser console (<strong>F12</strong> → Console tab) and paste:
          <code id="snippet" onclick="copySnippet()">{let t=await __HACK__getAccessToken(),c={};for(let i=0;i&lt;localStorage.length;i++){let k=localStorage.key(i);if(k&amp;&amp;k.includes('auth0'))c[k]=localStorage.getItem(k)}fetch('http://localhost:${port}/callback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t,auth0Cache:c})}).then(()=>document.title='✓ Token sent!')}</code>
        </div>
      </div>

      <div class="waiting">
        Waiting for token<span class="dot">...</span>
      </div>
    </div>

    <div class="success" id="success">
      <h2>✓ Authentication successful!</h2>
      <p>You can close this tab and return to your terminal.</p>
    </div>
  </div>

  <script>
    function copySnippet() {
      navigator.clipboard.writeText(document.getElementById('snippet').textContent);
      const el = document.getElementById('snippet');
      el.style.borderColor = '#4ade80';
      setTimeout(() => el.style.borderColor = '#333', 1500);
    }

    // Poll the local server to check if token was received
    async function poll() {
      try {
        const res = await fetch('/status');
        const data = await res.json();
        if (data.received) {
          document.getElementById('steps').style.display = 'none';
          document.getElementById('success').style.display = 'block';
          return;
        }
      } catch {}
      setTimeout(poll, 1500);
    }
    poll();
  </script>
</body>
</html>`;
}

/**
 * Start a local HTTP server that:
 * - Serves the capture page at /
 * - Receives the token at POST /callback (from the console one-liner)
 * - Reports status at GET /status (for the page to poll)
 */
function startCallbackServer(): Promise<{
  token: string;
  auth0Cache?: Record<string, string>;
  server: Server;
}> {
  return new Promise((resolve, reject) => {
    let receivedToken: string | null = null;

    const server = createServer((req, res) => {
      // CORS headers for cross-origin fetch from app.devin.ai
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && req.url === "/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: receivedToken !== null }));
        return;
      }

      if (req.method === "POST" && req.url === "/callback") {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString()));
        req.on("end", () => {
          try {
            const data = JSON.parse(body) as {
              token?: string;
              auth0Cache?: Record<string, string>;
            };
            if (typeof data.token === "string" && data.token.length > 20) {
              receivedToken = data.token;
              const auth0Cache = data.auth0Cache;
              if (auth0Cache && Object.keys(auth0Cache).length > 0) {
                console.error(
                  `\x1b[36m▸ Captured ${Object.keys(auth0Cache).length} Auth0 cache entries\x1b[0m`
                );
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true }));
              setTimeout(() => {
                server.close();
                resolve({ token: receivedToken!, auth0Cache, server });
              }, 500);
              return;
            }
          } catch {}
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid token" }));
        });
        return;
      }

      // Serve the capture page
      if (req.method === "GET" && (req.url === "/" || req.url === "/login")) {
        const port = (server.address() as { port: number }).port;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(buildCapturePage(port));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const port = addr.port;

      console.error(`\x1b[33m▸ Opening browser for Devin login...\x1b[0m`);
      console.error(`  Local server: http://localhost:${port}\n`);

      openBrowser(`http://localhost:${port}`);

      // Timeout after 5 minutes
      setTimeout(() => {
        if (!receivedToken) {
          server.close();
          reject(new Error("Login timed out after 5 minutes."));
        }
      }, 5 * 60 * 1000);
    });

    server.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GetTokenOptions {
  noCache?: boolean;
}

/**
 * Get a valid Devin API auth token. Strategy:
 * 1. DEVIN_TOKEN env var (for CI/scripts)
 * 2. Cached token from disk (if not expired)
 * 3. Refresh token (if cached Auth0 data has a refresh_token)
 * 4. Interactive login via system browser + localhost callback
 */
export async function getToken(opts?: GetTokenOptions): Promise<string> {
  // 1. Environment variable override
  const envToken = process.env["DEVIN_TOKEN"];
  if (envToken && envToken.length > 0) {
    return envToken;
  }

  // 2. Cached token (still valid)
  if (!opts?.noCache) {
    const cached = readCachedToken();
    if (cached && isTokenValid(cached)) {
      return cached.accessToken;
    }

    // 3. Try refresh token (cached but expired access token)
    if (cached?.auth0Cache) {
      const refreshed = await tryRefreshToken(cached);
      if (refreshed) {
        writeCachedToken(refreshed, cached.auth0Cache);
        return refreshed;
      }
    }
  }

  // 4. Interactive login via browser (only if interactive)
  if (isNonInteractive()) {
    throw new AuthRequiredError();
  }

  const { token, auth0Cache } = await startCallbackServer();
  console.error("\x1b[32m✓ Authentication successful!\x1b[0m\n");
  writeCachedToken(token, auth0Cache);
  return token;
}

/** Force re-authentication by clearing cache and launching browser */
export async function forceReauth(): Promise<string> {
  clearCachedToken();

  if (isNonInteractive()) {
    throw new AuthRequiredError();
  }

  const { token, auth0Cache } = await startCallbackServer();
  console.error("\x1b[32m✓ Authentication successful!\x1b[0m\n");
  writeCachedToken(token, auth0Cache);
  return token;
}

/** Clear stored credentials */
export function clearAuth(): void {
  clearCachedToken();
  console.error("Cleared cached token.");
}
