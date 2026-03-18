import { getValidToken } from "./auth.js";

const BASE_URL = "https://api.spotify.com/v1";

export interface SpotifyUser {
  id: string;
  display_name: string;
  uri: string;
}

export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  uri: string;
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  release_date: string;
  total_tracks: number;
  artists: SpotifyArtist[];
  images: SpotifyImage[];
  uri: string;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  duration_ms: number;
  explicit: boolean;
  uri: string;
  external_urls: { spotify: string };
  track_number: number;
  disc_number: number;
}

export interface SpotifyAudioFeatures {
  id: string;
  tempo: number;
  energy: number;
  danceability: number;
  valence: number;
  acousticness: number;
  instrumentalness: number;
  liveness: number;
  speechiness: number;
  loudness: number;
  key: number;
  mode: number;
  time_signature: number;
  duration_ms: number;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  public: boolean | null;
  // Feb 2026 API: 'tracks' renamed to 'items'
  tracks?: { total: number; href: string };
  items?: unknown[] | { total: number };
  owner: { id: string; display_name: string };
  images: SpotifyImage[];
  uri: string;
  external_urls: { spotify: string };
}

// Feb 2026 API: 'track' renamed to 'item'
export interface SpotifyPlaylistItem {
  added_at: string;
  item?: SpotifyTrack | null;
  track?: SpotifyTrack | null; // backwards compat
}

export interface SpotifyPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
}

export interface SpotifySearchResult {
  tracks: SpotifyPage<SpotifyTrack>;
}

export class SpotifyClient {
  private async request<T>(
    method: string,
    path: string,
    body?: object,
    query?: Record<string, string>
  ): Promise<T> {
    const token = await getValidToken();
    let url = `${BASE_URL}${path}`;

    if (query) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 401) {
      const freshToken = await getValidToken();
      headers.Authorization = `Bearer ${freshToken}`;
      const retry = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!retry.ok) {
        throw new Error(`Spotify API error ${retry.status}: ${await retry.text()}`);
      }
      return (await retry.json()) as T;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Spotify API error: ${method} ${path} → ${response.status}: ${errorText}`);
      throw new Error(`Spotify API error ${response.status}: ${errorText}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    const json = await response.json();
    console.error(`Spotify API success: ${method} ${path} → ${response.status}`);
    return json as T;
  }

  async getCurrentUser(): Promise<SpotifyUser> {
    return this.request<SpotifyUser>("GET", "/me");
  }

  async getUserPlaylists(
    limit: number = 50,
    offset: number = 0
  ): Promise<SpotifyPage<SpotifyPlaylist>> {
    return this.request<SpotifyPage<SpotifyPlaylist>>("GET", "/me/playlists", undefined, {
      limit: limit.toString(),
      offset: offset.toString(),
    });
  }

  // Feb 2026 API: endpoint renamed from /tracks to /items
  async getPlaylistItems(
    playlistId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<SpotifyPage<SpotifyPlaylistItem>> {
    return this.request<SpotifyPage<SpotifyPlaylistItem>>(
      "GET",
      `/playlists/${playlistId}/items`,
      undefined,
      {
        limit: limit.toString(),
        offset: offset.toString(),
      }
    );
  }

  async getPlaylist(playlistId: string): Promise<SpotifyPlaylist> {
    return this.request<SpotifyPlaylist>("GET", `/playlists/${playlistId}`);
  }

  async createPlaylist(
    userId: string,
    name: string,
    description?: string,
    isPublic: boolean = false
  ): Promise<SpotifyPlaylist> {
    return this.request<SpotifyPlaylist>("POST", `/users/${userId}/playlists`, {
      name,
      description: description || "",
      public: isPublic,
    });
  }

  // Feb 2026 API: endpoint renamed from /tracks to /items
  async addItemsToPlaylist(playlistId: string, uris: string[]): Promise<void> {
    for (let i = 0; i < uris.length; i += 100) {
      const batch = uris.slice(i, i + 100);
      await this.request<{ snapshot_id: string }>("POST", `/playlists/${playlistId}/items`, {
        uris: batch,
      });
    }
  }

  // Feb 2026 API: search limit max is now 10
  async searchTracks(
    query: string,
    limit: number = 10
  ): Promise<SpotifySearchResult> {
    return this.request<SpotifySearchResult>("GET", "/search", undefined, {
      q: query,
      type: "track",
      limit: Math.min(limit, 10).toString(),
    });
  }

  async getTrack(trackId: string): Promise<SpotifyTrack> {
    return this.request<SpotifyTrack>("GET", `/tracks/${trackId}`);
  }

  async getAudioFeatures(trackId: string): Promise<SpotifyAudioFeatures> {
    return this.request<SpotifyAudioFeatures>("GET", `/audio-features/${trackId}`);
  }

  // Feb 2026 API: batch /tracks?ids= removed, fetch individually
  async getAudioFeaturesMultiple(
    trackIds: string[]
  ): Promise<(SpotifyAudioFeatures | null)[]> {
    const results: (SpotifyAudioFeatures | null)[] = [];
    for (const id of trackIds) {
      try {
        const features = await this.request<SpotifyAudioFeatures>("GET", `/audio-features/${id}`);
        results.push(features);
      } catch {
        results.push(null);
      }
    }
    return results;
  }

  async getRecommendations(params: {
    seed_tracks?: string[];
    seed_artists?: string[];
    seed_genres?: string[];
    target_tempo?: number;
    target_energy?: number;
    target_danceability?: number;
    target_valence?: number;
    limit?: number;
  }): Promise<{ tracks: SpotifyTrack[] }> {
    const query: Record<string, string> = {};
    if (params.seed_tracks?.length) query.seed_tracks = params.seed_tracks.join(",");
    if (params.seed_artists?.length) query.seed_artists = params.seed_artists.join(",");
    if (params.seed_genres?.length) query.seed_genres = params.seed_genres.join(",");
    if (params.target_tempo !== undefined) query.target_tempo = params.target_tempo.toString();
    if (params.target_energy !== undefined) query.target_energy = params.target_energy.toString();
    if (params.target_danceability !== undefined) query.target_danceability = params.target_danceability.toString();
    if (params.target_valence !== undefined) query.target_valence = params.target_valence.toString();
    query.limit = (params.limit || 10).toString();
    return this.request<{ tracks: SpotifyTrack[] }>("GET", "/recommendations", undefined, query);
  }
}
