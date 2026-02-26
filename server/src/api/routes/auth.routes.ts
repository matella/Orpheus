import type { FastifyInstance } from 'fastify';
import { getAuthUrl, handleCallback, isAuthenticated } from '../../spotify/auth.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/auth/status
   * Check if Spotify is authenticated.
   */
  fastify.get('/status', async () => {
    return isAuthenticated();
  });

  /**
   * GET /api/auth/login
   * Start the Spotify OAuth flow. If already authenticated, show a success page.
   */
  fastify.get('/login', async (_request, reply) => {
    const { authenticated } = isAuthenticated();
    if (authenticated) {
      return reply.type('text/html').send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Orpheus - Already Authenticated</title>
            <style>
              body {
                background: #0D0D0F;
                color: #E8E6E1;
                font-family: 'Inter', system-ui, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
              }
              .container { text-align: center; }
              h1 { color: #D4A843; font-family: 'Cinzel', serif; font-size: 2rem; }
              p { color: #8A8A99; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Orpheus</h1>
              <p>Already authenticated with Spotify. You can close this window.</p>
            </div>
          </body>
        </html>
      `);
    }

    const url = getAuthUrl();
    return reply.redirect(url);
  });

  /**
   * GET /api/auth/callback
   * Handle the Spotify OAuth callback with the authorization code.
   */
  fastify.get<{ Querystring: { code?: string; error?: string } }>(
    '/callback',
    async (request, reply) => {
      const { code, error } = request.query;

      if (error) {
        return reply.status(400).send({
          error: 'AUTH_DENIED',
          message: `Spotify authorization denied: ${error}`,
        });
      }

      if (!code) {
        return reply.status(400).send({
          error: 'MISSING_CODE',
          message: 'Authorization code is required',
        });
      }

      await handleCallback(code);

      // Return a simple HTML page that can be closed
      reply.type('text/html').send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Orpheus - Authentication Complete</title>
            <style>
              body {
                background: #0D0D0F;
                color: #E8E6E1;
                font-family: 'Inter', system-ui, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
              }
              .container {
                text-align: center;
              }
              h1 {
                color: #D4A843;
                font-family: 'Cinzel', serif;
                font-size: 2rem;
              }
              p { color: #8A8A99; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Orpheus</h1>
              <p>Authentication successful. You can close this window.</p>
            </div>
          </body>
        </html>
      `);
    },
  );
}
