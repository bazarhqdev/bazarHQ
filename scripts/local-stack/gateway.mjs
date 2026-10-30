/**
 * Local API gateway with Supabase's URL layout (verification only).
 *
 *   /auth/v1/*       → GoTrue
 *   /rest/v1/*       → PostgREST
 *   /functions/v1/*  → Deno functions router
 *   /storage/v1/*    → small Storage emulation (below)
 *
 * Every request is forwarded with `x-forwarded-for: 127.0.0.1`, like a trusted
 * proxy that overwrites the client address.
 *
 * Storage emulation: the endpoints supabase-js uses (upload, sign, remove,
 * copy) run their storage.objects statements as the caller's Postgres role
 * with the caller's verified JWT claims, the way storage-api does. That way
 * BazarHQ's storage.objects RLS policies decide every access, and bucket size
 * and MIME limits are enforced. Object bytes live in memory.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const REST = process.env.REST_URL;
const AUTH = process.env.AUTH_URL;
const FN = process.env.FN_URL;
const SECRET = process.env.JWT_SECRET;
const PG = process.env.STACK_PG;
if (!REST || !AUTH || !FN || !SECRET || !PG) throw new Error('gateway: missing configuration');

const admin = new Pool({ connectionString: PG, max: 4 });
const asApi = new Pool({ connectionString: PG.replace('postgres@', 'authenticator@'), max: 8 });
const blobs = new Map();

function verifyJwt(token) {
  const parts = (token ?? '').split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (claims.exp && claims.exp * 1000 < Date.now()) return null;
  return claims;
}

function callerClaims(req) {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  return verifyJwt(bearer) ?? verifyJwt(req.headers.apikey);
}

async function asCaller(claims, fn) {
  const role = ['anon', 'authenticated', 'service_role'].includes(claims?.role) ? claims.role : 'anon';
  const client = await asApi.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)", [
      JSON.stringify(claims ?? { role: 'anon' }),
      claims?.sub ?? '',
      role,
    ]);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(data);
}

function storageError(res, e) {
  const code = e?.code;
  if (code === '42501') return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
  if (code === '23505') return send(res, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
  if (e?.status) return send(res, e.status, { statusCode: String(e.status), error: e.error ?? 'Error', message: e.message });
  console.error('storage error', e?.message);
  return send(res, 500, { statusCode: '500', error: 'Internal', message: 'Storage error' });
}

async function bucketLimits(bucket) {
  const r = await admin.query('select id, file_size_limit, allowed_mime_types from storage.buckets where id = $1', [bucket]);
  return r.rows[0] ?? null;
}

function signToken(bucket, name, expiresIn) {
  const exp = Math.floor(Date.now() / 1000) + Number(expiresIn ?? 60);
  const payload = Buffer.from(JSON.stringify({ url: `${bucket}/${name}`, exp })).toString('base64url');
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
}

async function handleStorage(req, res, path, body) {
  const claims = callerClaims(req);
  const url = new URL(path, 'http://local');
  const p = url.pathname;

  // Signed download: /object/sign/{bucket}/{name}?token=
  if (req.method === 'GET' && p.startsWith('/object/sign/')) {
    const key = decodeURIComponent(p.slice('/object/sign/'.length));
    const [payload, sig] = (url.searchParams.get('token') ?? '').split('.');
    const ok = payload && sig && createHmac('sha256', SECRET).update(payload).digest('base64url') === sig;
    const data = ok ? JSON.parse(Buffer.from(payload, 'base64url').toString()) : null;
    if (!data || data.url !== key || data.exp * 1000 < Date.now()) return send(res, 400, { statusCode: '400', error: 'InvalidJWT', message: 'Invalid token' });
    const blob = blobs.get(key);
    if (!blob) return send(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    res.writeHead(200, { 'content-type': blob.type });
    return res.end(blob.bytes);
  }

  // Batch sign: POST /object/sign/{bucket}  { expiresIn, paths }
  if (req.method === 'POST' && /^\/object\/sign\/[^/]+$/.test(p)) {
    const bucket = decodeURIComponent(p.split('/')[3]);
    const { expiresIn, paths } = JSON.parse(body.toString() || '{}');
    const visible = await asCaller(claims, async (c) => {
      const r = await c.query('select name from storage.objects where bucket_id = $1 and name = any($2::text[])', [bucket, paths ?? []]);
      return new Set(r.rows.map((x) => x.name));
    });
    return send(
      res,
      200,
      (paths ?? []).map((name) =>
        visible.has(name)
          ? { error: null, path: name, signedURL: `/object/sign/${bucket}/${name}?token=${signToken(bucket, name, expiresIn)}` }
          : { error: 'Either the object does not exist or you do not have access to it', path: name, signedURL: null },
      ),
    );
  }

  // Copy: POST /object/copy { bucketId, sourceKey, destinationKey }
  if (req.method === 'POST' && p === '/object/copy') {
    const { bucketId, sourceKey, destinationKey } = JSON.parse(body.toString() || '{}');
    await asCaller(claims, async (c) => {
      const src = await c.query('select metadata from storage.objects where bucket_id = $1 and name = $2', [bucketId, sourceKey]);
      if (!src.rows[0]) throw { status: 404, error: 'not_found', message: 'Object not found' };
      await c.query('insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3, $4, $5)', [
        bucketId,
        destinationKey,
        claims?.sub ?? null,
        claims?.sub ?? null,
        src.rows[0].metadata,
      ]);
    });
    const blob = blobs.get(`${bucketId}/${sourceKey}`);
    if (blob) blobs.set(`${bucketId}/${destinationKey}`, blob);
    return send(res, 200, { Key: `${bucketId}/${destinationKey}` });
  }

  // Remove: DELETE /object/{bucket} { prefixes }
  if (req.method === 'DELETE' && /^\/object\/[^/]+$/.test(p)) {
    const bucket = decodeURIComponent(p.split('/')[2]);
    const { prefixes } = JSON.parse(body.toString() || '{}');
    const removed = await asCaller(claims, async (c) => {
      const r = await c.query('delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name', [bucket, prefixes ?? []]);
      return r.rows.map((x) => x.name);
    });
    for (const name of removed) blobs.delete(`${bucket}/${name}`);
    return send(res, 200, removed.map((name) => ({ name, bucket_id: bucket })));
  }

  // Upload: POST|PUT /object/{bucket}/{name...}
  const m = /^\/object\/([^/]+)\/(.+)$/.exec(p);
  if ((req.method === 'POST' || req.method === 'PUT') && m) {
    const bucket = decodeURIComponent(m[1]);
    const name = decodeURIComponent(m[2]);
    const limits = await bucketLimits(bucket);
    if (!limits) return send(res, 404, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
    let bytes = body;
    let type = String(req.headers['content-type'] ?? 'application/octet-stream');
    if (type.startsWith('multipart/form-data')) {
      const form = await new Request('http://local', { method: 'POST', headers: { 'content-type': type }, body }).formData();
      const file = [...form.values()].find((v) => typeof v === 'object' && v !== null && 'arrayBuffer' in v);
      if (!file) return send(res, 400, { statusCode: '400', error: 'Invalid', message: 'No file' });
      bytes = Buffer.from(await file.arrayBuffer());
      type = file.type || 'application/octet-stream';
    }
    if (limits.file_size_limit && bytes.length > Number(limits.file_size_limit)) {
      return send(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
    }
    if (limits.allowed_mime_types?.length && !limits.allowed_mime_types.includes(type.split(';')[0])) {
      return send(res, 415, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${type} is not supported` });
    }
    const id = await asCaller(claims, async (c) => {
      const r = await c.query(
        'insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3, $4, $5) returning id',
        [bucket, name, claims?.sub ?? null, claims?.sub ?? null, JSON.stringify({ size: bytes.length, mimetype: type })],
      );
      return r.rows[0].id;
    });
    blobs.set(`${bucket}/${name}`, { bytes, type });
    return send(res, 200, { Id: id, Key: `${bucket}/${name}` });
  }

  return send(res, 404, { statusCode: '404', error: 'not_found', message: 'Unsupported storage route in local gateway' });
}

async function proxy(req, res, target, body) {
  const headers = { ...req.headers, 'x-forwarded-for': '127.0.0.1', 'x-request-id': randomUUID() };
  delete headers.host;
  delete headers.connection;
  delete headers['content-length'];
  const r = await fetch(target, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    redirect: 'manual',
  });
  const out = {};
  r.headers.forEach((v, k) => {
    if (!['content-encoding', 'transfer-encoding', 'connection', 'content-length'].includes(k) && !k.startsWith('access-control-')) out[k] = v;
  });
  res.writeHead(r.status, out);
  res.end(Buffer.from(await r.arrayBuffer()));
}

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = req.url ?? '/';
    // Browser apps call the gateway cross-origin, as they call *.supabase.co.
    if (req.headers.origin) {
      res.setHeader('access-control-allow-origin', req.headers.origin);
      res.setHeader('access-control-expose-headers', 'content-range, x-request-id, x-supabase-api-version');
      res.setHeader('vary', 'Origin');
    }
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': req.headers.origin ?? '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        });
        return res.end();
      }
      if (url.startsWith('/auth/v1')) return await proxy(req, res, AUTH + url.slice('/auth/v1'.length), body);
      if (url.startsWith('/rest/v1')) return await proxy(req, res, REST + (url.slice('/rest/v1'.length) || '/'), body);
      if (url.startsWith('/functions/v1/')) return await proxy(req, res, FN + url.slice('/functions/v1'.length), body);
      if (url.startsWith('/storage/v1/')) return await handleStorage(req, res, url.slice('/storage/v1'.length), body).catch((e) => storageError(res, e));
      send(res, 404, { message: 'not found' });
    } catch (e) {
      console.error('gateway error', e?.message);
      if (!res.headersSent) send(res, 502, { message: 'bad gateway' });
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`gateway on :${PORT}`));
