# Spotify MCP Server

A Model Context Protocol (MCP) server for Spotify, built in TypeScript. Use it with Claude Desktop to analyze your playlists, get audio features (BPM, energy, key, etc.), and create DJ-ready playlist classifications for easy mixing.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- A [Spotify account](https://www.spotify.com/) (free or premium)
- [Claude Desktop](https://claude.ai/download)

---

## Setup

### Step 1 — Create a Spotify Developer App

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account
3. Click **"Create App"**
4. Fill in the form:
   - **App name**: anything you like (e.g. `Claude MCP`)
   - **App description**: anything
   - **Redirect URI**: `http://localhost:8888/callback` (click **Add**)
   - Under **"Which API/SDKs are you planning to use?"**, check **Web API**
5. Click **"Save"**
6. On your app page, click **"Settings"** and copy the **Client ID**

> You do NOT need a Client Secret — this server uses the PKCE OAuth flow which only requires the Client ID.

### Step 2 — Install and Build

```bash
cd C:\Repositories\custom-spotify-mcp
npm install
npm run build
```

### Step 3 — Configure Claude Desktop

Open your Claude Desktop configuration file:

| OS      | Path                                                        |
|---------|-------------------------------------------------------------|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json`               |
| macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json` |

Add (or merge) the `spotify` entry under `mcpServers`:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["C:/Repositories/custom-spotify-mcp/build/index.js"],
      "env": {
        "SPOTIFY_CLIENT_ID": "paste_your_client_id_here"
      }
    }
  }
}
```

> Adjust the path in `args` if you cloned the repo somewhere else.

### Step 4 — Restart Claude Desktop

Close and reopen Claude Desktop so it picks up the new MCP server. You should see a Spotify hammer icon in the tools list.

### Step 5 — Authorize Spotify (first time only)

The first time you use any Spotify tool in Claude, your browser will open and ask you to log in to Spotify and approve permissions. After approval you'll see a "Connected to Spotify!" page — you can close it and go back to Claude.

Tokens are saved to `~/.spotify-mcp-tokens.json` and refresh automatically. You won't need to log in again unless you revoke access.

---

## Available Tools

### Playlist Tools

| Tool                     | Description                                              |
|--------------------------|----------------------------------------------------------|
| `get_my_playlists`       | List all your Spotify playlists (name, track count, ID)  |
| `get_playlist_tracks`    | Get tracks from a playlist with pagination               |
| `get_all_playlist_tracks`| Get ALL tracks from a playlist (auto-paginates)          |
| `create_playlist`        | Create a new empty playlist                              |
| `add_tracks_to_playlist` | Add tracks to an existing playlist by URI                |

### Track & Analysis Tools

| Tool                       | Description                                                        |
|----------------------------|--------------------------------------------------------------------|
| `search_tracks`            | Search Spotify for tracks by name, artist, etc.                    |
| `get_track_details`        | Get full metadata for a specific track                             |
| `get_audio_features`       | Get BPM, key, energy, danceability, valence, etc. for one track    |
| `get_tracks_audio_features`| Batch audio features for up to 100 tracks at once                  |
| `get_recommendations`      | Get track recommendations with target BPM, energy, danceability    |

### Audio Features Explained

| Feature           | Range   | Description                                   |
|-------------------|---------|-----------------------------------------------|
| **Tempo (BPM)**   | 0-250+  | Beats per minute                              |
| **Key**           | C to B  | Musical key (with major/minor mode)           |
| **Energy**        | 0-100%  | Intensity and activity                        |
| **Danceability**  | 0-100%  | How suitable for dancing                      |
| **Valence**       | 0-100%  | Musical positiveness / happiness              |
| **Acousticness**  | 0-100%  | Likelihood of being acoustic                  |
| **Instrumentalness** | 0-100% | Likelihood of having no vocals             |
| **Liveness**      | 0-100%  | Likelihood of being a live recording          |
| **Speechiness**   | 0-100%  | Presence of spoken words                      |
| **Loudness**      | dB      | Overall loudness (typically -60 to 0 dB)      |

---

## Example Prompts for Claude

### Browse playlists
> "Show me all my playlists"

### Analyze a playlist
> "Get all tracks from my playlist 'Summer Vibes' and show me a table of BPM, energy, and key for each track"

### DJ prep — sort by BPM
> "Take my playlist 'House Mix' and sort all tracks by BPM. Group them into ranges: 118-122, 122-126, 126-130"

### Harmonic mixing — group by key
> "Analyze my playlist and group tracks by musical key so I can plan harmonic transitions using the Camelot wheel"

### Create energy curve playlists
> "From my playlist 'All Tracks', create 3 new playlists: 'Warm Up' (low energy, 100-120 BPM), 'Peak Time' (high energy, 125-135 BPM), and 'Cool Down' (low energy, decreasing BPM)"

### Find similar tracks
> "Look at my top 5 tracks from 'Favorites' and recommend 20 similar tracks with BPM between 120-128"

### Full classification workflow
> "Analyze all tracks in my 'DJ Library' playlist. Classify them by genre feel (based on audio features), BPM range, and energy level. Then create separate playlists for each category."

---

## Troubleshooting

### "SPOTIFY_CLIENT_ID environment variable is required"
You forgot to set the `SPOTIFY_CLIENT_ID` in the Claude Desktop config. See Step 3.

### Browser doesn't open for auth
The auth URL is printed in the server logs. You can find it in Claude Desktop's MCP server logs and open it manually.

### 403 error on audio features
Spotify restricted the audio features endpoint for apps created after November 2024. Go to your [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), select your app, and request **"Extended Quota Mode"**.

### Token expired / auth issues
Delete the token file and restart Claude Desktop to re-authenticate:
```bash
# Windows
del %USERPROFILE%\.spotify-mcp-tokens.json

# macOS/Linux
rm ~/.spotify-mcp-tokens.json
```

### Port 8888 is already in use
Set a different port in the Claude Desktop config env:
```json
"env": {
  "SPOTIFY_CLIENT_ID": "your_id",
  "SPOTIFY_REDIRECT_PORT": "9999"
}
```
Then also update the redirect URI in your Spotify app settings to `http://localhost:9999/callback`.

---

## Project Structure

```
src/
  index.ts              Entry point — wires up MCP server
  auth.ts               Spotify OAuth PKCE flow + token persistence
  spotify-client.ts     Spotify Web API client
  tools/
    playlists.ts        Playlist tools (list, create, add tracks)
    tracks.ts           Track tools (search, details, audio features, recommendations)
```

## License

ISC
