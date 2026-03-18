#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SpotifyClient } from "./spotify-client.js";
import { registerPlaylistTools } from "./tools/playlists.js";
import { registerTrackTools } from "./tools/tracks.js";

const server = new McpServer({
  name: "spotify",
  version: "1.0.0",
});

const spotify = new SpotifyClient();

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
