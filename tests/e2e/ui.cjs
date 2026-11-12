// End-to-end check of Woodshed in headless Chromium against a running server.
//   node tests/e2e/ui.cjs <audio file> [screenshot dir]     (BASE=http://localhost:8000 by default)
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8000';
const FILE = process.argv[2];
const SHOTS = process.argv[3] || '.';
const log = (...a) => console.log(...a);
const NOTE = { kick: 36, snare: 38, hihat: 42, tom: 47, cymbal: 49 };
let failures = 0;
const check = (name, ok, detail = '') => { log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`); if (!ok) failures++; };

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 }, acceptDownloads: true });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());

  // ---- import -------------------------------------------------------------
  await page.goto(BASE);
  await page.waitForSelector('[data-testid=import]');
  await page.screenshot({ path: path.join(SHOTS, '1-library.png') });
  await page.setInputFiles('[data-testid=file-input]', FILE);
  await page.fill('[data-testid=import-title]', 'E2E Test Song');
  await page.fill('[data-testid=import-artist]', 'The Fixtures');
  await page.click('[data-testid=import-go]');
  await page.waitForSelector('[data-testid=processing]', { timeout: 30000 });
  const stages = new Set();
  for (let i = 0; i < 900; i++) {
    if (await page.locator('[data-testid=room]').count()) break;
    if (await page.locator('[data-testid=song-error]').count()) throw new Error('import failed: ' + await page.locator('[data-testid=song-error]').innerText());
    stages.add(await page.locator('[data-testid=stage]').innerText().catch(() => ''));
    await page.waitForTimeout(400);
  }
  check('import shows stages', stages.size >= 3, `${stages.size} stages`);
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=score]')?.getAttribute('data-bars')) > 0, null, { timeout: 60000 });
  await page.waitForFunction(() => !!window.__engine, null, { timeout: 90000 });
  const songId = (await page.evaluate(() => location.hash)).split('/').pop();
  const bundle = await (await page.request.get(`${BASE}/api/songs/${songId}/chart`)).json();
  const notes = bundle.derived.notes;
  log('song:', await page.locator('[data-testid=summary]').innerText());
  check('chart rendered', Number(await page.locator('[data-testid=score]').getAttribute('data-bars')) === bundle.derived.bars.length);
  check('noteheads carry chart ids', await page.evaluate((id) => !!document.querySelector(`.score-svg [id="${id}"]`), notes[0].id));

  const eng = (expr) => page.evaluate(`(() => { const e = window.__engine; return ${expr}; })()`);
  // ---- play, mixer --------------------------------------------------------
  await page.click('[data-testid=play]');
  await page.waitForTimeout(1500);
  const t1 = await eng('e.currentTime'); await page.waitForTimeout(2000); const t2 = await eng('e.currentTime');
  check('plays at 1x', Math.abs((t2 - t1) / 2 - 1) < 0.08, `rate ${((t2 - t1) / 2).toFixed(3)}`);
  await page.click('[data-testid=mix-karaoke]');
  check('karaoke preset mutes vocals only', (await eng('e.getGain("vocals")')) === 0 && (await eng('e.getGain("drums")')) === 1);
  await page.click('[data-testid=mix-band]');
  check('band preset mutes drums + vocals', (await eng('e.getGain("drums")')) === 0 && (await eng('e.getGain("bass")')) === 1);
  await page.click('[data-testid=mute-drums]');
  check('mute button toggles a stem back on', (await eng('e.getGain("drums")')) === 1);
  await page.click('[data-testid=mix-full]');
  await page.click('[data-testid=play]');

  // ---- drum scoring with simulated MIDI -----------------------------------
  // a robot drummer: fires each charted note through the MIDI hook when the song reaches it (+ a fixed lateness)
  const robot = (lateMs, families) => page.evaluate(({ notes, NOTE, lateMs, families }) => {
    clearInterval(window.__robot);
    const e = window.__engine; let i = 0; let last = -1;
    window.__robot = setInterval(() => {
      if (!e.playing || e.countingIn) return;
      const t = e.currentTime - lateMs / 1000 * e.speed;
      if (t < last - 0.5) i = 0;            // loop wrapped / seeked back
      last = t;
      while (i < notes.length && notes[i].t < t - 0.3) i++;
      while (i < notes.length && notes[i].t <= t) { if (families.includes(notes[i].family)) window.__woodshedMidi(NOTE[notes[i].family]); i++; }
    }, 4);
  }, { notes, NOTE, lateMs, families });
  const hud = async () => ({
    perfect: parseInt(await page.locator('[data-testid=hud-perfect]').innerText()), good: parseInt(await page.locator('[data-testid=hud-good]').innerText()),
    miss: parseInt(await page.locator('[data-testid=hud-miss]').innerText()), stray: parseInt(await page.locator('[data-testid=hud-stray]').innerText()),
    acc: await page.locator('[data-testid=hud-accuracy]').innerText(),
  });
  const firstBarWithNotes = notes[0].bar;
  await page.locator('[data-testid=loop-from]').fill(String(firstBarWithNotes));
  await page.locator('[data-testid=loop-to]').fill(String(firstBarWithNotes + 2));
  await page.uncheck('[data-testid=count-in]');
  await page.click('[data-testid=reset-score]');
  await robot(0, ['kick', 'snare', 'hihat', 'tom', 'cymbal']);
  await page.click('[data-testid=rewind]');                 // start of the loop
  await page.click('[data-testid=play]');
  const loopLen = await eng('e.loopRange.end - e.loopRange.start');
  await page.waitForTimeout(Math.min(4500, (loopLen - 0.8) * 1000));   // stay inside the first pass
  let h = await hud();
  check('a drummer who plays every note scores ~100%', h.perfect + h.good >= 20 && h.miss <= 1 && h.stray <= 1, JSON.stringify(h));
  const greens = await page.evaluate(() => [document.querySelectorAll('.score-svg [data-verdict=perfect]').length, document.querySelectorAll('[data-verdict]').length, document.querySelectorAll('.score-svg g.note').length]);
  check('hit noteheads turn green', greens[0] > 5, JSON.stringify(greens));
  await page.screenshot({ path: path.join(SHOTS, '2-playing-scored.png') });

  await page.click('[data-testid=reset-score]');
  await robot(0, ['kick', 'snare']);                       // skips hi-hat, toms, cymbals
  await page.waitForTimeout(5000);
  h = await hud();
  check('skipped notes are counted as missed and turn red', h.miss >= 8 && h.perfect + h.good >= 4 && (await page.locator('.score-svg [data-verdict=miss]').count()) > 3, JSON.stringify(h));

  await page.click('[data-testid=reset-score]');
  await robot(60, ['kick', 'snare', 'hihat', 'tom', 'cymbal']);  // consistently 60 ms late
  await page.waitForTimeout(6000);
  h = await hud();
  check('late hits are "good", not "perfect"', h.good > h.perfect && h.miss <= 2, JSON.stringify(h));
  const offer = page.locator('[data-testid=apply-offset]');
  check('offers to absorb a steady lateness as the timing offset', (await offer.count()) === 1);
  if (await offer.count()) {
    await offer.click();
    await page.waitForTimeout(5000);
    h = await hud();
    check('after applying the offset the same hits are perfect', h.perfect > h.good && h.miss <= 2, JSON.stringify(h));
  }
  await page.evaluate(() => { clearInterval(window.__robot); for (let k = 0; k < 5; k++) window.__woodshedMidi(49); });
  await page.waitForTimeout(200);
  check('random extra hits count as extras', (await hud()).stray >= 3);
  await page.click('[data-testid=play]');
  await page.click('[data-testid=loop-clear]');
  await page.evaluate(() => localStorage.removeItem('woodshed.settings.v1'));

  // ---- keyboard player: chord tones light up ------------------------------
  const chordNow = await page.locator('[data-testid=chord-now]').count();
  check('chord strip is shown', chordNow === 1);
  await page.evaluate(() => window.__woodshedMidi(64, 90, 0));   // an E on channel 1 = keyboard
  await page.waitForTimeout(150);
  check('a held keyboard note lights a pitch box', (await page.locator('[data-testid=chord-tones] [data-state=right], [data-testid=chord-tones] [data-state=wrong]').count()) === 1);
  await page.evaluate(() => window.__woodshedMidi(64, 0, 0));

  // ---- instruments dialog -------------------------------------------------
  await page.click('[data-testid=open-settings]');
  await page.evaluate(() => window.__woodshedMidi(41));
  await page.waitForSelector('[data-testid=assign-tom]');
  await page.click('[data-testid=assign-kick]');
  check('pad can be re-mapped by hitting it', (await page.evaluate(() => JSON.parse(localStorage.getItem('woodshed.settings.v1')).padMap['41'])) === 'kick');
  await page.screenshot({ path: path.join(SHOTS, '3-instruments.png') });
  await page.click('[data-testid=settings-close]');
  await page.evaluate(() => localStorage.removeItem('woodshed.settings.v1'));

  // ---- editor -------------------------------------------------------------
  await page.click('[data-testid=mode-edit]');
  const readout0 = await page.locator('[data-testid=meter-readout]').innerText();
  const firstBar0 = bundle.derived.notes[0].bar;
  await page.click('[data-testid=shift-later]');
  await page.waitForSelector('[data-testid=dirty-bar]');
  await page.waitForTimeout(900);
  const preview = await page.evaluate(() => document.querySelector('[data-testid=summary]').textContent);
  check('moving the bar line re-flows the chart and marks it unsaved', (await page.locator('[data-testid=save]').count()) === 1, preview);
  await page.selectOption('[data-testid=beats-per-bar]', '3');
  await page.waitForFunction(() => /^(3\/4|9\/8)$/.test(document.querySelector('[data-testid=meter-readout]').textContent), null, { timeout: 5000 });
  check('beats per bar can be forced', true, `${readout0} -> ${await page.locator('[data-testid=meter-readout]').innerText()}`);
  await page.click('[data-testid=discard]');
  await page.waitForFunction((r) => document.querySelector('[data-testid=meter-readout]')?.textContent === r, readout0, { timeout: 5000 });
  check('discard restores the saved chart', (await page.locator('[data-testid=dirty-bar]').count()) === 0);

  await page.click('[data-testid=tab-drums]');
  await page.waitForSelector('[data-testid=lane-canvas]');
  const count = async () => parseInt(await page.locator('[data-testid=hit-count]').innerText());
  const n0 = await count();
  const box = await page.locator('[data-testid=lane-canvas]').boundingBox();
  await page.mouse.click(box.x + 400, box.y + 22 + 22 * 8 + 11);     // an empty spot in a lower lane
  check('clicking a lane adds a hit', (await count()) === n0 + 1);
  await page.keyboard.press('Delete');
  check('Delete removes the selected hit', (await count()) === n0);
  await page.mouse.click(box.x + 400, box.y + 22 + 22 * 8 + 11);
  await page.mouse.click(box.x + 520, box.y + 22 + 22 * 10 + 11);
  await page.screenshot({ path: path.join(SHOTS, '4-editor-drums.png') });
  check('two hits added', (await count()) === n0 + 2);

  await page.click('[data-testid=tab-chords]');
  await page.fill('[data-testid=chord-2-1]', 'Bbmaj7');
  await page.click('[data-testid=tab-lyrics]');
  await page.fill('[data-testid=lyrics-text]', '[00:03.00] First test line\n[00:06.00] Second test line\n[00:09.00] Third test line');
  await page.click('[data-testid=lyrics-later]');
  await page.screenshot({ path: path.join(SHOTS, '5-editor-lyrics.png') });
  await page.click('[data-testid=save]');
  await page.waitForFunction(() => !document.querySelector('[data-testid=dirty-bar]'), null, { timeout: 10000 });
  const after = await (await page.request.get(`${BASE}/api/songs/${songId}/chart`)).json();
  check('save persists drums, chords and lyrics', after.chart.drums.length === n0 + 2 && after.chart.chords.some((c) => c.name === 'Bbmaj7') && after.chart.lyrics.lines.length === 3 && Math.abs(after.chart.lyrics.offset_s - 0.1) < 1e-6,
    `${after.chart.drums.length} hits, ${after.chart.lyrics.lines.length} lines, offset ${after.chart.lyrics.offset_s}`);
  check('edited chord appears on the chart', (await page.locator('.score-svg .harm').count()) > 0 && (await page.evaluate(() => document.querySelector('.score-svg').textContent.includes('maj7'))));

  // ---- karaoke line follows playback --------------------------------------
  await page.click('[data-testid=mode-play]');
  await page.evaluate(() => window.__engine.seek(2.5));
  await page.click('[data-testid=reset-score]');
  await page.waitForTimeout(10500);                           // scoring stands down after 10 s without a hit
  await page.click('[data-testid=play]');
  await page.waitForTimeout(1500);
  const line1 = await page.locator('[data-testid=lyric-current]').innerText();
  await page.waitForTimeout(3000);
  const line2 = await page.locator('[data-testid=lyric-current]').innerText();
  check('lyrics follow the song', line1.includes('First') && line2.includes('Second'), `"${line1}" -> "${line2}"`);
  await page.screenshot({ path: path.join(SHOTS, '6-karaoke.png') });
  await page.click('[data-testid=play]');

  check('with nobody on the kit, nothing is marked as missed', (await hud()).miss === 0 && (await page.locator('.score-svg [data-verdict=miss]').count()) === 0, JSON.stringify(await hud()));

  // ---- speed, downloads, persistence, revert, delete ----------------------
  await page.locator('[data-testid=speed]').fill('50');
  await page.click('[data-testid=play]');
  await page.waitForTimeout(1200);
  const s1 = await eng('e.currentTime'); await page.waitForTimeout(2000); const s2 = await eng('e.currentTime');
  check('50% speed plays at half rate', Math.abs((s2 - s1) / 2 - 0.5) < 0.06, `rate ${((s2 - s1) / 2).toFixed(3)}`);
  await page.click('[data-testid=play]');
  for (const id of ['dl-musicxml', 'dl-midi']) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-testid=${id}]`)]);
    check(`download ${dl.suggestedFilename()}`, require('fs').statSync(await dl.path()).size > 500);
  }
  await page.reload();
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=score]')?.getAttribute('data-bars')) > 0, null, { timeout: 60000 });
  check('edits survive a reload', (await page.locator('[data-testid=song-title]').innerText()).includes('E2E Test Song'));
  await page.click('[data-testid=mode-edit]');
  await page.click('[data-testid=revert]');
  await page.waitForTimeout(800);
  const reverted = await (await page.request.get(`${BASE}/api/songs/${songId}/chart`)).json();
  check('"start over" restores the machine draft', reverted.chart.drums.length === n0 && reverted.chart.lyrics.lines.length !== 3);
  await page.click('[data-testid=to-library]');
  await page.waitForSelector('[data-testid=library]');
  await page.click(`[data-testid=delete-${songId}]`);
  await page.waitForTimeout(500);
  check('song can be deleted', (await page.request.get(`${BASE}/api/songs/${songId}`)).status() === 404);

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
