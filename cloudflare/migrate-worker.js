// One-off migration helper: copies objects from the public Supabase Storage
// buckets into R2, running inside Cloudflare's network so nothing has to be
// pulled down to a laptop first. Copy only — it never deletes from either side.
// Delete this Worker once the migration is verified.

const SUPABASE = 'https://pcouznwpyhtfrleedcsv.supabase.co/storage/v1/object/public';

const BUCKETS = {
  'site-assets': 'ASSETS',
  'instructions': 'INSTRUCTIONS'
};

export default {
  async fetch(request, env) {
    if (request.headers.get('x-migrate-token') !== env.MIGRATE_TOKEN) {
      return new Response('no', { status: 401 });
    }
    // GET ?list=<bucket> returns every object with its size, for verification
    const url = new URL(request.url);
    const listBucket = url.searchParams.get('list');
    if (listBucket) {
      const b = env[BUCKETS[listBucket]];
      if (!b) return new Response('unknown bucket', { status: 400 });
      const out = {};
      let cursor;
      do {
        const page = await b.list({ limit: 1000, cursor });
        for (const o of page.objects) out[o.key] = { size: o.size, etag: o.etag };
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return Response.json({ bucket: listBucket, count: Object.keys(out).length, objects: out });
    }

    // GET ?get=<bucket>&path=<key> streams one object back, to verify content
    const getBucket = url.searchParams.get('get');
    if (getBucket) {
      const b = env[BUCKETS[getBucket]];
      if (!b) return new Response('unknown bucket', { status: 400 });
      const obj = await b.get(url.searchParams.get('path'));
      if (!obj) return new Response('not found', { status: 404 });
      return new Response(obj.body);
    }

    const { bucket, paths } = await request.json();
    const binding = env[BUCKETS[bucket]];
    if (!binding) return new Response('unknown bucket', { status: 400 });

    const done = [];
    const failed = [];
    for (const path of paths) {
      try {
        const url = `${SUPABASE}/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
        const res = await fetch(url);
        if (!res.ok) { failed.push({ path, status: res.status }); continue; }
        const body = await res.arrayBuffer();
        await binding.put(path, body, {
          httpMetadata: {
            contentType: res.headers.get('content-type') || 'application/octet-stream',
            cacheControl: 'public, max-age=31536000'
          }
        });
        done.push({ path, size: body.byteLength });
      } catch (e) {
        failed.push({ path, error: String(e).slice(0, 120) });
      }
    }
    return Response.json({ copied: done.length, failed, bytes: done.reduce((n, d) => n + d.size, 0) });
  }
};
