import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { logger } from '../shared/logger.js';
import { engine } from '../playback/engine.js';
import type { TrajectoryPoint } from '../playback/engine.js';

const clients = new Set<WebSocket>();

/**
 * Register WebSocket support and wire up engine events.
 */
export async function registerWebSocket(server: FastifyInstance): Promise<void> {
  await server.register(websocket);

  server.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    logger.info({ clientCount: clients.size }, 'WebSocket client connected');

    // Send current state on connect (including trajectory for flow indicator)
    const state = engine.getState();
    const current = engine.getCurrentTrack();
    const next = engine.getNextTrack();
    const trajectory = engine.getTrajectory();
    safeSend(socket, {
      type: 'state_updated',
      data: { state, current, next, trajectory },
    });

    socket.on('close', () => {
      clients.delete(socket);
      logger.debug({ clientCount: clients.size }, 'WebSocket client disconnected');
    });

    socket.on('error', (err: Error) => {
      logger.warn({ err }, 'WebSocket client error');
      clients.delete(socket);
    });
  });
}

/**
 * Wire engine events to broadcast to all WebSocket clients.
 */
export function wireEngineEvents(): void {
  engine.on('track_changed', (data) => {
    broadcast({ type: 'track_changed', data });
  });

  engine.on('session_started', (data) => {
    broadcast({ type: 'session_started', data });
  });

  engine.on('session_ended', (data) => {
    broadcast({ type: 'session_ended', data });
  });

  engine.on('state_updated', (data) => {
    broadcast({ type: 'state_updated', data });
  });

  engine.on('transition_complete', (data) => {
    broadcast({ type: 'transition_complete', data });
  });
}

export function broadcast(message: object): void {
  const json = JSON.stringify(message);
  for (const client of clients) {
    safeSend(client, json);
  }
}

function safeSend(socket: WebSocket, data: object | string): void {
  try {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    if (socket.readyState === 1) { // WebSocket.OPEN
      socket.send(message);
    }
  } catch {
    // Ignore send errors on closed sockets
  }
}
