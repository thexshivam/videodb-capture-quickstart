import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../main/server/trpc/router';

export const trpc = createTRPCReact<AppRouter>();

const API_PORT = 51731;

export function createTrpcClient(getAccessToken: () => string | null) {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `http://localhost:${API_PORT}/api/trpc`,
        headers() {
          const token = getAccessToken();
          return token
            ? {
                'x-access-token': token,
              }
            : {};
        },
      }),
    ],
  });
}
