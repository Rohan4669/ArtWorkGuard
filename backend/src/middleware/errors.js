import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from '../utils/errors.js';

export const notFoundHandler = (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found'));

export const errorHandler = (log) => (err, req, res, _next) => {
  let status = 500, code = 'INTERNAL_ERROR', message = 'Something went wrong', details;
  if (err instanceof AppError) ({ status, code, message, details } = err);
  else if (err instanceof ZodError) { status = 400; code = 'VALIDATION_ERROR'; message = 'Invalid input'; details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })); }
  else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'The file exceeds the maximum allowed size' : 'Upload failed';
  } else if (err?.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'Malformed JSON body'; }
  else if (err?.type === 'entity.too.large') { status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body too large'; }
  if (status >= 500) log.error({ err: { name: err?.name, message: err?.message, stack: err?.stack }, path: req.path }, 'unhandled error');
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } }); // never a stack trace
};
