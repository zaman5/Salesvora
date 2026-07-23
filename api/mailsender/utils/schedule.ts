export function parseTime(timeStr: string): number {
  if (!timeStr) return 0;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return 0;
  let [_, h, m, ampm] = match;
  let hour = parseInt(h, 10);
  const min = parseInt(m, 10);
  if (ampm) {
    ampm = ampm.toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
  }
  return hour * 60 + min; // minutes since midnight
}

export function isCampaignWithinSchedule(scheduleJson: string | null | undefined): { allowed: boolean, reason: string } {
  if (!scheduleJson) return { allowed: true, reason: 'No schedule configured' };
  
  let schedule: any;
  try {
    schedule = JSON.parse(scheduleJson);
  } catch {
    return { allowed: true, reason: 'Invalid schedule JSON' };
  }

  // 1. Timezone Check
  const rawTz = schedule.timezone || 'UTC';
  const tzParts = rawTz.split(' ');
  const tz = tzParts[0]; // e.g., 'Asia/Karachi'
  
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
      weekday: 'long'
    }).formatToParts(new Date());
  } catch (e) {
    // Fallback if invalid timezone string
    return { allowed: true, reason: `Invalid timezone: ${tz}, bypassing check` };
  }

  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;

  // 2. Active Days
  if (schedule.days) {
    const today = p.weekday; // 'Monday'
    if (schedule.days[today] === false) {
      return { allowed: false, reason: `Not active on ${today}s` };
    }
  }

  // 3. Start / End Date
  const currentYMD = `${p.year}-${p.month}-${p.day}`; // "2026-05-18"
  if (schedule.startDate) {
    // Assuming UI stores date as YYYY-MM-DD
    if (currentYMD < schedule.startDate) {
      return { allowed: false, reason: `Campaign hasn't started yet (starts ${schedule.startDate})` };
    }
  }
  if (schedule.endDate) {
    if (currentYMD > schedule.endDate) {
      return { allowed: false, reason: `Campaign ended on ${schedule.endDate}` };
    }
  }

  // 4. Daily Start / End Time
  const currentMinutes = parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10);
  
  if (schedule.startTime) {
    const startMins = parseTime(schedule.startTime);
    if (currentMinutes < startMins) {
      return { allowed: false, reason: `Before daily start time (${schedule.startTime})` };
    }
  }
  
  if (schedule.endTime) {
    const endMins = parseTime(schedule.endTime);
    if (currentMinutes >= endMins) {
      return { allowed: false, reason: `After daily end time (${schedule.endTime})` };
    }
  }

  return { allowed: true, reason: 'Inside window' };
}

export function getTimezoneOffset(timeZone: string, date: Date = new Date()): number {
  const tzString = date.toLocaleString('en-US', { timeZone, timeZoneName: 'longOffset' });
  const match = tzString.match(/[+-]\d{1,2}(:\d{2})?$/);
  if (match) {
    const sign = match[0][0] === '+' ? 1 : -1;
    const parts = match[0].slice(1).split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1] ? parseInt(parts[1], 10) : 0;
    return sign * (hours * 60 + minutes) * 60 * 1000;
  }
  return 0;
}

export function getLocalMidnightTimestamp(tz: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date());
  } catch (e) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }

  const p: Record<string, string> = {};
  for (const part of parts) {
    p[part.type] = part.value;
  }

  const utcDate = new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
  const offset = getTimezoneOffset(tz, utcDate);
  return utcDate.getTime() - offset;
}

