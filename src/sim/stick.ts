/**
 * Reading a controller's thumbstick for gear changes, whatever runtime
 * reports it (John's play-test, 15 November 2026: the second player's Rift
 * Touch right stick changed no gears, though A and B did).
 *
 * Under WebXR's xr-standard mapping the thumbstick is axes 2 (x) and 3 (y),
 * and axes 0 and 1 are a touchpad that Touch controllers fill with zeros.
 * The input profile tells IWSDK that, so its thumbstick reading looks at
 * axes 2 and 3 only. Some PC runtimes report a Touch controller with only
 * the stick's two axes, or with no standard mapping at all, and the stick
 * then sits in axes 0 and 1, where that reading never looks.
 */

/** A stick pushed this far forwards or back changes gear, once, until it comes back within STICK_REARM of the middle. */
export const STICK_FLICK = 0.7;
export const STICK_REARM = 0.3;

/**
 * The thumbstick's forward/back value (forwards is negative, as WebXR
 * reports it): `mapped`, IWSDK's reading from the input profile, unless the
 * gamepad's axes say the stick is elsewhere. A gamepad with fewer than four
 * axes has its stick in axes 0 and 1; one with no standard mapping may have
 * it in either pair, so the further pushed of axes 1 and 3 counts.
 */
export function stickY(axes: ArrayLike<number> | undefined, mapping: string | undefined, mapped: number): number {
  if (!axes) return mapped;
  if (axes.length < 4) return axes.length >= 2 ? (axes[1] ?? 0) : mapped;
  if (mapping === 'xr-standard') return mapped;
  const a = axes[1] ?? 0;
  const b = axes[3] ?? 0;
  const raw = Math.abs(a) > Math.abs(b) ? a : b;
  return Math.abs(raw) > Math.abs(mapped) ? raw : mapped;
}

/**
 * A stick flicked forwards or back steps one gear: +1 up for forwards, -1
 * down for back, once per push. It re-arms when the stick comes back
 * within STICK_REARM of the middle.
 */
export class StickFlick {
  private flicked = false;

  /** The step this frame's stick value asks for: +1, -1 or 0. */
  step(y: number): number {
    if (this.flicked) {
      if (Math.abs(y) < STICK_REARM) this.flicked = false;
      return 0;
    }
    if (Math.abs(y) < STICK_FLICK) return 0;
    this.flicked = true;
    // Forwards on a stick is -Y.
    return y < 0 ? 1 : -1;
  }
}
