import { homedir } from "node:os";
import { join } from "node:path";

export const DEVIN_API_BASE = "https://app.devin.ai/api";
export const DEVIN_APP_URL = "https://app.devin.ai";
export const DEVIN_LOGIN_URL = "https://app.devin.ai/auth/login";

export const CONFIG_DIR = join(homedir(), ".config", "devin-bugs");
export const CACHE_DIR = join(homedir(), ".cache", "devin-bugs");
export const TOKEN_PATH = join(CONFIG_DIR, "token.json");
export const BROWSER_DATA_DIR = join(CACHE_DIR, "browser-profile");

/** Refresh token if less than this many seconds until expiry */
export const TOKEN_REFRESH_MARGIN_SEC = 300;
