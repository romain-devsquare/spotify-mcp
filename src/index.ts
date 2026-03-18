#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SpotifyClient } from "./spotify-client.js";
import { startAuthFlow, waitForPendingAuth } from "./auth.js";
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
