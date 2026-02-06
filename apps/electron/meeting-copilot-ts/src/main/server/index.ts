import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { serve } from '@hono/node-server';
import { appRouter } from './trpc/router';
import { createContext } from './trpc/context';
import { webhookRouter } from './routes/webhook';
import { createChildLogger } from '../lib/logger';

const logger = createChildLogger('http-server');

let server: ReturnType<typeof serve> | null = null;

export function createServer(port: number) {
  const app = new Hono();

  // CORS middleware
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'x-access-token'],
    })
  );

  // Health check
  app.get('/api', (c) => {
    return c.json({
      status: 'ok',
      message: 'Meeting Copilot TypeScript Server Running',
    });
  });

  // tRPC handler
  app.use(
    '/api/trpc/*',
    trpcServer({
      router: appRouter,
      endpoint: '/api/trpc',
      createContext: async (_opts, c) => createContext(c),
    })
  );

  // Webhook routes (raw Hono, not tRPC)
  app.route('/api', webhookRouter);

  return app;
}

export async function startServer(port: number): Promise<void> {
  if (server) {
    logger.warn('Server already running');
    return;
  }

  const app = createServer(port);

  return new Promise((resolve) => {
    server = serve(
      {
        fetch: app.fetch,
        port,
      },
      (info) => {
        logger.info({ port: info.port }, 'HTTP server started');
        resolve();
      }
    );
  });
}

export async function stopServer(): Promise<void> {
  if (server) {
    logger.info('Stopping HTTP server');
    server.close();
    server = null;
  }
}

export function getServerStatus(): { running: boolean; port?: number } {
  return {
    running: !!server,
  };
}
