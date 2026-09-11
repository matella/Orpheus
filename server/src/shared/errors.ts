export class OrpheusError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'OrpheusError';
  }
}

export class SpotifyAuthError extends OrpheusError {
  constructor(message: string) {
    super(message, 'SPOTIFY_AUTH_ERROR', 401);
    this.name = 'SpotifyAuthError';
  }
}

export class SpotifyApiError extends OrpheusError {
  constructor(message: string, statusCode: number = 502) {
    super(message, 'SPOTIFY_API_ERROR', statusCode);
    this.name = 'SpotifyApiError';
  }
}

export class PlaybackError extends OrpheusError {
  constructor(message: string) {
    super(message, 'PLAYBACK_ERROR', 500);
    this.name = 'PlaybackError';
  }
}

export class DatabaseError extends OrpheusError {
  constructor(message: string) {
    super(message, 'DATABASE_ERROR', 500);
    this.name = 'DatabaseError';
  }
}

export class AiError extends OrpheusError {
  constructor(message: string) {
    super(message, 'AI_ERROR', 502);
    this.name = 'AiError';
  }
}

/**
 * Thrown when adding tracks to a playlist fails part-way.
 * `addedCount` is the number of URIs successfully added before the failure.
 */
export class PlaylistPartialError extends SpotifyApiError {
  constructor(message: string, public readonly addedCount: number, statusCode: number = 502) {
    super(message, statusCode);
    this.name = 'PlaylistPartialError';
  }
}
