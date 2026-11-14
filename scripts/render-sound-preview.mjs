/**
 * Renders the tank's sounds to WAV files without a headset (F6.1,
 * docs/audio.md): the same Web Audio graph the game plays
 * (src/systems/tank-sound-graph.ts), run on an offline context in a
 * headless Chromium, following scripted scenes. For listening at a desk
 * before a headset check, and for looking at spectra while tuning.
 *
 *   node scripts/render-sound-preview.mjs [out-dir] [scene ...]
 *
 * Scenes (all of them by default):
 *   tour      Practice → Tank sounds → Run through, from the driver's seat:
 *             idle, a rev, pulling away through the gears, over grass,
 *             gravel and back to the road, a turn, a halt, the power
 *             traverse, the handwheels.
 *   gunnery   From the gunner's seat with the engine idling: a shell rammed,
 *             the breech closed, the gun fired (the casing in the bin), then
 *             the breech opened by hand, and the turret laid on.
 *   starting  From the driver's seat: the starter, the engine catching, a
 *             gear going in, a grind and the gear after it, a bump, a
 *             cough and a stall.
 *   cruise    From the driver's seat: eight seconds at a medium speed, the
 *             revs climbing from 1800 to 2250 as the tank gathers way from
 *             10 to 14 km/h: what the recording of a real Sherman that
 *             the sounds were measured against does (docs/audio.md).
 *   ground    From the driver's seat at a steady 14 km/h, five seconds on
 *             each: grass, the dirt road, the course's gravel, then with
 *             the left track on the road and the right on the grass verge,
 *             and last at a crawl (4 km/h) on gravel, then on grass.
 *   ground-tracks  The same with the engine and the gears left out: only
 *             what the ground changes.
 *   cornering From the driver's seat on the dirt road: straight at 20 km/h
 *             (only the odd squeak), a gentle turn, a full turn at 20 km/h
 *             (the tracks straining, under the warning), then up to 33 km/h
 *             and a full turn there (straining their hardest: the warning,
 *             and a thrown track if held), and slowing straight.
 *   cornering-tracks  The same with the engine and the gears left out.
 *
 * Needs Playwright's Chromium (docs/testing.md, "In a cloud container").
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = resolve(args[0] ?? join(root, 'artifacts', 'sound-preview'));
const SCENES = ['tour', 'gunnery', 'starting', 'cruise', 'ground', 'ground-tracks', 'cornering', 'cornering-tracks'];
const scenes = args.length > 1 ? args.slice(1) : SCENES;
const RATE = 48000;

/** The page's side: everything the scenes need from the game, as one script. */
const entry = `
  export { TankSoundGraph, createTankVoices } from './src/systems/tank-sound-graph.ts';
  export * from './src/sim/tank-audio.ts';
  export { createFooting, footingBetween } from './src/sim/ground-surface.ts';
  export { SEATS } from './src/sim/cabin.ts';
  export { CASING_FLIGHT, RECOIL } from './src/sim/loading.ts';
  export { IDLE_RPM, CRANK_RPM } from './src/sim/gearbox.ts';
  export { TRACK_GAUGE } from './src/sim/tank-drive.ts';
  export { MAX_TRAVERSE } from './src/sim/comfort.ts';
  export { turretToHull } from './src/sim/interior.ts';
`;

/**
 * Runs in the page. A scene is how long it lasts, where the listener
 * sits, what the tank is doing at each moment (`at(t, voices)`) and the
 * short sounds played on the way (`sounds`: [time, id, seconds?]).
 */
