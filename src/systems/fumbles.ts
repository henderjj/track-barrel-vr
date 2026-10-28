/**
 * Fumbles, for the play-test stats (F1.14, docs/comfort-stats.md): the
 * systems that own controls report them here and PlayStatsSystem counts
 * them against the control. A fumble is a hand pulled off a control
 * because the real hand strayed from it (`slip`, MechanismSystem), a
 * squeeze near a control that took hold of nothing (`miss`, counted by
 * PlayStatsSystem from `squeezeNear` once every system has had the
 * squeeze), a shell dropped (`drop`) or the breech closed on a shell not
 * rammed home (`blocked`, LoadingSystem).
 */

export type FumbleHow = 'slip' | 'miss' | 'drop' | 'blocked';

type Side = 'left' | 'right';

/** Called with the control's name (as `handUse` names it) and how it was fumbled. */
export const fumbleListeners = new Set<(control: string, how: FumbleHow) => void>();

export function reportFumble(control: string, how: FumbleHow): void {
  for (const listener of fumbleListeners) listener(control, how);
}

/**
 * A fresh squeeze this frame that the mechanism kit didn't take hold of
 * with: the nearest control within MISS_REACH of its reach ('' with none
 * near), or null with no such squeeze. MechanismSystem sets it;
 * PlayStatsSystem reads it at the end of the frame (a squeeze the loading
 * took a shell with is no miss) and clears it.
 */
export const squeezeNear: Record<Side, string | null> = { left: null, right: null };
