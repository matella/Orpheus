import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from '../config.js';
import { logger } from '../shared/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { authRoutes } from './routes/auth.routes.js';
import { playbackRoutes } from './routes/playback.routes.js';
import { registerWebSocket, wireEngineEvents } from './websocket.js';

export async function buildServer() {
  const server = Fastify({
    logger: false, // We use our own pino logger
  });

  // CORS for Flutter client
  await server.register(cors, {
    origin: true, // Allow all origins for development
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  });

  // Global error handler
  server.setErrorHandler(errorHandler);

  // Health check
  server.get('/api/health', async () => ({
    status: 'ok',
    service: 'orpheus',
    timestamp: new Date().toISOString(),
  }));

  // WebSocket for real-time state push
  await registerWebSocket(server);
  wireEngineEvents();

  // Register route modules
  await server.register(authRoutes, { prefix: '/api/auth' });
  await server.register(playbackRoutes, { prefix: '/api/playback' });

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
