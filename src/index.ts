#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SpotifyClient } from "./spotify-client.js";
import { startAuthFlow, waitForPendingAuth } from "./auth.js";
import { registerPlaylistTools } from "./tools/playlists.js";
import { registerTrackTools } from "./tools/tracks.js";

// Prevent ANY crash from killing the server
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (server stays running):", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (server stays running):", err);
});

// Keep process alive — prevent exit when event loop is empty
const keepAlive = setInterval(() => {}, 60_000 * 30);
keepAlive.unref(); // don't prevent clean exit when stdio closes

// Log when process is about to exit (for debugging)
process.on("exit", (code) => {
  console.error(`Process exiting with code ${code}`);
});

process.on("SIGTERM", () => {
  console.error("Received SIGTERM");
});

process.on("SIGINT", () => {
  console.error("Received SIGINT");
});

// Prevent broken pipe from crashing the server
process.stdout.on("error", (err) => {
  if ((err as NodeJS.ErrnoException).code === "EPIPE") {
    console.error("stdout EPIPE — client disconnected");
  }
});

process.stdin.on("error", (err) => {
  console.error("stdin error:", err);
});

const server = new McpServer({
  name: "spotify",
  version: "1.0.0",
});

const spotify = new SpotifyClient();

// Auth tool — starts the OAuth flow and returns the URL for the user to open
server.tool(
  "spotify_auth",
  "Connect to Spotify. Returns an authorization URL to open in the browser. Call this first before using other Spotify tools.",
  {},
  async () => {
    try {
      const authUrl = startAuthFlow();
      return {
        content: [
          {
            type: "text",
            text: [
              "Please open this URL in your browser to connect Spotify:",
              "",
              authUrl,
              "",
              "After you authorize in the browser and see 'Connected to Spotify!', call the `spotify_auth_complete` tool.",
            ].join("\n"),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Auth error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// Auth complete tool — waits for the OAuth callback
server.tool(
  "spotify_auth_complete",
  "Complete Spotify authorization after the user has approved access in the browser. Call this after spotify_auth.",
  {},
  async () => {
    try {
      const token = await waitForPendingAuth();
      return {
        content: [
          {
            type: "text",
            text: "Successfully connected to Spotify! You can now use all Spotify tools.",
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Auth error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

registerPlaylistTools(server, spotify);
registerTrackTools(server, spotify);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Spotify MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
