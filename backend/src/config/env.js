import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const root = path.resolve(import.meta.dirname, '../..');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().default('ArtworkGuard'),
  PORT: z.coerce.number().int().default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/artworkguard'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'), // comma-separated allow-list
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  JWT_EXPIRES_IN: z.string().default('8h'),
  COOKIE_SECURE: bool.optional(),
  ALLOW_REGISTRATION: bool.default('true'),
  UPLOAD_DIR: z.string().default(path.join(root, 'storage/uploads')),
  REPORT_DIR: z.string().default(path.join(root, 'storage/reports')),
  PAGE_IMAGE_DIR: z.string().default(path.join(root, 'storage/pages')),
  TEMP_DIR: z.string().default(path.join(root, 'storage/tmp')),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
  MAX_PAGES: z.coerce.number().int().positive().default(100),
  PYTHON_BIN: z.string().default(path.resolve(root, '../engine/.venv/bin/python')),
  COMPARISON_ENGINE: z.string().default('native-pdfjs-opencv'),
  COMPARISON_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),
  VISUAL_DPI: z.coerce.number().int().min(50).max(600).default(150), // MINIMUM dpi; pages are rendered higher if needed
  VISUAL_TARGET_PX: z.coerce.number().int().min(1000).max(8000).default(4000), // desired pixels on a page's longest side
  VISUAL_MAX_PIXELS: z.coerce.number().int().min(1_000_000).max(60_000_000).default(20_000_000), // per-page memory cap
  VISUAL_SENSITIVITY: z.enum(['standard', 'high']).default('standard'),
  JOB_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  RETENTION_DAYS: z.coerce.number().int().min(0).default(0), // 0 = keep forever
  SERVE_FRONTEND: bool.default('false'), // serve ../frontend/dist (SPA) from this process
  FRONTEND_DIST: z.string().default(path.resolve(root, '../frontend/dist')),
  LOG_LEVEL: z.string().default('info'),
  RATE_LIMIT_MAX: z.coerce.number().int().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(20),
});

export function loadConfig(rawEnv = process.env) {
  // A blank value in .env ("JWT_SECRET=") means "not set": fall back to the default instead of failing validation.
  const env = Object.fromEntries(Object.entries(rawEnv).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  const c = parsed.data;
  if (!c.JWT_SECRET) {
    if (c.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production');
    // Development/test only: ephemeral secret, sessions reset on restart.
    c.JWT_SECRET = crypto.randomBytes(48).toString('hex');
    c.__ephemeralSecret = true;
  }
  c.COOKIE_SECURE ??= c.NODE_ENV === 'production';
  c.origins = c.FRONTEND_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  c.maxUploadBytes = Math.round(c.MAX_UPLOAD_MB * 1024 * 1024);
  return Object.freeze(c);
}