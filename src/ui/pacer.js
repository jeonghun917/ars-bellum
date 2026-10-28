// Turns real time into whole game minutes.
//
// Each frame adds (real ms x speed) / (real ms per game minute) game minutes to a running
// fraction; only whole minutes are handed out, the rest waits for the next frame. A frame that
// took very long (a hidden tab) is cut to maxFrameMs, and one frame never hands out more than a
// day, so coming back to the tab does not run the game days in one go.
export const MAX_FRAME_MS = 250;
export const MAX_MINUTES_PER_FRAME = 24 * 60;

export function createPacer({ maxFrameMs = MAX_FRAME_MS, maxMinutes = MAX_MINUTES_PER_FRAME } = {}) {
  let fraction = 0;
  return {
    take(realMs, speed, realMsPerGameMinute) {
      if (!(realMs > 0) || !(speed > 0) || !(realMsPerGameMinute > 0)) return 0;
      fraction += (Math.min(realMs, maxFrameMs) * speed) / realMsPerGameMinute;
      const whole = Math.min(Math.floor(fraction), maxMinutes);
      fraction = whole === maxMinutes ? 0 : fraction - whole;
      return whole;
    },
    reset() { fraction = 0; },
    get fraction() { return fraction; },
  };
}
