// Pulls samples straight out of the player (calling its audio callback directly) and checks them numerically.
//   node tests/e2e/engine.cjs "http://localhost:8000/#/song/<id>"
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(process.argv[2]);
  await page.waitForFunction(() => !!window.__engine && Number(document.querySelector('[data-testid=score]')?.getAttribute('data-bars')) > 0, null, { timeout: 90000 });
  const res = await page.evaluate(() => {
    const e = window.__engine, sr = e.sampleRate, N = 2048;
    const render = (blocks) => { const L = new Float32Array(blocks * N); for (let b = 0; b < blocks; b++) { const l = new Float32Array(N), r = new Float32Array(N); e.process({ outputBuffer: { getChannelData: (i) => (i ? r : l) } }); L.set(l, b * N); } return L; };
    const start = (t) => { e.seek(t); e._playing = true; };
    const stem = (n) => e.stems.find((s) => s.name === n).l;
    const only = (names, g = 1) => e.stemNames.forEach((n) => e.setGain(n, names.includes(n) ? g : 0));
    const maxDiff = (a, b, off) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[off + i])); return m; };
    const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
    const zcr = (a) => { let z = 0; for (let i = 1; i < a.length; i++) if ((a[i] >= 0) !== (a[i - 1] >= 0)) z++; return z / a.length; };
    const onsets = (a) => { const h = Math.round(sr * 0.01), env = []; for (let i = 0; i + h <= a.length; i += h) { let s = 0; for (let k = 0; k < h; k++) s += a[i + k] * a[i + k]; env.push(Math.sqrt(s / h)); }
      const peak = Math.max(...env), t = []; for (let i = 2; i < env.length; i++) if (env[i] > 0.25 * peak && env[i] > 2.2 * (env[i - 2] + 1e-4) && (!t.length || i - t[t.length - 1] > 6)) t.push(i); return t.map((i) => (i * h) / sr); };
    const out = {};
    e.clickEnabled = false; e.auditionEnabled = false; e.setLoop(null); e.setSpeed(1);

    // a single stem at full gain is a bit-exact copy; two stems are their exact sum; a fader scales it
    only(['drums']); start(5); out.drumsExact = maxDiff(render(10), stem('drums'), Math.round(5 * sr));
    only(['vocals']); start(5); out.vocalsExact = maxDiff(render(10), stem('vocals'), Math.round(5 * sr));
    only(['drums', 'bass']); start(5); let o = render(10);
    const sum = new Float32Array(o.length); for (let i = 0; i < o.length; i++) sum[i] = stem('drums')[Math.round(5 * sr) + i] + stem('bass')[Math.round(5 * sr) + i];
    out.twoStemSum = maxDiff(o, sum, 0);
    only(['drums'], 0.5); start(5); o = render(10); out.halfGainRatio = +(rms(o) / rms(stem('drums').subarray(Math.round(5 * sr), Math.round(5 * sr) + o.length))).toFixed(3);
    only([]); start(5); out.allMutedSilent = rms(render(10)) === 0;

    // loop wraps sample-accurately
    only(['drums']); e.setLoop({ start: 4, end: 6 }); start(5.9); o = render(10);
    const wrapAt = Math.round(0.1 * sr);
    out.loopBeforeWrap = maxDiff(o.subarray(0, wrapAt), stem('drums'), Math.round(5.9 * sr));
    out.loopAfterWrap = maxDiff(o.subarray(wrapAt, wrapAt + 8000), stem('drums'), Math.round(4 * sr));
    e.setLoop(null);

    // slowed down: exact length, same pitch, hits where expected, no NaN
    const seg = stem('drums').subarray(Math.round(4 * sr), Math.round(12 * sr)); const srcOn = onsets(seg);
    for (const sp of [0.5, 0.75]) {
      e.setSpeed(sp); start(4); o = render(Math.round((8 / sp) * sr / N));
      let nan = 0; for (let i = 0; i < o.length; i++) if (o[i] !== o[i]) nan++;
      const on = onsets(o).map((t) => t * sp); let matched = 0; const used = new Set();
      for (const t of srcOn) { const j = on.findIndex((u, k) => !used.has(k) && Math.abs(u - t) < 0.03); if (j >= 0) { matched++; used.add(j); } }
      out['stretch' + sp] = { nan, srcOnsets: srcOn.length, outOnsets: on.length, matched, zcrRatio: +(zcr(o) / zcr(seg)).toFixed(3), endSong: +(e.songAt(e.vOut) / sr).toFixed(3) };
    }

    // click and audition ticks land on their song times at any speed
    const beats = Array.from(e.beatFrames).map((f) => f / sr), ticks = Array.from(e.auditionFrames).map((f) => f / sr);
    const placed = (flag, times, sp) => {
      e.setSpeed(sp); only(['drums']); const blocks = Math.round((6 / sp) * sr / N);
      e[flag] = false; start(4); const dry = render(blocks); e[flag] = true; start(4); const wet = render(blocks); e[flag] = false;
      const found = []; for (let i = 0; i < wet.length; i++) if (Math.abs(wet[i] - dry[i]) > 1e-4 && (!found.length || i - found[found.length - 1] > sr * 0.04)) found.push(i);
      const expected = times.filter((b) => b >= 4 && b < 10 - 0.05).map((b) => (b - 4) / sp).filter((t, i, a) => i === 0 || t - a[i - 1] > 0.04 );
      const errs = found.map((f) => Math.min(...expected.map((x) => Math.abs(f / sr - x))) * 1000);
      return { expected: expected.length, found: found.length, maxErrMs: +Math.max(0, ...errs).toFixed(2) };
    };
    out.click1 = placed('clickEnabled', beats, 1); out.click05 = placed('clickEnabled', beats, 0.5);
    out.audition1 = placed('auditionEnabled', ticks, 1);

    // count-in lasts exactly one bar, then the music starts on the loop's first sample
    e.setSpeed(1); only(['drums']); const pb = e.perBar; e.setLoop({ start: beats[2 * pb], end: beats[3 * pb] });
    e.seek(beats[2 * pb]); e.countIn = e.buildCountIn(e.loop.start); e._playing = true;
    const total = e.countIn.total; o = render(Math.ceil(total / N) + 4);
    out.countIn = { lengthS: +(total / sr).toFixed(3), barS: +(beats[3 * pb] - beats[2 * pb]).toFixed(3), musicStartsAtLoop: maxDiff(o.subarray(total + 2000, total + 6000), stem('drums'), Math.round(beats[2 * pb] * sr) + 2000) < 1e-6 };
    e._playing = false; e.setLoop(null); e.stemNames.forEach((n) => e.setGain(n, 1));
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  const bad = [];
  if (res.drumsExact || res.vocalsExact || res.twoStemSum > 1e-6 || !res.allMutedSilent) bad.push('mixing');
  if (Math.abs(res.halfGainRatio - 0.5) > 0.01) bad.push('gain');
  if (res.loopBeforeWrap || res.loopAfterWrap) bad.push('loop');
  for (const k of ['stretch0.5', 'stretch0.75']) if (res[k].nan || Math.abs(res[k].endSong - 12) > 0.05 || res[k].zcrRatio < 0.9 || res[k].matched < res[k].srcOnsets * 0.85) bad.push(k);
  for (const k of ['click1', 'click05', 'audition1']) if (res[k].maxErrMs > 1 || res[k].found !== res[k].expected) bad.push(k);
  if (Math.abs(res.countIn.lengthS - res.countIn.barS) > 0.002 || !res.countIn.musicStartsAtLoop) bad.push('count-in');
  console.log(bad.length ? 'FAILED: ' + bad.join(', ') : 'all engine checks passed');
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
