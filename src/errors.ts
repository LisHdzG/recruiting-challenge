import type { Request, Response, NextFunction } from 'express';
import { ValidationError, type ValidationIssue } from './validation.js';

/**
 * The one place that turns an error into a response.
 *
 * A request the client got wrong is the client's error (4xx) and says which
 * field failed. Only what the client could not have caused is a 500, and its
 * detail stays in the server log.
 *
 * Every 4xx built here has the same shape:
 *   { "error": "<code>", "details": [{ "field": "...", "issue": "..." }] }
 */
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const client = toClientError(err);
  if (client) {
    res.status(client.status).json({ error: client.error, details: client.details });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
}

interface ClientError {
  status: number;
  error: string;
  details: ValidationIssue[];
}

function toClientError(err: unknown): ClientError | undefined {
  if (err instanceof ValidationError) {
    return { status: 400, error: 'invalid_request', details: err.details };
  }
  if (typeof err !== 'object' || err === null) return undefined;
  const { type, status, limit } = err as { type?: unknown; status?: unknown; limit?: unknown };

  // Errors raised by express.json() while reading the body. They carry a `type`.
  if (typeof type === 'string') {
    switch (type) {
      case 'entity.parse.failed':
        return { status: 400, error: 'invalid_request', details: [{ field: 'body', issue: 'must be valid JSON (an object)' }] };
      case 'entity.too.large':
        return {
          status: 413,
          error: 'payload_too_large',
          details: [{ field: 'body', issue: `must not be larger than ${typeof limit === 'number' ? limit : 102400} bytes` }],
        };
      case 'charset.unsupported':
      case 'encoding.unsupported':
        return {
          status: 415,
          error: 'unsupported_media_type',
          details: [{ field: 'Content-Type', issue: 'charset or encoding is not supported; send UTF-8 JSON' }],
        };
      default:
        if (typeof status === 'number' && status >= 400 && status < 500) {
          return { status: 400, error: 'invalid_request', details: [{ field: 'body', issue: 'could not be read' }] };
        }
    }
  }

  // A path that is not valid URL encoding, e.g. /api/orders/%E0%A4%A
  if (err instanceof URIError && status === 400) {
    return { status: 400, error: 'invalid_request', details: [{ field: 'path', issue: 'is not valid URL encoding' }] };
  }
  return undefined;
}
