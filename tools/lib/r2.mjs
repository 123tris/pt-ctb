// A small Cloudflare R2 client over its S3 API, with no dependencies: AWS Signature Version 4 signing plus the four
// calls publishing needs (list, get, put, delete). Used by tools/r2-sync.mjs.
//
// Credentials come from the environment: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (an R2 API token's
// S3 keys; see SETUP-HOSTING.md). Nothing here ever prints them.

import { createHash, createHmac } from 'node:crypto';

const sha256Hex = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding, as SigV4 wants it: everything but A–Z a–z 0–9 - _ . ~ is %XX (also !'()* that encodeURIComponent keeps). */
const encode = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
/** An object key as a URL path: each segment encoded, the slashes kept. */
export const encodePath = key => key.split('/').map(encode).join('/');

/**
 * The SigV4 Authorization header for a request. `headers` (lowercase names) must already hold every header to sign,
 * including host, x-amz-date and x-amz-content-sha256; `query` is a plain object.
 */
export function authorization({ method, path, query = {}, headers, credentials, region, service = 's3' }) {
  const amzDate = headers['x-amz-date'];
  const day = amzDate.slice(0, 8);
  const names = Object.keys(headers).map(n => n.toLowerCase()).sort();
  const canonicalQuery = Object.keys(query).sort().map(k => `${encode(k)}=${encode(String(query[k]))}`).join('&');
  const canonicalHeaders = names.map(n => `${n}:${String(headers[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, headers['x-amz-content-sha256']].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/** The R2 credentials from the environment, or an error naming what's missing (never the values). */
export function credentialsFromEnv(env = process.env) {
  const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter(n => !env[n]);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}. Set them as described in SETUP-HOSTING.md ("Data on R2").`);
  return { accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY };
}

const xmlText = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tag = (xml, name) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];

/**
 * Parses one ListObjectsV2 page: { objects: [{ key, etag (bare md5 hex), size, modified (ms) }], next (continuation
 * token or null) }.
 */
export function parseList(xml) {
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, c]) => ({
    key: xmlText(tag(c, 'Key')),
    etag: xmlText(tag(c, 'ETag') ?? '').replace(/"/g, ''),
    size: Number(tag(c, 'Size')),
    modified: Date.parse(tag(c, 'LastModified') ?? '') || 0,
  }));
  const next = tag(xml, 'IsTruncated') === 'true' ? xmlText(tag(xml, 'NextContinuationToken') ?? '') : null;
  return { objects, next };
}

/** R2's billing class for a call: 'A' (list, put), 'B' (get, head) or null (delete is free). */
export const operationClass = (method, query = {}) =>
  method === 'DELETE' ? null : method === 'PUT' || 'list-type' in query ? 'A' : 'B';

/**
 * A client for one account. `fetchImpl` and `now` exist for tests. `onOperation(cls)` hears about every request sent
 * (retries included), with its billing class, before it goes out; if it throws, nothing is sent (tools/r2-sync.mjs
 * uses this for its usage caps). Every call retries network errors and 5xx/429 answers a few times, then throws with
 * the status and R2's error code, so a failed publish says why and stops.
 */
export function r2Client(credentials, { fetchImpl = fetch, now = () => new Date(), endpoint, onOperation = () => {} } = {}) {
  const base = new URL(endpoint ?? `https://${credentials.accountId}.r2.cloudflarestorage.com`);

  async function send(method, bucket, key = '', { query = {}, body = null, headers = {} } = {}) {
    const path = `/${encode(bucket)}${key ? `/${encodePath(key)}` : ''}`;
    const url = new URL(path, base);
    // Same encoding as the signature (URLSearchParams would write ~ and * differently).
    url.search = Object.entries(query).map(([k, v]) => `${encode(k)}=${encode(String(v))}`).join('&');
    const payload = body ?? '';
    for (let attempt = 1; ; attempt++) {
      const amzDate = now().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
      const signed = { host: url.host, 'x-amz-date': amzDate, 'x-amz-content-sha256': sha256Hex(payload) };
      const extra = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
      const auth = authorization({ method, path, query, headers: signed, credentials, region: 'auto' });
      let res;
      onOperation(operationClass(method, query));
      try {
        res = await fetchImpl(url, {
          method,
          headers: { ...extra, 'x-amz-date': signed['x-amz-date'], 'x-amz-content-sha256': signed['x-amz-content-sha256'], Authorization: auth },
          body: body ?? undefined,
        });
      } catch (e) {
        if (attempt < 4) { await sleep(500 * attempt); continue; }
        throw new Error(`R2 ${method} ${bucket}/${key}: ${e.message}`);
      }
      if ((res.status >= 500 || res.status === 429) && attempt < 4) { await sleep(500 * attempt); continue; }
      return res;
    }
  }

  const fail = async (res, what) => {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 ${what}: ${res.status} ${tag(text, 'Code') ?? ''} ${tag(text, 'Message') ?? ''}`.trim());
  };

  return {
    /**
     * Throws unless the bucket exists and these keys may use it. A one-key list rather than HeadBucket, because an
     * "Object Read & Write" token is only promised object calls (read, write, list).
     */
    async check(bucket) {
      const res = await send('GET', bucket, '', { query: { 'list-type': '2', 'max-keys': '1' } });
      if (!res.ok) throw new Error(`R2 bucket ${bucket}: ${res.status}${res.status === 403 ? ' (the API token may not cover this bucket)' : res.status === 404 ? ' (no such bucket)' : ''}`);
    },
    /** Every object in the bucket: [{ key, etag, size }]. */
    async list(bucket) {
      const objects = [];
      let token = null;
      do {
        const query = { 'list-type': '2', 'max-keys': '1000', ...(token ? { 'continuation-token': token } : {}) };
        const res = await send('GET', bucket, '', { query });
        if (!res.ok) await fail(res, `list ${bucket}`);
        const page = parseList(await res.text());
        objects.push(...page.objects);
        token = page.next;
      } while (token);
      return objects;
    },
    /** The object's bytes, or null if it doesn't exist. */
    async get(bucket, key) {
      const res = await send('GET', bucket, key);
      if (res.status === 404) return null;
      if (!res.ok) await fail(res, `get ${bucket}/${key}`);
      return Buffer.from(await res.arrayBuffer());
    },
    /** Uploads `body`; R2 checks it against Content-MD5, so a garbled upload is refused rather than stored. */
    async put(bucket, key, body, headers = {}) {
      const md5 = createHash('md5').update(body).digest('base64');
      const res = await send('PUT', bucket, key, { body, headers: { ...headers, 'Content-MD5': md5 } });
      if (!res.ok) await fail(res, `put ${bucket}/${key}`);
    },
    async delete(bucket, key) {
      const res = await send('DELETE', bucket, key);
      if (!res.ok && res.status !== 404) await fail(res, `delete ${bucket}/${key}`);
    },
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
