import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models/User.js';
import { wrap } from '../utils/async.js';
import { AppError, unauthorized } from '../utils/errors.js';
import { requireAuth, signToken, setAuthCookie, COOKIE } from '../middleware/auth.js';

const password = z.string().min(10, 'Password must be at least 10 characters').max(128)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Password needs upper-case, lower-case and a number');
const registerSchema = z.object({ name: z.string().trim().min(1).max(100), email: z.email().max(254), password });
const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(128) });
// Pre-computed hash so login timing does not reveal whether an email exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

export function authRoutes({ cfg, audit, authLimiter }) {
  const r = Router();

  r.post('/register', authLimiter, wrap(async (req, res) => {
    if (!cfg.ALLOW_REGISTRATION) throw new AppError(403, 'REGISTRATION_DISABLED', 'Registration is disabled. Ask an administrator for an account.');
    const body = registerSchema.parse(req.body);
    if (await User.exists({ email: body.email.toLowerCase() })) throw new AppError(409, 'EMAIL_IN_USE', 'An account with this email already exists');
    const isFirst = (await User.estimatedDocumentCount()) === 0; // first account bootstraps the admin
    const user = await User.create({ name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, 12), role: isFirst ? 'admin' : 'user' });
    req.user = user; await audit(req, 'auth.register', { type: 'User', id: user._id });
    setAuthCookie(cfg, res, signToken(cfg, user));
    res.status(201).json({ data: { user } });
  }));

  r.post('/login', authLimiter, wrap(async (req, res) => {
    const { email, password: pw } = loginSchema.parse(req.body);
    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
    const ok = await bcrypt.compare(pw, user?.passwordHash || DUMMY_HASH);
    if (!user || !ok || user.status !== 'active') { await audit({ ip: req.ip }, 'auth.login_failed', { type: 'User' }, { emailHash: undefined }); throw unauthorized('Incorrect email or password'); }
    user.lastLoginAt = new Date(); await user.save();
    req.user = user; await audit(req, 'auth.login', { type: 'User', id: user._id });
    setAuthCookie(cfg, res, signToken(cfg, user));
    res.json({ data: { user } });
  }));

  r.post('/logout', wrap(async (_req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ data: { ok: true } }); }));
  r.get('/me', requireAuth(cfg), wrap(async (req, res) => res.json({ data: { user: req.user } })));
  return r;
}

export function userRoutes({ cfg, audit }) {
  const r = Router(); r.use(requireAuth(cfg));
  r.patch('/me', wrap(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    req.user.name = name; await req.user.save(); await audit(req, 'user.update_profile', { type: 'User', id: req.user._id });
    res.json({ data: { user: req.user } });
  }));
  r.post('/me/password', wrap(async (req, res) => {
    const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1), newPassword: password }).parse(req.body);
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw new AppError(400, 'WRONG_PASSWORD', 'Current password is incorrect');
    user.passwordHash = await bcrypt.hash(newPassword, 12); user.tokenVersion += 1; await user.save(); // invalidates other sessions
    await audit(req, 'user.change_password', { type: 'User', id: user._id });
    setAuthCookie(cfg, res, signToken(cfg, user));
    res.json({ data: { ok: true } });
  }));
  return r;
}
