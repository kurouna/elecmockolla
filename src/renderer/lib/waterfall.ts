/**
 * Whether the waterfall has bars that move: a request still running, or one that ended
 * inside the window and is sliding out of it. Otherwise the timeline is still, and the
 * component follows the snapshots instead of redrawing every animation frame.
 */
export function waterfallMoving(
  running: number,
  history: readonly { t: { ended: number } }[],
  now: number,
  windowSec: number,
): boolean {
  if (running > 0) return true
  const from = now - windowSec * 1000
  return history.some((r) => r.t.ended >= from)
}
