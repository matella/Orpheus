import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { OrpheusError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

export function errorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof OrpheusError) {
    logger.warn({ code: error.code, message: error.message }, 'Application error');
    reply.status(error.statusCode).send({
      error: error.code,
      message: error.message,
    });
    return;
  }

  // Fastify validation errors
  if (error.validation) {
    reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: error.message,
    });
    return;
  }

  // Unexpected errors
  logger.error({ err: error }, 'Unexpected error');
  reply.status(500).send({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  });
}
