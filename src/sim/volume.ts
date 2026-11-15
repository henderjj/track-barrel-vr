/**
 * The game's volume sliders (docs/volume.md), engine-free: four levels the
 * player sets in the game menu's Sound and view tab, each 0 (off) to 1
 * (full, the mix as tuned), kept in this browser.
 *
 * - Master turns every game sound up or down: the tank and the commander.
 *   The crewmate's own voice is not a game sound and keeps its mute in the
 *   Crew tab.
 * - Engine: the engine's exhaust and roar, the gearbox and final drives'
 *   whine, and the engine's own short sounds (the starter, catching, a
 *   cough, a stall).
 * - Effects: everything else the tank makes: the tracks, the ground, the
 *   gun and the breech, the traverse, the siren, bumps and gears going in.
 * - Commander: his voice over the intercom (docs/commander-voice.md).
 *
 * A slider's level is not a gain: ears hear loudness about as the square
 * root of power, so a slider straight in gain does nearly all its work in
 * its bottom quarter. The gain is the level squared: half way is −12 dB,
 * a tenth is −40 dB.
 */

/** The settings that are volumes, as their keys in `Settings`, the URL and the saved settings. */
export type VolumeKey = 'sound' | 'enginevol' | 'effectsvol' | 'commander';

/** Which slider a tank sound answers to, under Master. */
export type SoundGroup = 'engine' | 'effects';

/** The slider snaps to this, of full. */
export const VOLUME_STEP = 0.05;
/** The − and + buttons beside it step by this, of full, landing on whole steps. */
export const VOLUME_BUTTON_STEP = 0.1;

/** The gain for a slider's `level` (0 to 1): the level squared. */
export function volumeGain(level: number): number {
  const l = Math.min(1, Math.max(0, level));
  return l * l;
}

/** A slider's level from where along its track it was touched (0 its left end, 1 its right), snapped to VOLUME_STEP. */
export function volumeAt(fraction: number): number {
  const snapped = Math.round(Math.min(1, Math.max(0, fraction)) / VOLUME_STEP) * VOLUME_STEP;
  return Number(snapped.toFixed(2));
}

/**
 * The level a press of − (`direction` −1) or + (1) gives from `level`: the
 * next whole VOLUME_BUTTON_STEP down or up, so 85% goes to 80% or 90%.
 */
export function stepVolume(level: number, direction: 1 | -1): number {
  const steps = level / VOLUME_BUTTON_STEP;
  const next = direction > 0 ? Math.floor(steps + 1e-6) + 1 : Math.ceil(steps - 1e-6) - 1;
  return Number(Math.min(1, Math.max(0, next * VOLUME_BUTTON_STEP)).toFixed(2));
}

/** What the menu shows beside a slider: "Off" or the level in percent. */
export function volumeText(level: number): string {
  return level <= 0 ? 'Off' : `${Math.round(level * 100)}%`;
}

/** The levels a tank sound and the commander are played at. */
export interface Volumes {
  sound: number;
  enginevol: number;
  effectsvol: number;
  commander: number;
}

/** The tank's own sound out at all: Master up, and Engine or Effects up. */
export function tankHeard(v: Volumes): boolean {
  return v.sound > 0 && (v.enginevol > 0 || v.effectsvol > 0);
}

/** The commander heard at all: Master and Commander both up. */
export function commanderHeard(v: Volumes): boolean {
  return v.sound > 0 && v.commander > 0;
}

/** The commander's gain, before the intercom's own level: Master's times Commander's. */
export function commanderGain(v: Volumes): number {
  return volumeGain(v.sound) * volumeGain(v.commander);
}