async function renderScene(name, rate) {
  const T = window.TankSound;
  const voices = T.createTankVoices();
  const tour = T.createTourState();
  const idle = (v, load = 0) => {
    T.engineVoice(T.IDLE_RPM, load, v.engine);
    T.driveVoice(T.IDLE_RPM, 0, false, load, v.drive);
  };
  const ease = (t, a, b) => {
    const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  /** The `ground` scenes: what each track is on from each time, s, and at what speed, m/s; a track takes half a second to cross over. */
  const GROUND = [
    [0, 'grass', 'grass', 3.9],
    [5, 'dirt', 'dirt', 3.9],
    [10, 'gravel', 'gravel', 3.9],
    [15, 'dirt', 'grass', 3.9],
    [20, 'gravel', 'gravel', 1.1],
    [25, 'grass', 'grass', 1.1],
  ];
  const leftGround = T.createFooting('grass');
  const rightGround = T.createFooting('grass');
  const ground = (engine) => ({
    seconds: 30,
    seat: 'driver',
    sounds: [],
    at(t, v) {
      let i = 0;
      while (i + 1 < GROUND.length && t >= GROUND[i + 1][0]) i++;
      const now = GROUND[i];
      const was = GROUND[Math.max(0, i - 1)];
      const over = (t - now[0]) / 0.5;
      T.footingBetween(was[1], now[1], over, leftGround);
      T.footingBetween(was[2], now[2], over, rightGround);
      const speed = was[3] + (now[3] - was[3]) * ease(t, now[0], now[0] + 1.5);
      // In third at 14 km/h, in first at a crawl.
      const rpm = speed > 2 ? 2250 : 1200 + (2250 - 1200) * ((speed - 1.1) / 2.8);
      T.engineVoice(rpm, 0.6, v.engine);
      T.driveVoice(rpm, speed, true, 0.6, v.drive);
      if (!engine) {
        v.engine.gain = v.engine.roar = 0;
        v.drive.gearbox = v.drive.final = 0;
      }
      T.trackVoice(speed, speed, v.tracks, leftGround, rightGround);
    },
  });
  /** The `cornering` scenes: from each time, s, the tank's speed, m/s, and its turn rate, rad/s (15°/s is the most it turns). */
  const CORNERS = [
    [0, 5.6, 0],
    [4, 5.6, 0.1],
    [8, 5.6, 0],
    [9.5, 5.6, 0.262],
    [13.5, 9.2, 0],
    [16, 9.2, 0.262],
    [20, 3.9, 0],
  ];
  const cornering = (engine) => ({
    seconds: 24,
    seat: 'driver',
    sounds: [],
    at(t, v) {
      let i = 0;
      while (i + 1 < CORNERS.length && t >= CORNERS[i + 1][0]) i++;
      const now = CORNERS[i];
      const was = CORNERS[Math.max(0, i - 1)];
      const u = ease(t, now[0], now[0] + (now[1] !== was[1] ? 2 : 0.6));
      const speed = was[1] + (now[1] - was[1]) * u;
      const yaw = was[2] + (now[2] - was[2]) * u;
      const rpm = 1500 + 800 * Math.min(1, speed / 9.2);
      T.engineVoice(rpm, 0.6, v.engine);
      T.driveVoice(rpm, speed, true, 0.6, v.drive);
      if (!engine) {
        v.engine.gain = v.engine.roar = 0;
        v.drive.gearbox = v.drive.final = 0;
      }
      T.trackVoice(speed - (yaw * T.TRACK_GAUGE) / 2, speed + (yaw * T.TRACK_GAUGE) / 2, v.tracks);
    },
  });
  const scenesByName = {
    ground: ground(true),
    'ground-tracks': ground(false),
    cornering: cornering(true),
    'cornering-tracks': cornering(false),
    tour: {
      seconds: T.TOUR_SECONDS + 1,
      seat: 'driver',
      sounds: [],
      at(t, v) {
        const s = T.soundTour(t, tour);
        T.engineVoice(s.rpm, s.load, v.engine);
        T.driveVoice(s.rpm, (s.left + s.right) / 2, s.inGear, s.load, v.drive);
        T.trackVoice(s.left, s.right, v.tracks, s.leftGround, s.rightGround);
        T.traverseVoice(s.traverse, v.traverse);
        T.handGearVoice(s.crank, s.wheel, v.handGear);
      },
    },
    gunnery: {
      seconds: 14,
      seat: 'gunner',
      sounds: [
        [1.5, 'ram'],
        [2.6, 'breech'],
        [4.2, 'shot'],
        [4.2 + T.RECOIL.back + T.CASING_FLIGHT, 'casing'],
        [7.6, 'ram'],
        [8.5, 'breech'],
        [9.6, 'latch'],
      ],
      at(t, v) {
        idle(v);
        // Laying on after the breech is opened: the handwheel, then the power traverse.
        T.handGearVoice(0, 1.5 * (ease(t, 10.3, 10.6) - ease(t, 11.2, 11.5)), v.handGear);
        const rate = T.MAX_TRAVERSE * 0.7 * (ease(t, 11.6, 12.2) - ease(t, 12.8, 13.3));
        T.traverseVoice(rate, v.traverse);
        v.turretYaw = 0;
      },
    },
    starting: {
      seconds: 16,
      seat: 'driver',
      sounds: [
        [2.3, 'catch'],
        [5.5, 'clunk'],
        [9.2, 'clunk'],
        [10.6, 'bump'],
        [12.2, 'cough'],
        [13.4, 'stall'],
      ],
      at(t, v) {
        // The starter turns it for 1.8 s, it catches and settles to idle; later a cough, and a stall.
        let rpm = 0;
        if (t >= 0.5 && t < 2.3) rpm = T.CRANK_RPM * ease(t, 0.5, 1);
        else if (t >= 2.3 && t < 13.4) rpm = T.CRANK_RPM + (T.IDLE_RPM - T.CRANK_RPM) * (1 - Math.exp(-(t - 2.3) / 0.35));
        else if (t >= 13.4) rpm = T.IDLE_RPM * Math.exp(-(t - 13.4) / 0.3);
        // A blip of the throttle before moving off.
        const blip = ease(t, 3.8, 4.2) - ease(t, 4.4, 5);
        rpm += 700 * blip * (t < 13.4 ? 1 : 0);
        const load = 0.8 * blip;
        T.engineVoice(rpm, load, v.engine);
        T.driveVoice(rpm, 0, t >= 5.5 && t < 7.4, load, v.drive);
        v.cranking = t >= 0.5 && t < 2.3;
        // A change without the clutch: the gears grind until it is pressed.
        v.grinding = t >= 7.6 && t < 9.1;
      },
    },
    cruise: {
      seconds: 8,
      seat: 'driver',
      sounds: [],
      at(t, v) {
        const u = ease(t, 0.5, 7.5);
        const rpm = 1800 + 450 * u;
        const speed = 2.8 + 1.2 * u;
        T.engineVoice(rpm, 0.6, v.engine);
        T.driveVoice(rpm, speed, true, 0.6, v.drive);
        T.trackVoice(speed, speed, v.tracks);
      },
    },
  };
  const scene = scenesByName[name];
  if (!scene) throw new Error('No scene called ' + name);
  const ctx = new OfflineAudioContext(2, Math.round(scene.seconds * rate), rate);
  const graph = new T.TankSoundGraph(ctx, 1);
  // The listener: seated, looking forward (the gunner's seat is in turret space, the turret straight ahead).
  const eye = T.SEATS[scene.seat].eye;
  const at = scene.seat === 'gunner' ? T.turretToHull(eye, 0, [0, 0, 0]) : eye;
  graph.setListener(at[0], at[1], at[2], 0, 0, -1, 0, 1, 0, 0);
  // The pins squeak at random, as the game's do (the same seed, so the same squeaks each render).
  const squeaks = new T.SqueakTimer();
  const squeak = T.createSqueak();
  for (let t = 0; t < scene.seconds; t += 0.05) {
    scene.at(t, voices);
    graph.apply(voices, t);
    if (squeaks.step(0.05, voices.tracks, squeak)) graph.squeak(squeak.side, squeak.variant, squeak.level, t);
  }
  for (const [t, id, seconds] of scene.sounds) graph.play(id, t, seconds ?? 0);
  const rendered = await ctx.startRendering();
  // 16-bit PCM, interleaved, as base64 (a page can't hand back a typed array).
  const left = rendered.getChannelData(0);
  const right = rendered.getChannelData(1);
  const pcm = new Int16Array(left.length * 2);
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    pcm[2 * i] = Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767)));
    pcm[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767)));
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { pcm: btoa(binary), peak, seconds: scene.seconds };
}

function wav(pcm, rate, channels) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'ts' },
  bundle: true,
  format: 'iife',
  globalName: 'TankSound',
  write: false,
  logLevel: 'error',
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error(`[page] ${error.message}`));
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.addScriptTag({ content: renderScene.toString() });
  mkdirSync(outDir, { recursive: true });
  for (const name of scenes) {
    const started = Date.now();
    const result = await page.evaluate(([n, r]) => renderScene(n, r), [name, RATE]);
    const file = join(outDir, `tank-sounds-${name}.wav`);
    writeFileSync(file, wav(Buffer.from(result.pcm, 'base64'), RATE, 2));
    console.log(`${file}: ${result.seconds} s, peak ${result.peak.toFixed(3)}, rendered in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
} finally {
  await browser.close();
}
