export type TimeMode = 'linear' | 'logarithmic';

export function timelinePosition(time: number, mode: TimeMode): number {
  return mode === 'linear' ? time : -Math.log10(1 - time);
}

export function timeAtPosition(position: number, mode: TimeMode): number {
  return mode === 'linear' ? position : 1 - 10 ** (-position);
}

/** Viewer clock, independent of the particle integrator's work budget. */
export function advanceTime(time: number, end: number, elapsed: number, speed: number, mode: TimeMode): number {
  if (elapsed <= 0 || speed <= 0) return time;
  const next = mode === 'linear' ? time + elapsed * speed
    : time - (1 - time) * Math.expm1(-Math.LN10 * elapsed * speed);
  return Math.min(end, next);
}
