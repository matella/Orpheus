import crypto from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../shared/logger.js';
import { SpotifyAuthError } from '../shared/errors.js';
import { getDb } from '../database/connection.js';
import type { SpotifyTokens } from './types.js';

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
  'user-library-read',
  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

// In-memory PKCE verifier for the current auth flow
let codeVerifier: string | null = null;

// Mutex for token refresh — prevents concurrent refresh attempts
let refreshPromise: Promise<string> | null = null;

function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Generate the Spotify authorization URL with PKCE.
 */
export function getAuthUrl(): string {
  codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    client_id: config.spotify.clientId,
    response_type: 'code',
    redirect_uri: config.spotify.redirectUri,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    show_dialog: 'false',
  });

  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens and store them.
 */
export async function handleCallback(code: string): Promise<void> {
  if (!codeVerifier) {
    throw new SpotifyAuthError('No active auth flow. Call getAuthUrl() first.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.spotify.redirectUri,
    client_id: config.spotify.clientId,
    code_verifier: codeVerifier,
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, body: errorBody }, 'Token exchange failed');
    throw new SpotifyAuthError(`Token exchange failed: ${response.status}`);
  }

  const data = await response.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  storeTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    scope: data.scope,
  });

  codeVerifier = null;
  logger.info('Spotify authentication successful');
}

/**
 * Get a valid access token, refreshing if necessary.
 */
export async function getValidToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) {
    throw new SpotifyAuthError('Not authenticated. Please authenticate with Spotify first.');
  }

  // Refresh if expiring within 5 minutes
  const expiresAt = new Date(tokens.expiresAt).getTime();
  const bufferMs = 5 * 60 * 1000;

  if (Date.now() + bufferMs >= expiresAt) {
    logger.debug('Access token expiring soon, refreshing...');
    // Deduplicate concurrent refresh calls — all callers await the same promise
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken(tokens.refreshToken).finally(() => {
        refreshPromise = null;
      });
    }
    return await refreshPromise;
  }

  return tokens.accessToken;
}

/**
 * Check if the user is currently authenticated.
 */
export function isAuthenticated(): { authenticated: boolean; expiresAt?: string } {
  const tokens = loadTokens();
  if (!tokens) return { authenticated: false };

  const expiresAt = new Date(tokens.expiresAt).getTime();
  if (Date.now() >= expiresAt) {
    // Token expired, but we might still be able to refresh
    return { authenticated: true, expiresAt: tokens.expiresAt };
  }

  return { authenticated: true, expiresAt: tokens.expiresAt };
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.spotify.clientId,
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ status: response.status, body: errorBody }, 'Token refresh failed');
    throw new SpotifyAuthError('Token refresh failed. Please re-authenticate.');
  }

  const data = await response.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  storeTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt,
    scope: data.scope,
  });

  logger.debug('Access token refreshed successfully');
  return data.access_token;
}

function storeTokens(tokens: SpotifyTokens): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO auth_tokens (id, access_token, refresh_token, expires_at, scope, updated_at)
    VALUES (1, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      updated_at = datetime('now')
  `).run(tokens.accessToken, tokens.refreshToken, tokens.expiresAt, tokens.scope);
}

function loadTokens(): SpotifyTokens | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM auth_tokens WHERE id = 1').get() as
    | { access_token: string; refresh_token: string; expires_at: string; scope: string }
    | undefined;

  if (!row) return null;

  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    scope: row.scope,
  };
}
