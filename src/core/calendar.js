// Game calendar: day, hour and minute. Pure functions; the store holds the calendar value.
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;

export const toMinutes = ({ day, hour, minute }) => (day - 1) * MINUTES_PER_DAY + hour * MINUTES_PER_HOUR + minute;

export function fromMinutes(total) {
  const whole = Math.floor(total);
  return {
    day: Math.floor(whole / MINUTES_PER_DAY) + 1,
    hour: Math.floor((whole % MINUTES_PER_DAY) / MINUTES_PER_HOUR),
    minute: whole % MINUTES_PER_HOUR,
  };
}

// Moves the calendar forward by whole game minutes and lists each day boundary crossed, in order.
// A day number in `endedDays` is a day that has fully passed and is due for daily processing.
export function advance(calendar, minutes) {
  if (!Number.isInteger(minutes) || minutes < 0) throw new RangeError('minutes must be a non-negative integer');
  const before = toMinutes(calendar);
  const next = fromMinutes(before + minutes);
  const endedDays = [];
  for (let day = calendar.day; day < next.day; day += 1) endedDays.push(day);
  return { calendar: { ...calendar, ...next }, endedDays };
}
