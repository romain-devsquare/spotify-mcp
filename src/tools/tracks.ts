import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SpotifyClient, type SpotifyAudioFeatures } from "../spotify-client.js";

const KEY_NAMES = ["C", "C#/Db", "D", "D#/Eb", "E", "F", "F#/Gb", "G", "G#/Ab", "A", "A#/Bb", "B"];

function formatAudioFeatures(f: SpotifyAudioFeatures): string {
  const key = f.key >= 0 ? KEY_NAMES[f.key] : "Unknown";
  const mode = f.mode === 1 ? "Major" : "Minor";
  return [
    `  BPM/Tempo: ${Math.round(f.tempo)}`,
    `  Key: ${key} ${mode}`,
    `  Time Signature: ${f.time_signature}/4`,
    `  Energy: ${(f.energy * 100).toFixed(0)}%`,
    `  Danceability: ${(f.danceability * 100).toFixed(0)}%`,
    `  Valence (happiness): ${(f.valence * 100).toFixed(0)}%`,
    `  Acousticness: ${(f.acousticness * 100).toFixed(0)}%`,
    `  Instrumentalness: ${(f.instrumentalness * 100).toFixed(0)}%`,
    `  Liveness: ${(f.liveness * 100).toFixed(0)}%`,
    `  Speechiness: ${(f.speechiness * 100).toFixed(0)}%`,
    `  Loudness: ${f.loudness.toFixed(1)} dB`,
  ].join("\n");
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function errorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
}

export function registerTrackTools(server: McpServer, spotify: SpotifyClient): void {
  server.tool(
    "search_tracks",
    "Search for tracks on Spotify",
    {
      query: z.string().describe("Search query (track name, artist, etc.)"),
      limit: z.number().min(1).max(50).optional().describe("Max results to return (default 20)"),
    },
    async ({ query, limit }) => {
      try {
        const result = await spotify.searchTracks(query, limit ?? 20);
        const lines = result.tracks.items.map((t, i) => {
          const artists = t.artists.map((a) => a.name).join(", ");
          return `${i + 1}. **${t.name}** — ${artists} | Album: ${t.album.name} | ${formatDuration(t.duration_ms)} | Popularity: ${t.popularity} | URI: \`${t.uri}\` | ID: \`${t.id}\``;
        });

        const text = [
          `Search results for "${query}" (${result.tracks.total} total matches, showing top ${result.tracks.items.length}):`,
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
    "get_track_details",
    "Get detailed information about a specific track",
    {
      track_id: z.string().describe("The Spotify track ID"),
    },
    async ({ track_id }) => {
      try {
        const t = await spotify.getTrack(track_id);
        const artists = t.artists.map((a) => a.name).join(", ");
        const text = [
          `**${t.name}**`,
          `Artists: ${artists}`,
          `Album: ${t.album.name} (${t.album.release_date})`,
          `Track: ${t.track_number}/${t.album.total_tracks} (Disc ${t.disc_number})`,
          `Duration: ${formatDuration(t.duration_ms)}`,
          `Popularity: ${t.popularity}/100`,
          `Explicit: ${t.explicit}`,
          `URI: \`${t.uri}\``,
          `URL: ${t.external_urls.spotify}`,
        ].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  server.tool(
    "get_audio_features",
    "Get audio features (BPM, energy, danceability, key, etc.) for a single track",
    {
      track_id: z.string().describe("The Spotify track ID"),
    },
    async ({ track_id }) => {
      try {
        const features = await spotify.getAudioFeatures(track_id);
        const text = [`Audio features for track \`${track_id}\`:`, "", formatAudioFeatures(features)].join("\n");
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );

  server.tool(
    "get_tracks_audio_features",
    "Get audio features (BPM, energy, danceability, key, etc.) for multiple tracks at once. Essential for playlist analysis.",
    {
      track_ids: z
        .array(z.string())
        .max(100)
        .describe("Array of Spotify track IDs (max 100)"),
    },
    async ({ track_ids }) => {
      try {
        const features = await spotify.getAudioFeaturesMultiple(track_ids);
        const lines = features.map((f, i) => {
          if (!f) return `${i + 1}. Track \`${track_ids[i]}\` — audio features unavailable`;
          const key = f.key >= 0 ? KEY_NAMES[f.key] : "?";
          const mode = f.mode === 1 ? "Major" : "Minor";
          return `${i + 1}. \`${f.id}\` — BPM: ${Math.round(f.tempo)} | Key: ${key} ${mode} | Energy: ${(f.energy * 100).toFixed(0)}% | Dance: ${(f.danceability * 100).toFixed(0)}% | Valence: ${(f.valence * 100).toFixed(0)}% | Acoustic: ${(f.acousticness * 100).toFixed(0)}% | Loud: ${f.loudness.toFixed(1)}dB`;
        });

        const text = [
          `Audio features for ${track_ids.length} tracks:`,
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
    "get_recommendations",
    "Get track recommendations based on seed tracks, artists, or genres with optional audio feature targets. Useful for finding similar tracks for playlists.",
    {
      seed_track_ids: z
        .array(z.string())
        .max(5)
        .optional()
        .describe("Up to 5 seed track IDs"),
      seed_artist_ids: z
        .array(z.string())
        .max(5)
        .optional()
        .describe("Up to 5 seed artist IDs"),
      seed_genres: z
        .array(z.string())
        .max(5)
        .optional()
        .describe("Up to 5 seed genres (e.g. 'electronic', 'house', 'hip-hop')"),
      target_tempo: z.number().optional().describe("Target BPM"),
      target_energy: z.number().min(0).max(1).optional().describe("Target energy (0.0-1.0)"),
      target_danceability: z.number().min(0).max(1).optional().describe("Target danceability (0.0-1.0)"),
      target_valence: z.number().min(0).max(1).optional().describe("Target valence/happiness (0.0-1.0)"),
      limit: z.number().min(1).max(100).optional().describe("Number of recommendations (default 20)"),
    },
    async ({ seed_track_ids, seed_artist_ids, seed_genres, target_tempo, target_energy, target_danceability, target_valence, limit }) => {
      try {
        const totalSeeds = (seed_track_ids?.length || 0) + (seed_artist_ids?.length || 0) + (seed_genres?.length || 0);
        if (totalSeeds === 0) {
          return {
            content: [{ type: "text", text: "Error: At least one seed (track, artist, or genre) is required." }],
          };
        }
        if (totalSeeds > 5) {
          return {
            content: [{ type: "text", text: "Error: Total seeds (tracks + artists + genres) must not exceed 5." }],
          };
        }

        const result = await spotify.getRecommendations({
          seed_tracks: seed_track_ids,
          seed_artists: seed_artist_ids,
          seed_genres: seed_genres,
          target_tempo,
          target_energy,
          target_danceability,
          target_valence,
          limit: limit ?? 20,
        });

        const lines = result.tracks.map((t, i) => {
          const artists = t.artists.map((a) => a.name).join(", ");
          return `${i + 1}. **${t.name}** — ${artists} | Album: ${t.album.name} | ${formatDuration(t.duration_ms)} | Popularity: ${t.popularity} | URI: \`${t.uri}\` | ID: \`${t.id}\``;
        });

        const text = [
          `${result.tracks.length} recommended tracks:`,
          "",
          ...lines,
        ].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}
