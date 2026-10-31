/* Node test suite for the ad-free podcast feed: the 5 GB cap, byte ranges, the
 * feed XML, and validation of what the Mac uploads.
 * Run: node --experimental-strip-types worker/test/podcasts.test.mjs          */
import {
  CAP_BYTES, planEviction, parseRange, buildFeed, parseEpisode, normalizeFeedUrl, tokenEquals, escapeXml,
} from '../src/podfeed.ts';

let pass = 0, fail = 0; const failures = [];
const ok = (cond, msg) => { if (cond) pass++; else { fail++; failures.push(msg); } };
const GB = 1_000_000_000;

// --- cap: the "never over 5 GB" rule ---
const ep = (id, day, size) => ({ id, key: `ep/${id}.mp3`, pubDate: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`, addedAt: day, size });
{
  const eps = [ep('a'.repeat(16), 1, 2 * GB), ep('b'.repeat(16), 2, 2 * GB), ep('c'.repeat(16), 3, 0.5 * GB)];
  const objects = eps.map((e) => ({ key: e.key, size: e.size })).concat([{ key: 'cover.png', size: 100 }]);
  const base = { objects, episodes: eps, reserved: 0, pendingKeys: new Set(), cap: CAP_BYTES };

  let p = planEviction({ ...base, incoming: 0.4 * GB });
  ok(p.ok && p.evict.length === 0, 'fits without eviction');

  p = planEviction({ ...base, incoming: 1 * GB });
  ok(p.ok && p.evict.length === 1 && p.evict[0] === 'a'.repeat(16), 'evicts the oldest first, only as much as needed');
  ok(p.total + 1 * GB <= CAP_BYTES, 'result is under the cap');

  p = planEviction({ ...base, incoming: 4.7 * GB });
  ok(p.ok && p.evict.length === 3, 'evicts everything when the newcomer needs it');

  p = planEviction({ ...base, incoming: 5.1 * GB });
  ok(!p.ok, 'refuses a file larger than the cap');

  p = planEviction({ ...base, reserved: 1 * GB, incoming: 0.6 * GB });
  ok(p.ok && p.evict.length === 1, 'bytes promised to in-flight uploads count');

  const orphan = { key: 'ep/' + 'd'.repeat(16) + '.mp3', size: 1 * GB };
  p = planEviction({ ...base, objects: [...objects, orphan], incoming: 0.4 * GB });
  ok(p.orphans.length === 1 && p.evict.length === 0 && p.ok, 'orphaned objects are reclaimed before episodes');

  p = planEviction({ ...base, objects: [...objects, orphan], pendingKeys: new Set([orphan.key]), incoming: 0.4 * GB });
  ok(p.orphans.length === 0 && p.evict.length === 1, 'an object mid-upload is not an orphan');

  p = planEviction({ ...base, objects: objects.filter((o) => !o.key.startsWith('ep/bbbb')), incoming: 0 });
  ok(p.missing.length === 1 && p.missing[0] === 'b'.repeat(16), 'episodes whose object vanished are reported');
}

// --- byte ranges (Downcast seeks/resumes with these) ---
{
  const r = (h) => JSON.stringify(parseRange(h, 1000));
  ok(r(null) === 'null', 'no header → whole file');
  ok(r('bytes=0-') === '{"offset":0,"length":1000}', 'open-ended range');
  ok(r('bytes=100-199') === '{"offset":100,"length":100}', 'closed range');
  ok(r('bytes=900-5000') === '{"offset":900,"length":100}', 'end clamps to size');
  ok(r('bytes=-100') === '{"offset":900,"length":100}', 'suffix range');
  ok(r('bytes=-5000') === '{"offset":0,"length":1000}', 'suffix longer than file');
  ok(r('bytes=1000-') === '"unsatisfiable"', 'start past end → 416');
  ok(r('bytes=5-1') === '"unsatisfiable"', 'reversed range → 416');
  ok(r('bytes=0-1,5-9') === 'null', 'multi-range → whole file');
  ok(r('items=0-1') === 'null', 'other units ignored');
}

// --- episode validation ---
const good = {
  id: '0123456789abcdef', subId: 'deadbeef', show: 'ATP', guid: 'g', title: 'T <b>',
  pubDate: '2026-10-30T12:00:00Z', description: '<p>notes</p>', originalUrl: 'https://example.com/a.mp3',
  duration: 3000, originalDuration: 3300,
  removed: [{ start: 10, end: 100, kind: 'sponsor', advertiser: 'X', source: 'llm' }],
  marked: [{ start: 500, end: 530, kind: 'sponsor', source: 'llm' }],
};
{
  ok(parseEpisode(good)?.id === good.id, 'valid episode parses');
  ok(parseEpisode({ ...good, id: '../etc' }) === null, 'id must be hex');
  ok(parseEpisode({ ...good, removed: [{ start: 5, end: 1 }] }) === null, 'cut end before start rejected');
  ok(parseEpisode({ ...good, originalUrl: 'javascript:alert(1)' }) === null, 'originalUrl must be http(s)');
  ok(parseEpisode({ ...good, pubDate: 'nope' }) === null, 'pubDate must parse');
  ok(parseEpisode({ ...good, description: 'x'.repeat(50000) }).description.length === 20000, 'description is trimmed');
}

// --- feed ---
{
  const e = { ...parseEpisode(good), key: 'ep/0123456789abcdef.mp3', bytes: 12345, addedAt: 1 };
  const older = { ...e, id: 'fedcba9876543210', pubDate: '2026-10-01T00:00:00.000Z', title: 'Older' };
  const xml = buildFeed({ base: 'https://w.example/podcasts/feed/TOK', episodes: [older, e], subs: [{ id: 'deadbeef', feedUrl: 'https://f', title: 'ATP', addedAt: 1 }], hasCover: true });
  ok(xml.includes('<enclosure url="https://w.example/podcasts/feed/TOK/ep/0123456789abcdef.mp3" length="12345" type="audio/mpeg"/>'), 'enclosure points at our copy with its real size');
  ok(xml.indexOf('ATP: T &lt;b&gt;') < xml.indexOf('ATP: Older'), 'newest first, titles escaped');
  ok(xml.includes('<itunes:block>Yes</itunes:block>'), 'feed asks directories not to list it');
  ok(xml.includes('Ads removed: 1 break (1:30).'), 'summary says what was cut');
  ok(xml.includes('<itunes:duration>3000</itunes:duration>'), 'duration is the trimmed length');
  ok(xml.includes('/cover.png'), 'cover when present');
  const nasty = buildFeed({ base: 'b', episodes: [{ ...e, description: 'a]]>b' }], subs: [], hasCover: false });
  ok(!nasty.includes('a]]>b') && nasty.includes('a]]]]><![CDATA[>b'), 'CDATA terminator in notes is split');
  ok(!nasty.includes('cover.png'), 'no cover tag without a cover');
}

// --- misc ---
ok(normalizeFeedUrl('https://atp.fm/rss') === 'https://atp.fm/rss', 'feed url ok');
ok(normalizeFeedUrl('file:///etc/passwd') === null, 'non-http feed url rejected');
ok(normalizeFeedUrl(42) === null, 'non-string feed url rejected');
ok(tokenEquals('abc', 'abc') && !tokenEquals('abd', 'abc') && !tokenEquals('ab', 'abc'), 'token compare');
ok(!tokenEquals('', ''), 'empty expected token never matches');
ok(escapeXml(`<&"'>`) === '&lt;&amp;&quot;&apos;&gt;', 'xml escaping');

console.log(`podcasts: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('  FAIL', f); process.exit(1); }
