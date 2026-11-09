import type { Request, Response, RequestHandler } from 'express';
import { ValidationError, findNestedFields, type ValidationIssue } from './validation.js';

/**
 * Shape check applied to every route: no field of the query string or of the
 * JSON body may be an array or an object, whether the route uses that field or
 * not. It lives inside `validated()`, so every route gets it without doing
 * anything, and it always runs after authentication.
 */
function nestedInputIssues(req: Request): ValidationIssue[] {
  return [
    ...findNestedFields(req.query),
    ...(Array.isArray(req.body) ? [{ field: 'body', issue: 'must be a JSON object' }] : findNestedFields(req.body)),
  ];
}

/** What a route handler gets instead of the raw request. */
export interface ValidatedInput<Q, B> {
  /** Result of the `query` parser, or `undefined` if the route declared none. */
  query: Q;
  /** Result of the `body` parser, or `undefined` if the route declared none. */
  body: B;
  /** The authenticated merchant (set by `authMiddleware`). */
  merchantId: string;
  /** Path parameters, e.g. `:id`. Always text. */
  params: Readonly<Record<string, string>>;
}

/**
 * Wraps a route handler so it only ever sees validated input.
 *
 * In order: the merchant must already be authenticated, then no field may be
 * an array or an object, then the route's own parsers run.
 *
 * The route names the parser for its query string and/or body (from
 * `validation.ts`). The handler receives their results, the merchant and the
 * path parameters, and the response to write to. It never receives the
 * request, so it has no way to read `req.query` or `req.body` unvalidated.
 * `test/route-guard.test.ts` fails if a route is registered any other way.
 */
export function validated<Q = undefined, B = undefined>(
  parsers: { query?: (raw: unknown) => Q; body?: (raw: unknown) => B },
  handler: (input: ValidatedInput<Q, B>, res: Response) => void,
): RequestHandler {
  return (req: Request, res: Response) => {
    if (!req.merchantId) {
      // A server bug, not a client error: the router was mounted without authMiddleware.
      throw new Error('validated() route reached without an authenticated merchant');
    }
    const nested = nestedInputIssues(req);
    if (nested.length > 0) throw new ValidationError(nested);

    const issues: ValidationIssue[] = [];
    const attempt = <T>(parse: ((raw: unknown) => T) | undefined, raw: unknown): T | undefined => {
      if (!parse) return undefined;
      try {
        return parse(raw);
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err;
        issues.push(...err.details);
        return undefined;
      }
    };
    const query = attempt(parsers.query, req.query);
    const body = attempt(parsers.body, req.body);
    if (issues.length > 0) throw new ValidationError(issues);

    // Path parameters are text; anything else is dropped rather than passed on.
    const params: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.params)) {
      if (typeof value === 'string') params[name] = value;
    }

    handler({ query: query as Q, body: body as B, merchantId: req.merchantId, params }, res);
  };
}
