import type { MiddlewareContext } from '../types/trpc';
import { logger } from '../utils/logger';

export const createLoggingMiddleware = (t: any) => {
  return t.middleware(async ({ path, type, next, ctx }: MiddlewareContext) => {
    const start = Date.now();
    const requestId = crypto.randomUUID();

    // Log request
    logger.info('tRPC Request', {
      requestId,
      path,
      type,
      // input,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await next();
      const durationMs = Date.now() - start;

      // Log successful response
      logger.info('tRPC Response', {
        requestId,
        path,
        type,
        durationMs,
        ok: result.ok,
        timestamp: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - start;

      // Log error response
      logger.error('tRPC Error' + path, {
        requestId,
        path,
        type,
        durationMs,
        error: error instanceof Error ? {
          path,
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : error,
        timestamp: new Date().toISOString(),
      });

      throw error;
    }
  });
}; 