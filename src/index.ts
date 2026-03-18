#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SpotifyClient } from "./spotify-client.js";
import { startAuthFlow, waitForPendingAuth, AuthError } from "./auth.js";
import { registerPlaylistTools } from "./tools/playlists.js";
import { registerTrackTools } from "./tools/tracks.js";

// Prevent unhandled rejections from crashing the server
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (server stays running):", err);
});

const server = new McpServer({
  name: "spotify",
  version: "1.0.0",
});

const spotify = new SpotifyClient();

// Auth tool — starts the OAuth flow and returns the URL for the user to open
server.tool(
  "spotify_auth",
  "Connect to Spotify. Opens a browser for authorization. Call this first if other tools return auth errors.",
  {},
  async () => {
    try {
      const { authUrl } = startAuthFlow();
      return {
        content: [
          {
            type: "text",
            text: [
              "Please open this URL in your browser to connect Spotify:",
              "",
              authUrl,
              "",
              "After you authorize in the browser, call the `spotify_auth_complete` tool to finish connecting.",
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

// Auth complete tool — waits for the OAuth callback after user authorized in browser
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
            text: `Successfully connected to Spotify! You can now use all Spotify tools. (Token starts with ${token.substring(0, 8)}...)`,
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
