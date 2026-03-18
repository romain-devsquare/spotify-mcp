import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

const TOKEN_PATH = join(homedir(), ".spotify-mcp-tokens.json");
const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-read-private",
  "user-library-read",
].join(" ");

let cachedToken: TokenData | null = null;
let refreshPromise: Promise<TokenData> | null = null;

// Singleton auth flow state
let activeAuthServer: Server | null = null;
let activeAuthPromise: Promise<TokenData> | null = null;
let activeAuthUrl: string | null = null;

function getClientId(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  if (!id) {
    throw new Error(
      "SPOTIFY_CLIENT_ID environment variable is required. " +
        "Create an app at https://developer.spotify.com/dashboard and set the client ID."
    );
  }
  return id;
}

function getRedirectPort(): number {
  return parseInt(process.env.SPOTIFY_REDIRECT_PORT || "8888", 10);
}

function getRedirectUri(): string {
  return `http://127.0.0.1:${getRedirectPort()}/callback`;
}

async function loadTokenFromDisk(): Promise<TokenData | null> {
  try {
    const data = await readFile(TOKEN_PATH, "utf-8");
    return JSON.parse(data) as TokenData;
  } catch {
    return null;
  }
}

async function saveTokenToDisk(token: TokenData): Promise<void> {
  await writeFile(TOKEN_PATH, JSON.stringify(token, null, 2), "utf-8");
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateCodeVerifier(): string {
  return base64url(randomBytes(48));
}

function generateCodeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;
  if (platform === "win32") {
    command = `start "" "${url}"`;
  } else if (platform === "darwin") {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }
  exec(command, (err) => {
    if (err) {
      console.error("Could not open browser automatically.");
    }
  });
}

function cleanupAuthFlow(): void {
  if (activeAuthServer) {
    try { activeAuthServer.close(); } catch {}
    activeAuthServer = null;
  }
  activeAuthPromise = null;
  activeAuthUrl = null;
}

/**
 * Start the PKCE auth flow. Returns the auth URL.
 * Only one flow can be active at a time — calling again reuses the existing one.
 */
export function startAuthFlow(): string {
  // If there's already an active flow, return its URL
  if (activeAuthUrl && activeAuthPromise) {
    return activeAuthUrl;
  }

  // Clean up any stale state
  cleanupAuthFlow();

  const clientId = getClientId();
  const port = getRedirectPort();
  const redirectUri = getRedirectUri();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString("hex");

  const authUrl = new URL(SPOTIFY_AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);

  activeAuthUrl = authUrl.toString();

  activeAuthPromise = new Promise<TokenData>((resolve, reject) => {
    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400);
          res.end(`Authorization error: ${error}`);
          cleanupAuthFlow();
          reject(new Error(`Spotify authorization error: ${error}`));
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400);
          res.end("State mismatch");
          cleanupAuthFlow();
          reject(new Error("OAuth state mismatch"));
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end("Missing authorization code");
          cleanupAuthFlow();
          reject(new Error("Missing authorization code"));
          return;
        }

        const tokenResponse = await fetch(SPOTIFY_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: codeVerifier,
          }),
        });

        if (!tokenResponse.ok) {
          const errorBody = await tokenResponse.text();
          res.writeHead(500);
          res.end("Token exchange failed");
          cleanupAuthFlow();
          reject(new Error(`Token exchange failed: ${errorBody}`));
          return;
        }

        const tokenData = (await tokenResponse.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in: number;
        };

        const token: TokenData = {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: Date.now() + tokenData.expires_in * 1000,
        };

        await saveTokenToDisk(token);
        cachedToken = token;

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
              <div style="text-align: center;">
                <h1>&#10003; Connected to Spotify!</h1>
                <p>You can close this window and return to Claude.</p>
              </div>
            </body>
          </html>
        `);
        cleanupAuthFlow();
        resolve(token);
      } catch (err) {
        cleanupAuthFlow();
        reject(err);
      }
    });

    // Prevent the HTTP server from keeping the process alive on its own
    httpServer.unref();

    httpServer.listen(port, "127.0.0.1", () => {
      console.error(`Auth server listening on 127.0.0.1:${port}`);
      openBrowser(activeAuthUrl!);
    });

    httpServer.on("error", (err) => {
      console.error("Auth server error:", err);
      cleanupAuthFlow();
      reject(new Error(`Could not start auth server on port ${port}: ${err.message}`));
    });

    activeAuthServer = httpServer;

    // Timeout after 5 minutes
    setTimeout(() => {
      if (activeAuthPromise === activeAuthPromise) {
        cleanupAuthFlow();
        reject(new Error("OAuth flow timed out after 5 minutes. Call spotify_auth to try again."));
      }
    }, 300_000);
  });

  // Prevent unhandled rejection from crashing the process
  activeAuthPromise.catch(() => {});

  return activeAuthUrl;
}

/**
 * Wait for the active auth flow to complete.
 */
export async function waitForPendingAuth(): Promise<string> {
  if (activeAuthPromise) {
    const token = await activeAuthPromise;
    return token.access_token;
  }
  throw new Error("No pending auth flow. Please call spotify_auth first.");
}

/**
 * Check if auth is needed (no valid token available).
 */
export function isAuthNeeded(): boolean {
  return !cachedToken || cachedToken.expires_at <= Date.now() + 60_000;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenData> {
  const clientId = getClientId();

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Token refresh failed: ${errorBody}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const token: TokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  await saveTokenToDisk(token);
  cachedToken = token;
  return token;
}

/**
 * Get a valid access token. Loads from disk, refreshes if needed.
 * Throws a descriptive error if no token exists (user must call spotify_auth).
 */
export async function getValidToken(): Promise<string> {
  // Use cached token if still valid (with 60s buffer)
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) {
    return cachedToken.access_token;
  }

  // Try loading from disk
  if (!cachedToken) {
    cachedToken = await loadTokenFromDisk();
  }

  // Check if loaded token is valid
  if (cachedToken && cachedToken.expires_at > Date.now() + 60_000) {
    return cachedToken.access_token;
  }

  // Try refreshing
  if (cachedToken?.refresh_token) {
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken(cachedToken.refresh_token).finally(() => {
        refreshPromise = null;
      });
    }
    try {
      const token = await refreshPromise;
      return token.access_token;
    } catch (err) {
      console.error("Token refresh failed:", err);
      cachedToken = null;
    }
  }

  // No valid token — tell the user to authenticate via the auth tool
  throw new Error(
    "Not connected to Spotify. Please ask Claude to use the `spotify_auth` tool first to connect your account."
  );
}
