import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/errors.js';

/** CSP for the SPA shell (PDF.js needs a blob: worker; images come from same-origin API URLs). */
export const staticSecurity = () => helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:'], workerSrc: ["'self'", 'blob:'], connectSrc: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"] } } });

export function securityMiddleware(cfg) {
  return [
    helmet({ crossOriginResourcePolicy: { policy: 'same-site' }, contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }),
    cors({
      origin(origin, cb) { // same-origin / curl requests have no Origin header
        if (!origin || cfg.origins.includes(origin)) return cb(null, true);
        return cb(new AppError(403, 'CORS_FORBIDDEN', 'Origin not allowed'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-Requested-With', 'Authorization'],
      maxAge: 600,
    }),
  ];
}

/**
 * CSRF defence for cookie auth: browsers cannot send a custom header cross-site without a CORS preflight,
 * which our origin allow-list rejects. State-changing requests must carry it.
 */
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') === 'ArtworkGuard') return next();
  return next(new AppError(403, 'CSRF_REJECTED', 'Missing required request header'));
}

const limiter = (max, windowMs, code) => rateLimit({
  windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, code, 'Too many requests, please try again later')),
});
export const apiLimiter = (cfg) => limiter(cfg.RATE_LIMIT_MAX, 15 * 60 * 1000, 'RATE_LIMITED');
export const authLimiter = (cfg) => limiter(cfg.AUTH_RATE_LIMIT_MAX, 15 * 60 * 1000, 'AUTH_RATE_LIMITED');
