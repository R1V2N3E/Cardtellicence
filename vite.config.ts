import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Serves api/*.ts locally with the same Web-standard handlers Vercel runs in production.
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/([a-z]+)(\?.*)?$/);
        if (!match) return next();
        try {
          const mod = await server.ssrLoadModule(`/api/${match[1]}.ts`);
          const method = req.method ?? 'GET';
          const chunks: Buffer[] = [];
          if (method === 'POST') for await (const c of req) chunks.push(c as Buffer);
          const request = new Request(`http://localhost${req.url}`, {
            method,
            headers: req.headers as Record<string, string>,
            body: method === 'POST' ? Buffer.concat(chunks) : undefined,
          });
          const response: Response = await mod[method](request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  server: { host: true },
});
