/*
 * Multi Sig Vault service worker.
 *
 * This file is deliberately generic and STABLE: it contains no build hashes or version strings,
 * so its bytes do not change between releases and the browser never swaps it during a normal
 * release. Releases are downloaded, verified and activated by the application itself
 * (src/lib/update) – only after the user agrees. The worker just serves the ACTIVE release.
 *
 * Storage layout (Cache API, shared with the page):
 *   msv-meta                 "<scope>__msv/active"  -> { id, version }   pointer to the active release
 *   msv-release-<id>         every file of release <id>, keyed by absolute URL
 */
var META_CACHE = 'msv-meta';
var RELEASE_PREFIX = 'msv-release-';
var SCOPE = self.registration.scope;
var ACTIVE_URL = SCOPE + '__msv/active';
var HEX64 = /^[0-9a-f]{64}$/;

var activeRelease = null;

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}

function sha256Hex(data) {
  return crypto.subtle.digest('SHA-256', data).then(toHex);
}

function isSafePath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length < 512 &&
    !/[\\?#\n\t\r]/.test(path) &&
    path[0] !== '/' &&
    path.indexOf(':') === -1 &&
    path.split('/').every(function (seg) {
      return seg !== '' && seg !== '.' && seg !== '..';
    })
  );
}

/* Must stay identical to canonicalRelease() in src/lib/update/releaseCore.mjs. */
function canonicalRelease(version, files) {
  var sorted = files.slice().sort(function (a, b) {
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return (
    'msv-release-v1\n' +
    version +
    '\n' +
    sorted
      .map(function (f) {
        return f.path + '\t' + f.sha256 + '\n';
      })
      .join('')
  );
}

function computeReleaseId(version, files) {
  return sha256Hex(new TextEncoder().encode(canonicalRelease(version, files)));
}

async function readActive() {
  if (activeRelease) return activeRelease;
  var meta = await caches.open(META_CACHE);
  var res = await meta.match(ACTIVE_URL);
  if (!res) return null;
  try {
    var value = await res.json();
    if (value && typeof value.id === 'string' && HEX64.test(value.id)) activeRelease = value;
  } catch (e) {
    activeRelease = null;
  }
  return activeRelease;
}

async function fetchVerified(file) {
  var res = await fetch(SCOPE + file.path, { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + file.path);
  var body = await res.arrayBuffer();
  if ((await sha256Hex(body)) !== file.sha256) throw new Error('Hash mismatch for ' + file.path);
  var headers = { 'Content-Length': String(body.byteLength) };
  var type = res.headers.get('Content-Type');
  if (type) headers['Content-Type'] = type;
  return new Response(body, { status: 200, headers: headers });
}

/* First install only: make the release the page was just loaded from available offline. */
async function primeFirstRelease() {
  var res = await fetch(SCOPE + 'release.json', { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new Error('release.json: HTTP ' + res.status);
  var manifest = await res.json();
  if (
    !manifest ||
    typeof manifest.version !== 'string' ||
    /[\n\t\r]/.test(manifest.version) ||
    !HEX64.test(manifest.id) ||
    !Array.isArray(manifest.files) ||
    !manifest.files.every(function (f) {
      return f && isSafePath(f.path) && HEX64.test(f.sha256);
    })
  ) {
    throw new Error('release.json: malformed');
  }
  if ((await computeReleaseId(manifest.version, manifest.files)) !== manifest.id) {
    throw new Error('release.json: id does not match content');
  }
  var cache = await caches.open(RELEASE_PREFIX + manifest.id);
  var queue = manifest.files.slice();
  async function worker() {
    for (var file = queue.shift(); file; file = queue.shift()) {
      await cache.put(SCOPE + file.path, await fetchVerified(file));
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  var meta = await caches.open(META_CACHE);
  // The page may have primed a release meanwhile – never overwrite an existing pointer.
  if (!(await meta.match(ACTIVE_URL))) {
    await meta.put(
      ACTIVE_URL,
      new Response(JSON.stringify({ id: manifest.id, version: manifest.version }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    (async function () {
      // With an active release this is a new sw.js replacing an old one: leave the release alone.
      // Taking over at once is safe – the worker serves the same verified files either way.
      if (!(await readActive())) await primeFirstRelease();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', function (event) {
  var data = event.data;
  if (!data || data.type !== 'msv-release-changed') return;
  activeRelease = null;
  // Acknowledge so the page reloads only after the old pointer is forgotten.
  if (event.ports && event.ports[0]) event.ports[0].postMessage('ok');
});

async function respond(request, url) {
  var active = await readActive();
  if (!active) return fetch(request);
  var cache = await caches.open(RELEASE_PREFIX + active.id);
  var path = url.pathname.slice(new URL(SCOPE).pathname.length);
  var key = request.mode === 'navigate' || path === '' ? SCOPE + 'index.html' : SCOPE + path;
  var hit = await cache.match(key);
  // Not part of the active release (first load, evicted cache, dev): let the network answer.
  return hit || fetch(request);
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin || url.href.indexOf(SCOPE) !== 0) return;
  var path = url.pathname.slice(new URL(SCOPE).pathname.length);
  // The manifest and the worker itself always come from the network; meta keys are never served.
  if (path === 'release.json' || path === 'sw.js' || path.indexOf('__msv/') === 0) return;
  // The updater downloads the next release with cache: 'no-store'. Answering that from the active
  // release would hand it the old index.html, and the new release would never pass verification.
  if (request.cache === 'no-store') return;
  event.respondWith(respond(request, url));
});
