import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
let pendingAuthFlow: Promise<TokenData> | null = null;

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
  // Use platform-specific commands to open browser, more reliable than 'open' package in subprocess context
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

export class AuthError extends Error {
  public authUrl: string;
  constructor(authUrl: string) {
    super(
      `Spotify authentication required. Please open this URL in your browser to connect:\n\n${authUrl}\n\nAfter authorizing, try your request again.`
    );
    this.name = "AuthError";
    this.authUrl = authUrl;
  }
}

/**
 * Start the PKCE auth flow: spins up a local server, opens the browser, and waits for callback.
 * Returns the auth URL so it can be shown to the user.
 */
export function startAuthFlow(): { authUrl: string; waitForToken: Promise<TokenData> } {
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

  const waitForToken = new Promise<TokenData>((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url || "/", `http://localhost:${port}`);
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
          server.close();
          pendingAuthFlow = null;
          reject(new Error(`Spotify authorization error: ${error}`));
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400);
          res.end("State mismatch");
          server.close();
          pendingAuthFlow = null;
          reject(new Error("OAuth state mismatch"));
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end("Missing authorization code");
          server.close();
          pendingAuthFlow = null;
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
          server.close();
          pendingAuthFlow = null;
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
        server.close();
        pendingAuthFlow = null;
        resolve(token);
      } catch (err) {
        server.close();
        pendingAuthFlow = null;
        reject(err);
      }
    });

    server.listen(port, () => {
      console.error(`Auth server listening on port ${port}`);
      console.error(`Auth URL: ${authUrl.toString()}`);
      openBrowser(authUrl.toString());
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      pendingAuthFlow = null;
      reject(new Error("OAuth flow timed out after 5 minutes. Please try again."));
    }, 300_000);
  });

  // Prevent unhandled rejection from crashing the process
  waitForToken.catch(() => {});
  pendingAuthFlow = waitForToken;
  return { authUrl: authUrl.toString(), waitForToken };
}

/**
 * Wait for a pending auth flow to complete (called after user has been shown the URL).
 */
export async function waitForPendingAuth(): Promise<string> {
  if (pendingAuthFlow) {
    const token = await pendingAuthFlow;
    return token.access_token;
  }
  throw new Error("No pending auth flow. Please call spotify_auth first.");
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
      console.error("Token refresh failed, starting new auth flow:", err);
      cachedToken = null;
    }
  }

  // No valid token — throw AuthError so the tool can return the URL to the user
  const { authUrl } = startAuthFlow();
  throw new AuthError(authUrl);
}
