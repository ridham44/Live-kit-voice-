import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The frontend always fetches the relative path /api/connection-details (see src/api.ts) — in
// production that's Vercel's own serverless function (api/connection-details.ts), same origin,
// no configuration needed. In local dev there's no serverless runtime, so this proxies that same
// path to the standalone token server (src/tokenServer.ts, `pnpm run token-server`) instead.
// Using one unconditional path in application code, with the environment difference handled only
// here, means there's no env var to forget to set — that's what previously broke local dev after
// the relative-path default was added for Vercel.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const tokenServerUrl = env.VITE_TOKEN_SERVER_URL || 'http://localhost:8080';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api/connection-details': {
          target: tokenServerUrl,
          changeOrigin: true,
          rewrite: () => '/connection-details',
        },
      },
    },
  };
});
