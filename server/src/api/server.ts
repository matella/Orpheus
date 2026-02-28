import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from '../config.js';
import { logger } from '../shared/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { authRoutes } from './routes/auth.routes.js';
import { playbackRoutes } from './routes/playback.routes.js';
import { steeringRoutes } from './routes/steering.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { aiRoutes } from './routes/ai.routes.js';
import { feedbackRoutes } from './routes/feedback.routes.js';
import { sessionRoutes } from './routes/session.routes.js';
import { analyticsRoutes } from './routes/analytics.routes.js';
import { contextRoutes } from './routes/context.routes.js';
import { registerWebSocket, wireEngineEvents } from './websocket.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const overlayPath = join(__dirname, '../../public/overlay.html');

export async function buildServer() {
  const server = Fastify({
    logger: false, // We use our own pino logger
  });

  // CORS for Flutter client
  await server.register(cors, {
    origin: true, // Allow all origins for development
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  });

  // Allow POST requests with empty body (Fastify rejects by default)
  server.removeContentTypeParser('application/json');
  server.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      if (!body || (typeof body === 'string' && body.trim() === '')) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body as string));
      } catch (err: any) {
        done(err, undefined);
      }
    },
  );

  // Global error handler
  server.setErrorHandler(errorHandler);

  // Health check
  server.get('/api/health', async () => ({
    status: 'ok',
    service: 'orpheus',
    timestamp: new Date().toISOString(),
  }));

  // OBS overlay page (read fresh each request so HTML changes are picked up without restart)
  server.get('/overlay', async (_request, reply) => {
    const html = readFileSync(overlayPath, 'utf-8');
    reply.type('text/html').send(html);
  });

  // WebSocket for real-time state push
  await registerWebSocket(server);
  wireEngineEvents();

  // Register route modules
  await server.register(authRoutes, { prefix: '/api/auth' });
  await server.register(playbackRoutes, { prefix: '/api/playback' });
  await server.register(steeringRoutes, { prefix: '/api/steering' });
  await server.register(settingsRoutes, { prefix: '/api/settings' });
  await server.register(aiRoutes, { prefix: '/api/ai' });
  await server.register(feedbackRoutes, { prefix: '/api/feedback' });
  await server.register(sessionRoutes, { prefix: '/api/sessions' });
  await server.register(analyticsRoutes, { prefix: '/api/analytics' });
  await server.register(contextRoutes, { prefix: '/api/context' });

  return server;
}

export async function startServer() {
  const server = await buildServer();

  try {
    await server.listen({ port: config.server.port, host: config.server.host });
    logger.info(
      { port: config.server.port, host: config.server.host },
      'Orpheus server listening',
    );
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  return server;
}
