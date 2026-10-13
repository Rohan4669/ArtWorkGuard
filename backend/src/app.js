import express from 'express';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import fs from 'node:fs';
import path from 'node:path';
import { securityMiddleware, staticSecurity, csrfGuard, apiLimiter, authLimiter } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRoutes, userRoutes } from './modules/auth.routes.js';
import { projectRoutes } from './modules/projects.routes.js';
import { fileRoutes } from './modules/files.routes.js';
import { comparisonRoutes } from './modules/comparisons.routes.js';
import { systemRoutes, dashboardRoutes, adminRoutes } from './modules/misc.routes.js';
import { createAudit } from './services/audit.js';

/** ctx = { cfg, log, storages, engine, queue } — everything is injected so tests can swap engines/storage. */
export function createApp(ctx) {
  const { cfg, log } = ctx;
  const audit = createAudit(log);
  const deps = { ...ctx, audit, authLimiter: authLimiter(cfg) };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.NODE_ENV === 'production' ? 1 : false);
  if (cfg.NODE_ENV !== 'test') app.use(pinoHttp({ logger: log, redact: ['req.headers.cookie', 'req.headers.authorization'], customLogLevel: (_q, res) => (res.statusCode >= 500 ? 'error' : 'info'), serializers: { req: (r) => ({ method: r.method, url: r.url?.split('?')[0], id: r.id }) } }));
  app.use('/api', ...securityMiddleware(cfg));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter(cfg), csrfGuard);
  app.use('/api', systemRoutes(deps));
  app.use('/api/auth', authRoutes(deps));
  app.use('/api/users', userRoutes(deps));
  app.use('/api/projects', projectRoutes(deps));
  app.use('/api', fileRoutes(deps));
  app.use('/api/comparisons', comparisonRoutes(deps));
  app.use('/api/dashboard', dashboardRoutes(deps));
  app.use('/api/admin', adminRoutes(deps));
  const indexHtml = path.join(cfg.FRONTEND_DIST, 'index.html');
  if (cfg.SERVE_FRONTEND && fs.existsSync(indexHtml)) {
    app.use(staticSecurity());
    app.use(express.static(cfg.FRONTEND_DIST, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(indexHtml)); // SPA fallback
  } else if (cfg.SERVE_FRONTEND) log.warn({ dist: cfg.FRONTEND_DIST }, 'SERVE_FRONTEND=true but the frontend is not built (run npm run build)');
  app.use(notFoundHandler);
  app.use(errorHandler(log));
  return app;
}
