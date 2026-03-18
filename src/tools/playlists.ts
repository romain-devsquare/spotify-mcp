import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SpotifyClient } from "../spotify-client.js";

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function errorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

export function registerPlaylistTools(server: McpServer, spotify: SpotifyClient): void {
  server.tool(
    "get_my_playlists",
    "Get the current user's Spotify playlists",
    {
      limit: z.number().min(1).max(50).optional().describe("Max playlists to return (default 50)"),
      offset: z.number().min(0).optional().describe("Offset for pagination (default 0)"),
    },
    async ({ limit, offset }) => {
      try {
        const result = await spotify.getUserPlaylists(limit ?? 50, offset ?? 0);

        // Debug: log raw response shape
        console.error(`Playlists response: total=${result?.total}, items=${result?.items?.length}, keys=${Object.keys(result || {}).join(",")}`);
        if (result?.items?.[0]) {
          console.error(`First item keys: ${Object.keys(result.items[0]).join(",")}`);
        }

        if (!result?.items) {
          return { content: [{ type: "text", text: `Unexpected API response. Raw keys: ${Object.keys(result || {}).join(", ")}` }], isError: true };
        }

        const lines = result.items.map(
          (p) =>
            `- **${p.name}** (${p.tracks?.total ?? "?"} tracks) — ID: \`${p.id}\` | Owner: ${p.owner?.display_name ?? "Unknown"} | ${p.public ? "Public" : "Private"}`
        );
        const text = [
          `Found ${result.total} playlists (showing ${result.offset + 1}-${result.offset + result.items.length}):`,
          "",
          ...lines,
          "",
          result.next ? `More available — use offset=${result.offset + result.limit}` : "No more playlists.",
        ].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  server.tool(
    "get_playlist_tracks",
    "Get tracks from a Spotify playlist with full details",
    {
      playlist_id: z.string().describe("The Spotify playlist ID"),
      limit: z.number().min(1).max(100).optional().describe("Max tracks to return (default 100)"),
      offset: z.number().min(0).optional().describe("Offset for pagination (default 0)"),
    },
    async ({ playlist_id, limit, offset }) => {
      try {
        const result = await spotify.getPlaylistTracks(playlist_id, limit ?? 100, offset ?? 0);
        const lines = result.items
          .filter((item) => item.track)
          .map((item, i) => {
            const t = item.track!;
            const artists = t.artists.map((a) => a.name).join(", ");
            return `${result.offset + i + 1}. **${t.name}** — ${artists} | Album: ${t.album.name} | ${formatDuration(t.duration_ms)} | Popularity: ${t.popularity} | URI: \`${t.uri}\` | ID: \`${t.id}\``;
          });

        const text = [
          `Playlist tracks (${result.total} total, showing ${result.offset + 1}-${result.offset + result.items.length}):`,
          "",
          ...lines,
          "",
          result.next ? `More available — use offset=${result.offset + result.limit}` : "End of playlist.",
        ].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  server.tool(
    "get_all_playlist_tracks",
    "Get ALL tracks from a playlist (handles pagination automatically). Best for full playlist analysis.",
    {
      playlist_id: z.string().describe("The Spotify playlist ID"),
    },
    async ({ playlist_id }) => {
      try {
        const allTracks: Array<{ track: NonNullable<(typeof firstPage.items)[0]["track"]>; added_at: string }> = [];
        let offset = 0;
        const limit = 100;

        const firstPage = await spotify.getPlaylistTracks(playlist_id, limit, offset);
        for (const item of firstPage.items) {
          if (item.track) allTracks.push({ track: item.track, added_at: item.added_at });
        }
        offset += limit;

        while (offset < firstPage.total) {
          const page = await spotify.getPlaylistTracks(playlist_id, limit, offset);
          for (const item of page.items) {
            if (item.track) allTracks.push({ track: item.track, added_at: item.added_at });
          }
          offset += limit;
        }

        const lines = allTracks.map((item, i) => {
          const t = item.track;
          const artists = t.artists.map((a) => a.name).join(", ");
          return `${i + 1}. **${t.name}** — ${artists} | Album: ${t.album.name} (${t.album.release_date}) | ${formatDuration(t.duration_ms)} | Popularity: ${t.popularity} | Explicit: ${t.explicit} | URI: \`${t.uri}\` | ID: \`${t.id}\``;
        });

        const text = [
          `All ${allTracks.length} tracks from playlist:`,
          "",
          ...lines,
        ].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  server.tool(
    "create_playlist",
    "Create a new Spotify playlist",
    {
      name: z.string().describe("Playlist name"),
      description: z.string().optional().describe("Playlist description"),
      public: z.boolean().optional().describe("Whether playlist is public (default false)"),
    },
    async ({ name, description, public: isPublic }) => {
      try {
        const user = await spotify.getCurrentUser();
        const playlist = await spotify.createPlaylist(user.id, name, description, isPublic ?? false);
        const text = [
          `Created playlist: **${playlist.name}**`,
          `ID: \`${playlist.id}\``,
          `URL: ${playlist.external_urls.spotify}`,
          `Owner: ${user.display_name}`,
          `Public: ${playlist.public}`,
        ].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  server.tool(
    "add_tracks_to_playlist",
    "Add tracks to an existing Spotify playlist",
    {
      playlist_id: z.string().describe("The Spotify playlist ID"),
      track_uris: z
        .array(z.string())
        .describe('Array of Spotify track URIs (e.g. ["spotify:track:4iV5W9uYEdYUVa79Axb7Rh"])'),
    },
    async ({ playlist_id, track_uris }) => {
      try {
        await spotify.addTracksToPlaylist(playlist_id, track_uris);
        return {
          content: [
            {
              type: "text",
              text: `Successfully added ${track_uris.length} track(s) to playlist \`${playlist_id}\`.`,
            },
          ],
        };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}
