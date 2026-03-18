import { getValidToken } from "./auth.js";

const BASE_URL = "https://api.spotify.com/v1";

export interface SpotifyUser {
  id: string;
  display_name: string;
  email?: string;
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
  popularity: number;
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
  tracks: { total: number; href: string };
  owner: { id: string; display_name: string };
  images: SpotifyImage[];
  uri: string;
  external_urls: { spotify: string };
}

export interface SpotifyPlaylistTrackItem {
  added_at: string;
  track: SpotifyTrack | null;
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
      // Token expired mid-request, get a fresh one and retry once
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
    console.error(`Spotify API success: ${method} ${path} → ${response.status}, keys: ${Object.keys(json as object).join(",")}`);
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

  async getPlaylistTracks(
    playlistId: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<SpotifyPage<SpotifyPlaylistTrackItem>> {
    return this.request<SpotifyPage<SpotifyPlaylistTrackItem>>(
      "GET",
      `/playlists/${playlistId}/tracks`,
      undefined,
      {
        limit: limit.toString(),
        offset: offset.toString(),
        fields:
          "items(added_at,track(id,name,artists(id,name,uri),album(id,name,release_date,total_tracks,artists,images,uri),duration_ms,popularity,explicit,uri,external_urls,track_number,disc_number)),total,limit,offset,next",
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

  async addTracksToPlaylist(playlistId: string, trackUris: string[]): Promise<void> {
    // Spotify API allows max 100 tracks per request
    for (let i = 0; i < trackUris.length; i += 100) {
      const batch = trackUris.slice(i, i + 100);
      await this.request<{ snapshot_id: string }>("POST", `/playlists/${playlistId}/tracks`, {
        uris: batch,
      });
    }
  }

  async searchTracks(
    query: string,
    limit: number = 20
  ): Promise<SpotifySearchResult> {
    return this.request<SpotifySearchResult>("GET", "/search", undefined, {
      q: query,
      type: "track",
      limit: limit.toString(),
    });
  }

  async getTrack(trackId: string): Promise<SpotifyTrack> {
    return this.request<SpotifyTrack>("GET", `/tracks/${trackId}`);
  }

  async getAudioFeatures(trackId: string): Promise<SpotifyAudioFeatures> {
    return this.request<SpotifyAudioFeatures>("GET", `/audio-features/${trackId}`);
  }

  async getAudioFeaturesMultiple(
    trackIds: string[]
  ): Promise<(SpotifyAudioFeatures | null)[]> {
    const results: (SpotifyAudioFeatures | null)[] = [];
    // Spotify API allows max 100 IDs per request
    for (let i = 0; i < trackIds.length; i += 100) {
      const batch = trackIds.slice(i, i + 100);
      const response = await this.request<{ audio_features: (SpotifyAudioFeatures | null)[] }>(
        "GET",
        "/audio-features",
        undefined,
        { ids: batch.join(",") }
      );
      results.push(...response.audio_features);
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
    query.limit = (params.limit || 20).toString();
    return this.request<{ tracks: SpotifyTrack[] }>("GET", "/recommendations", undefined, query);
  }
}
