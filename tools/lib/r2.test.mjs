// The SigV4 signer against AWS's published S3 examples ("Signature Calculations for the Authorization Header",
// Amazon S3 API reference), and the list parser and client against a fake R2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorization, encodePath, parseList, r2Client } from './r2.mjs';

const credentials = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const host = 'examplebucket.s3.amazonaws.com';
const signature = auth => auth.match(/Signature=(\w+)/)[1];

test('SigV4: GET Object with a Range header', () => {
  const auth = authorization({
    method: 'GET', path: '/test.txt', credentials, region: 'us-east-1',
    headers: { host, range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY, 'x-amz-date': '20130524T000000Z' },
  });
  assert.equal(signature(auth), 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.match(auth, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, /);
});

test('SigV4: PUT Object, with a key that needs encoding', () => {
  const auth = authorization({
    method: 'PUT', path: `/${encodePath('test$file.text')}`, credentials, region: 'us-east-1',
    headers: {
      date: 'Fri, 24 May 2013 00:00:00 GMT', host, 'x-amz-date': '20130524T000000Z',
      'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      'x-amz-content-sha256': '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
    },
  });
  assert.equal(signature(auth), '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

test('SigV4: GET Bucket lifecycle (a query parameter without a value)', () => {
  const auth = authorization({
    method: 'GET', path: '/', query: { lifecycle: '' }, credentials, region: 'us-east-1',
    headers: { host, 'x-amz-date': '20130524T000000Z', 'x-amz-content-sha256': EMPTY },
  });
  assert.equal(signature(auth), 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
});

test('SigV4: list objects (sorted query parameters)', () => {
  const auth = authorization({
    method: 'GET', path: '/', query: { prefix: 'J', 'max-keys': '2' }, credentials, region: 'us-east-1',
    headers: { host, 'x-amz-date': '20130524T000000Z', 'x-amz-content-sha256': EMPTY },
  });
  assert.equal(signature(auth), '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});

test('parseList reads keys, bare ETags, sizes, modification times and the continuation token', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>b</Name><IsTruncated>true</IsTruncated>
    <Contents><Key>players/1.json</Key><LastModified>2026-10-26T01:02:03.000Z</LastModified><ETag>&quot;0cc175b9c0f1b6a831c399e269772661&quot;</Key2><Size>1</Size></Contents>
    <Contents><Key>a &amp; b.json</Key><ETag>"92eb5ffee6ae2fec3ad71c777531578f"</ETag><Size>12</Size></Contents>
    <NextContinuationToken>tok/en=</NextContinuationToken></ListBucketResult>`.replace('</Key2>', '</ETag>');
  assert.deepEqual(parseList(xml), {
    objects: [
      { key: 'players/1.json', etag: '0cc175b9c0f1b6a831c399e269772661', size: 1, modified: Date.parse('2026-10-26T01:02:03Z') },
      { key: 'a & b.json', etag: '92eb5ffee6ae2fec3ad71c777531578f', size: 12, modified: 0 },
    ],
    next: 'tok/en=',
  });
  assert.equal(parseList('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>').next, null);
});

test('the client signs for R2, sends Content-MD5 on put, pages through lists and reports R2 errors', async () => {
  const seen = [];
  const pages = [
    '<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>a.json</Key><ETag>"x"</ETag><Size>1</Size></Contents><NextContinuationToken>T2</NextContinuationToken></ListBucketResult>',
    '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>b.json</Key><ETag>"y"</ETag><Size>2</Size></Contents></ListBucketResult>',
  ];
  let failNext = 0;
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), ...init });
    if (failNext-- > 0) return new Response('<Error><Code>InternalError</Code></Error>', { status: 500 });
    if (init.method === 'GET' && url.searchParams.get('list-type')) return new Response(pages[url.searchParams.has('continuation-token') ? 1 : 0]);
    if (url.pathname.endsWith('/denied.json')) return new Response('<Error><Code>AccessDenied</Code><Message>Nope</Message></Error>', { status: 403 });
    return new Response(init.method === 'GET' ? 'body' : null, { status: 200 });
  };
  const client = r2Client({ ...credentials, accountId: 'acc' }, { fetchImpl, now: () => new Date('2026-10-26T01:02:03Z') });

  assert.deepEqual((await client.list('ptcatch-data')).map(o => o.key), ['a.json', 'b.json']);
  assert.equal(seen[0].url, 'https://acc.r2.cloudflarestorage.com/ptcatch-data?list-type=2&max-keys=1000');
  assert.match(seen[0].headers.Authorization, /Credential=AKIAIOSFODNN7EXAMPLE\/20261026\/auto\/s3\/aws4_request/);
  assert.equal(seen[0].headers['x-amz-date'], '20261026T010203Z');
  assert.equal(seen[1].url, 'https://acc.r2.cloudflarestorage.com/ptcatch-data?list-type=2&max-keys=1000&continuation-token=T2');

  await client.put('ptcatch-data', 'players/1.json', Buffer.from('a'), { 'Cache-Control': 'no-cache' });
  const put = seen.at(-1);
  assert.equal(put.url, 'https://acc.r2.cloudflarestorage.com/ptcatch-data/players/1.json');
  assert.equal(put.headers['content-md5'], 'DMF1ucDxtqgxw5niaXcmYQ==');
  assert.equal(put.headers['cache-control'], 'no-cache');
  assert.ok(!JSON.stringify(seen).includes(credentials.secretAccessKey), 'the secret is never sent');

  failNext = 1; // one 500, then it works
  assert.equal(String(await client.get('ptcatch-data', 'x.json')), 'body');

  await assert.rejects(client.put('ptcatch-data', 'denied.json', Buffer.from('a')), /R2 put ptcatch-data\/denied.json: 403 AccessDenied Nope/);
});
