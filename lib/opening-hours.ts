export type OpeningStatus = "open" | "closed" | "unknown";

const OSM_DAY_INDEX: Record<string, number> = {
  Mo: 0,
  Tu: 1,
  We: 2,
  Th: 3,
  Fr: 4,
  Sa: 5,
  Su: 6
};

const DAY_CODES = Object.keys(OSM_DAY_INDEX);

type ParsedScheduleRule = {
  days: Set<number>;
  intervals: Array<{ startMinute: number; endMinute: number }>;
};

function getBerlinDayAndMinute(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(now);
  const weekdayPart = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hourPart = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minutePart = parts.find((part) => part.type === "minute")?.value ?? "00";

  const weekdayMap: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6
  };

  const dayIndex = weekdayMap[weekdayPart] ?? 0;
  const hour = Number.parseInt(hourPart, 10);
  const minute = Number.parseInt(minutePart, 10);
  return {
    dayIndex,
    minuteOfDay: Math.max(0, Math.min(23, Number.isFinite(hour) ? hour : 0)) * 60 +
      Math.max(0, Math.min(59, Number.isFinite(minute) ? minute : 0))
  };
}

function addDayRange(days: Set<number>, start: number, end: number) {
  let cursor = start;
  while (true) {
    days.add(cursor);
    if (cursor === end) {
      break;
    }
    cursor = (cursor + 1) % 7;
  }
}

function parseDaySpec(daySpec: string): Set<number> | null {
  const cleaned = daySpec.replace(/\s+/g, "");
  if (!cleaned) {
    return new Set([0, 1, 2, 3, 4, 5, 6]);
  }

  const dayTokens = cleaned.split(",").filter(Boolean);
  const days = new Set<number>();

  for (const token of dayTokens) {
    if (token.includes("-")) {
      const [startRaw, endRaw] = token.split("-");
      const start = OSM_DAY_INDEX[startRaw];
      const end = OSM_DAY_INDEX[endRaw];
      if (typeof start === "number" && typeof end === "number") {
        addDayRange(days, start, end);
      }
      continue;
    }

    const single = OSM_DAY_INDEX[token];
    if (typeof single === "number") {
      days.add(single);
    }
  }

  if (days.size > 0) {
    return days;
  }
  return null;
}

function parseScheduleRules(openingHours: string): ParsedScheduleRule[] {
  const rules = openingHours
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  const parsed: ParsedScheduleRule[] = [];

  for (const rule of rules) {
    const timeMatches = Array.from(rule.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g));
    if (timeMatches.length === 0) {
      continue;
    }

    const daySpecRaw = rule.replace(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g, "").replace(/,+/g, ",");
    const dayCodeMatches = daySpecRaw.match(/\b(?:Mo|Tu|We|Th|Fr|Sa|Su)\b/g) ?? [];
    const daySpec = dayCodeMatches.join(",");
    const parsedDays = parseDaySpec(daySpec);
    if (!parsedDays) {
      continue;
    }

    const intervals = timeMatches
      .map((match) => {
        const startHour = Number.parseInt(match[1], 10);
        const startMinute = Number.parseInt(match[2], 10);
        const endHour = Number.parseInt(match[3], 10);
        const endMinute = Number.parseInt(match[4], 10);

        if (
          !Number.isFinite(startHour) ||
          !Number.isFinite(startMinute) ||
          !Number.isFinite(endHour) ||
          !Number.isFinite(endMinute)
        ) {
          return null;
        }

        return {
          startMinute: startHour * 60 + startMinute,
          endMinute: endHour * 60 + endMinute
        };
      })
      .filter((item): item is { startMinute: number; endMinute: number } => item !== null);

    if (intervals.length > 0) {
      parsed.push({
        days: parsedDays,
        intervals
      });
    }
  }

  return parsed;
}

function isOpenAtMinute(
  currentDayIndex: number,
  minuteOfDay: number,
  rules: ParsedScheduleRule[]
) {
  const previousDay = (currentDayIndex + 6) % 7;

  for (const rule of rules) {
    for (const interval of rule.intervals) {
      if (interval.endMinute > interval.startMinute) {
        if (
          rule.days.has(currentDayIndex) &&
          minuteOfDay >= interval.startMinute &&
          minuteOfDay < interval.endMinute
        ) {
          return true;
        }
        continue;
      }

      if (rule.days.has(currentDayIndex) && minuteOfDay >= interval.startMinute) {
        return true;
      }
      if (rule.days.has(previousDay) && minuteOfDay < interval.endMinute) {
        return true;
      }
    }
  }

  return false;
}

export function evaluateOpeningStatus(
  openingHoursRaw: string | null | undefined,
  now: Date = new Date()
): OpeningStatus {
  const openingHours = (openingHoursRaw ?? "").trim();
  if (!openingHours) {
    return "unknown";
  }

  const normalized = openingHours.toLowerCase();
  if (normalized.includes("24/7")) {
    return "open";
  }

  const rules = parseScheduleRules(openingHours);
  if (rules.length > 0) {
    const { dayIndex, minuteOfDay } = getBerlinDayAndMinute(now);
    return isOpenAtMinute(dayIndex, minuteOfDay, rules) ? "open" : "closed";
  }

  if (
    /\boff\b/.test(normalized) ||
    /\bclosed\b/.test(normalized)
  ) {
    return "closed";
  }

  const hasAnyDayCode = DAY_CODES.some((code) => openingHours.includes(code));
  if (hasAnyDayCode) {
    return "closed";
  }

  return "unknown";
}
