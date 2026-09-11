import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/scheduler/scheduler.js', () => ({ registerTask: vi.fn() }));
vi.mock('../src/spotify/artist-genre-sync.js', () => ({ runArtistGenreSync: vi.fn().mockResolvedValue(3) }));

import { registerTask } from '../src/scheduler/scheduler.js';
import { runArtistGenreSync } from '../src/spotify/artist-genre-sync.js';
import { registerArtistGenreSyncTask, ARTIST_GENRE_SYNC_BUDGET_MS } from '../src/scheduler/tasks/sync-artist-genres.js';

const registerTaskMock = vi.mocked(registerTask);
const runArtistGenreSyncMock = vi.mocked(runArtistGenreSync);

beforeEach(() => {
  registerTaskMock.mockClear();
  runArtistGenreSyncMock.mockClear();
});

describe('registerArtistGenreSyncTask', () => {
  it('registers a 30-minute task that runs on start', () => {
    registerArtistGenreSyncTask();

    expect(registerTaskMock).toHaveBeenCalledTimes(1);
    expect(registerTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'artist-genre-sync',
        schedule: '*/30 * * * *',
        runOnStart: true,
      }),
    );
  });

  it('the registered handler runs the sync with the 4-minute budget', async () => {
    registerArtistGenreSyncTask();

    const { handler } = registerTaskMock.mock.calls[0][0];
    await handler();

    expect(runArtistGenreSyncMock).toHaveBeenCalledWith({ maxDurationMs: 240000 });
    expect(ARTIST_GENRE_SYNC_BUDGET_MS).toBe(240000);
  });
});
