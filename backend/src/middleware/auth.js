import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { unauthorized, forbidden } from '../utils/errors.js';

export const COOKIE = 'ag_token';

export function signToken(cfg, user) {
  return jwt.sign({ sub: String(user._id), tv: user.tokenVersion ?? 0 }, cfg.JWT_SECRET, { expiresIn: cfg.JWT_EXPIRES_IN, algorithm: 'HS256' });
}

export function setAuthCookie(cfg, res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: cfg.COOKIE_SAMESITE, secure: cfg.COOKIE_SECURE, path: '/', maxAge: 8 * 3600 * 1000 });
}

export const requireAuth = (cfg) => async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    const token = req.cookies?.[COOKIE] || (header?.startsWith('Bearer ') ? header.slice(7) : null);
    if (!token) throw unauthorized();
    let payload;
    try { payload = jwt.verify(token, cfg.JWT_SECRET, { algorithms: ['HS256'] }); } catch { throw unauthorized('Session expired or invalid'); }
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active' || (user.tokenVersion ?? 0) !== payload.tv) throw unauthorized('Session expired or invalid');
    req.user = user;
    next();
  } catch (e) { next(e); }
};

export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));

/** Owner-scoped filter. Admins may see everything; everyone else only their own records (404 otherwise). */
export const scope = (req, extra = {}) => (req.user.role === 'admin' ? extra : { ...extra, owner: req.user._id });
