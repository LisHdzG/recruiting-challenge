import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Gate against the next route that forgets to validate.
 *
 * It reads the source as text and fails when a route could reach raw client
 * input. It stops an oversight, not someone working around it on purpose.
 */

const ROUTES_DIR = join(import.meta.dirname, '..', 'src', 'routes');
const SERVER = join(import.meta.dirname, '..', 'src', 'server.ts');

const REGISTRATION = /\b\w+\.(get|post|put|patch|delete|all|use)\(/g;
const VALIDATED_REGISTRATION = /\b\w+\.(get|post|put|patch|delete|all)\(\s*'[^']*',\s*validated\(/g;
const RAW_REQUEST = /\breq\b|\bRequest\b|\.(query|body)\b/;

/** Problems found in one route file. */
function problems(source: string): string[] {
  const found: string[] = [];
  const registrations = (source.match(REGISTRATION) ?? []).length;
  const validatedOnes = (source.match(VALIDATED_REGISTRATION) ?? []).length;
  if (registrations === 0) found.push('registers no routes');
  if (registrations !== validatedOnes) {
    found.push(`${registrations - validatedOnes} of ${registrations} routes are not registered through validated()`);
  }
  if (RAW_REQUEST.test(source)) found.push('touches the raw request (req / Request / .query / .body)');
  return found;
}

test('route guard: every route in src/routes goes through validated() and never sees the raw request', () => {
  const files = readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length >= 3, 'expected the route files to be found');
  for (const file of files) {
    assert.deepEqual(problems(readFileSync(join(ROUTES_DIR, file), 'utf8')), [], `src/routes/${file}`);
  }
});

test('route guard: the guard itself recognises the patterns it is meant to stop', () => {
  const good = `r.get('/', validated({ query: parseX }, ({ query, merchantId }, res) => { res.json(query.limit); }));`;
  assert.deepEqual(problems(good), []);
  assert.notDeepEqual(problems(`r.get('/', (req, res) => { res.json(req.query.limit); });`), []);
  assert.notDeepEqual(problems(`r.post('/', handler);`), []);
  assert.notDeepEqual(problems(`r.get('/', validated({}, (input, res) => {})); r.get('/x', other);`), []);
  assert.notDeepEqual(problems(`r.get('/', validated({}, (input, res) => { res.json(input.query); }));`), []);
  assert.notDeepEqual(problems(`r.use(someMiddleware);`), []);
});

test('route guard: server.ts mounts every router behind authMiddleware, and the shared error handler last', () => {
  const server = readFileSync(SERVER, 'utf8');
  const mounts = [...server.matchAll(/app\.use\('\/api\/[^']+',([^)]*)\)/g)];
  assert.ok(mounts.length >= 3, 'routers are mounted');
  for (const mount of mounts) {
    assert.match(mount[1]!, /^\s*authMiddleware\s*,/, `${mount[0]} has authMiddleware first`);
  }
  assert.ok(server.indexOf('app.use(errorHandler)') > mounts.at(-1)!.index!, 'errorHandler is registered after the routers');

  // Routes written directly in server.ts would skip the guard above. Only /api/health may live there.
  const direct = [...server.matchAll(/app\.(get|post|put|patch|delete|all)\('([^']+)'/g)].map((m) => m[2]);
  assert.deepEqual(direct, ['/api/health']);
});
