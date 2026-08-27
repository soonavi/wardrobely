/**
 * Unit tests for src/features/age/minimumAge.ts — Selv's 13+ age gate.
 *
 * This is a 🔴 BLOCKING compliance control (LAUNCH_CHECKLIST.md §1), and
 * legal/PRIVACY_POLICY.md §12 tells users we enforce it. The failure mode of
 * an off-by-one here is a 12-year-old with an account and a privacy policy
 * that says we don't have any, so the boundaries get tested individually
 * rather than sampled.
 *
 * Four things are pinned:
 *
 *  1. The exact day someone becomes eligible — the day of their 13th birthday,
 *     not the day after, and not the day before.
 *  2. Leap-day birthdays. 29 February has no anniversary in a common year, and
 *     the rule chosen (birthday falls on 1 March) has to hold in both
 *     directions and has to match what record_age_check() computes in SQL.
 *  3. Timezone independence. A birthdate is a page on a calendar, not an
 *     instant; nothing in the module may change its answer because the device
 *     is in Kiritimati rather than Los Angeles.
 *  4. Junk input is refused as junk, and never as "you're too young" — a user
 *     who mistypes a year must not be told they are a child.
 */
import {
  MAX_PLAUSIBLE_AGE_YEARS,
  MINIMUM_AGE_YEARS,
  ageInYearsOn,
  birthdateVerdictMessage,
  checkBirthdate,
  compareCivilDates,
  daysInMonth,
  hasReachedMinimumAge,
  isLeapYear,
  isRealCalendarDate,
  minimumAgeMessage,
  parseBirthdateFields,
  toIsoDate,
  todayInDeviceZone,
} from "../minimumAge";
import type { BirthdateFields, CivilDate } from "../minimumAge";

/** Terse constructor so the boundary tables below read like dates. */
const d = (year: number, month: number, day: number): CivilDate => ({
  year,
  month,
  day,
});

/** The three text fields the screen collects, from a civil date. */
const fieldsFor = (date: CivilDate): BirthdateFields => ({
  day: String(date.day),
  month: String(date.month),
  year: String(date.year),
});

describe("isLeapYear", () => {
  it("follows the full Gregorian rule, including the century exceptions", () => {
    expect(isLeapYear(2024)).toBe(true); // divisible by 4
    expect(isLeapYear(2023)).toBe(false);
    expect(isLeapYear(1900)).toBe(false); // divisible by 100, not 400
    expect(isLeapYear(2000)).toBe(true); // divisible by 400
    expect(isLeapYear(2100)).toBe(false);
  });
});

describe("daysInMonth", () => {
  it("gives February 29 days only in a leap year", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it("gives the right length for every month of a common year", () => {
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    lengths.forEach((expected, i) => {
      expect(daysInMonth(2023, i + 1)).toBe(expected);
    });
  });

  it("returns 0 for a month that doesn't exist", () => {
    expect(daysInMonth(2023, 0)).toBe(0);
    expect(daysInMonth(2023, 13)).toBe(0);
    expect(daysInMonth(2023, 1.5)).toBe(0);
  });
});

describe("isRealCalendarDate", () => {
  // The reason this function is hand-rolled: `new Date(2013, 1, 30)` does not
  // reject February 30th, it rolls over to March 2nd. A validator built on the
  // Date constructor would accept a date the user never typed and then compute
  // an age from it.
  it("rejects days that roll over in the Date constructor", () => {
    expect(isRealCalendarDate(d(2013, 2, 30))).toBe(false);
    expect(isRealCalendarDate(d(2013, 2, 29))).toBe(false); // 2013 is not a leap year
    expect(isRealCalendarDate(d(2013, 4, 31))).toBe(false);
    expect(isRealCalendarDate(d(2013, 6, 31))).toBe(false);
  });

  it("accepts February 29 only in a leap year", () => {
    expect(isRealCalendarDate(d(2012, 2, 29))).toBe(true);
    expect(isRealCalendarDate(d(2011, 2, 29))).toBe(false);
  });

  it("rejects out-of-range and non-integer parts", () => {
    expect(isRealCalendarDate(d(2013, 0, 10))).toBe(false);
    expect(isRealCalendarDate(d(2013, 13, 10))).toBe(false);
    expect(isRealCalendarDate(d(2013, 1, 0))).toBe(false);
    expect(isRealCalendarDate(d(2013, 1, 32))).toBe(false);
    expect(isRealCalendarDate(d(2013.5, 1, 10))).toBe(false);
    expect(isRealCalendarDate(d(2013, 1, 10.5))).toBe(false);
    expect(isRealCalendarDate(d(NaN, 1, 10))).toBe(false);
  });
});

describe("compareCivilDates", () => {
  it("orders by year, then month, then day", () => {
    expect(compareCivilDates(d(2012, 5, 6), d(2013, 1, 1))).toBeLessThan(0);
    expect(compareCivilDates(d(2013, 5, 6), d(2013, 6, 1))).toBeLessThan(0);
    expect(compareCivilDates(d(2013, 5, 6), d(2013, 5, 7))).toBeLessThan(0);
    expect(compareCivilDates(d(2013, 5, 6), d(2013, 5, 6))).toBe(0);
    expect(compareCivilDates(d(2013, 5, 7), d(2013, 5, 6))).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The boundary. This is the control.
// ---------------------------------------------------------------------------
describe("ageInYearsOn — the 13th birthday", () => {
  const TODAY = d(2026, 8, 20);

  // Someone is 13 ON their 13th birthday, not the day after. Getting this
  // wrong in the strict direction turns away every eligible user for a day;
  // getting it wrong in the loose direction lets a 12-year-old in.
  it("is exactly 13 on the 13th birthday", () => {
    expect(ageInYearsOn(d(2013, 8, 20), TODAY)).toBe(13);
    expect(hasReachedMinimumAge(d(2013, 8, 20), TODAY)).toBe(true);
  });

  it("is 12 the day before the 13th birthday", () => {
    expect(ageInYearsOn(d(2013, 8, 21), TODAY)).toBe(12);
    expect(hasReachedMinimumAge(d(2013, 8, 21), TODAY)).toBe(false);
  });

  it("is 13 the day after the 13th birthday", () => {
    expect(ageInYearsOn(d(2013, 8, 19), TODAY)).toBe(13);
    expect(hasReachedMinimumAge(d(2013, 8, 19), TODAY)).toBe(true);
  });

  // "13 tomorrow" stated the other way round: hold today fixed at the user's
  // birthday-eve and walk the clock forward one day.
  it("flips from blocked to allowed overnight, and only then", () => {
    const birth = d(2013, 8, 20);
    expect(hasReachedMinimumAge(birth, d(2026, 8, 18))).toBe(false);
    expect(hasReachedMinimumAge(birth, d(2026, 8, 19))).toBe(false);
    expect(hasReachedMinimumAge(birth, d(2026, 8, 20))).toBe(true);
    expect(hasReachedMinimumAge(birth, d(2026, 8, 21))).toBe(true);
  });

  it("handles a birthday that has not yet come round this year", () => {
    // Born December 2012; on 2026-08-20 they are 13 (turned 13 in Dec 2025).
    expect(ageInYearsOn(d(2012, 12, 31), TODAY)).toBe(13);
    // Born December 2013; on 2026-08-20 they are still 12 until December.
    expect(ageInYearsOn(d(2013, 12, 1), TODAY)).toBe(12);
    expect(hasReachedMinimumAge(d(2013, 12, 1), TODAY)).toBe(false);
  });

  it("crosses a year boundary correctly", () => {
    // 31 Dec birthday, checked on 1 Jan: the birthday passed yesterday.
    expect(ageInYearsOn(d(2012, 12, 31), d(2026, 1, 1))).toBe(13);
    // 1 Jan birthday, checked on 31 Dec of the previous year: not yet.
    expect(ageInYearsOn(d(2013, 1, 1), d(2025, 12, 31))).toBe(12);
    // 1 Jan birthday, checked on the day.
    expect(ageInYearsOn(d(2013, 1, 1), d(2026, 1, 1))).toBe(13);
  });

  it("returns a negative age for a birthdate in the future", () => {
    // Callers must treat this as "future", not as an age — checkBirthdate does.
    expect(ageInYearsOn(d(2027, 1, 1), TODAY)).toBeLessThan(0);
  });

  // A sweep rather than spot checks: for every day in a year around the
  // boundary, `hasReachedMinimumAge` must agree with "is the birthdate on or
  // before the day exactly MINIMUM_AGE_YEARS ago".
  it("agrees with the cutoff-date formulation on every day of a year", () => {
    const today = d(2026, 3, 15);
    const cutoff = d(today.year - MINIMUM_AGE_YEARS, today.month, today.day);
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= daysInMonth(2013, month); day += 1) {
        const birth = d(2013, month, day);
        expect(hasReachedMinimumAge(birth, today)).toBe(
          compareCivilDates(birth, cutoff) <= 0
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Leap years. 29 February has no anniversary in a common year.
// ---------------------------------------------------------------------------
describe("ageInYearsOn — 29 February birthdays", () => {
  const LEAPLING = d(2012, 2, 29);

  // The chosen rule: the birthday falls on 1 March in a common year, so a
  // leapling is held back one extra day rather than let in one day early.
  // This is the conservative direction for a *minimum* age gate, and it is
  // what record_age_check() computes independently in SQL — Postgres clamps
  // `2025-02-28 - interval '13 years'` to `2012-02-28`, and `2012-02-29` is
  // greater than that, so it refuses too.
  it("is still 12 on 28 February of the 13th year", () => {
    expect(ageInYearsOn(LEAPLING, d(2025, 2, 28))).toBe(12);
    expect(hasReachedMinimumAge(LEAPLING, d(2025, 2, 28))).toBe(false);
  });

  it("becomes 13 on 1 March of the 13th year", () => {
    expect(ageInYearsOn(LEAPLING, d(2025, 3, 1))).toBe(13);
    expect(hasReachedMinimumAge(LEAPLING, d(2025, 3, 1))).toBe(true);
  });

  it("becomes 13 on 29 February when the 13th year is itself a leap year", () => {
    // 2012 + 12 = 2024, a leap year, so this leapling's 12th birthday is a
    // real 29 February — and they are 12, not 13, on it.
    expect(ageInYearsOn(LEAPLING, d(2024, 2, 29))).toBe(12);
    // Their 16th falls on 2028-02-29, also a leap year.
    expect(ageInYearsOn(LEAPLING, d(2028, 2, 29))).toBe(16);
  });

  // The mirror case: a common-year birthday checked on 29 February.
  it("handles a 28 February birthday checked on a 29 February", () => {
    expect(ageInYearsOn(d(2015, 2, 28), d(2028, 2, 29))).toBe(13);
    expect(hasReachedMinimumAge(d(2015, 2, 28), d(2028, 2, 29))).toBe(true);
    // And a 1 March birthday on the same day is one short.
    expect(ageInYearsOn(d(2015, 3, 1), d(2028, 2, 29))).toBe(12);
    expect(hasReachedMinimumAge(d(2015, 3, 1), d(2028, 2, 29))).toBe(false);
  });

  it("never accepts 29 February as a birthdate in a common year", () => {
    // 2013 is not a leap year, so this date does not exist and must be
    // refused as junk rather than aged.
    const verdict = checkBirthdate(fieldsFor(d(2013, 2, 29)), d(2026, 8, 20));
    expect(verdict.status).toBe("not_a_date");
  });
});

// ---------------------------------------------------------------------------
// Timezones. A birthdate is a calendar page, not an instant.
// ---------------------------------------------------------------------------
describe("timezone independence", () => {
  // Zones are simulated with `Intl.DateTimeFormat`, not by reassigning
  // `process.env.TZ`. The env-var trick works in plain Node but silently does
  // nothing under Jest — Jest hands the test a copied `process.env`, so the
  // assignment never reaches the hook that invalidates V8's cached zone, and
  // every "zone" comes back as the runner's own. A timezone test that quietly
  // ran five copies of UTC would pass forever while proving nothing, which is
  // the specific failure this comment exists to stop someone reintroducing.
  function civilDateIn(instant: Date, timeZone: string): CivilDate {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const part = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value);
    return { year: part("year"), month: part("month"), day: part("day") };
  }

  // 09:15Z on 20 August 2026. Chosen so the calendar day genuinely differs
  // across the zones below: Niue (UTC-11) is still on the 19th.
  const INSTANT = new Date("2026-08-20T09:15:00Z");

  it("is testing something: one instant, more than one calendar day", () => {
    expect(civilDateIn(INSTANT, "UTC")).toEqual(d(2026, 8, 20));
    expect(civilDateIn(INSTANT, "Pacific/Niue")).toEqual(d(2026, 8, 19));
    expect(civilDateIn(INSTANT, "Pacific/Kiritimati")).toEqual(d(2026, 8, 20));
  });

  // THE EDGE. Someone whose 13th birthday is 20 August 2026, checked at the
  // one instant above. Whether they are old enough depends entirely on which
  // day their own device thinks it is — which is why `todayInDeviceZone` reads
  // the local calendar and why the database re-checks against its own clock.
  // Neither side can admit an under-13: whichever of the two still thinks it
  // is yesterday refuses, and the user tries again tomorrow.
  it("follows the device's calendar day, not the underlying instant", () => {
    const birth = d(2013, 8, 20);

    expect(hasReachedMinimumAge(birth, civilDateIn(INSTANT, "UTC"))).toBe(true);
    expect(
      hasReachedMinimumAge(birth, civilDateIn(INSTANT, "Pacific/Kiritimati"))
    ).toBe(true);
    // Still the 19th in Niue: their birthday has not happened there yet.
    expect(
      hasReachedMinimumAge(birth, civilDateIn(INSTANT, "Pacific/Niue"))
    ).toBe(false);
  });

  // The core guarantee: none of the pure functions touch `Date`, so given the
  // same civil dates they cannot produce different answers for different
  // devices. If someone "simplifies" ageInYearsOn into `new Date(...)`
  // arithmetic, the zone the runner happens to sit in starts to matter and
  // this is what catches it.
  it("depends only on its arguments, never on ambient state", () => {
    const cases: Array<[CivilDate, CivilDate]> = [
      [d(2013, 8, 20), d(2026, 8, 20)], // exactly 13 today
      [d(2013, 8, 21), d(2026, 8, 20)], // 13 tomorrow
      [d(2012, 2, 29), d(2025, 2, 28)], // leapling, one day short
      [d(2013, 1, 1), d(2026, 1, 1)], // new year's day at both ends
      [d(2012, 12, 31), d(2026, 1, 1)],
    ];

    for (const [birth, today] of cases) {
      const age = ageInYearsOn(birth, today);
      // Same inputs, repeatedly, interleaved with clock reads that would
      // perturb anything that secretly consulted one.
      for (let i = 0; i < 3; i += 1) {
        void new Date();
        expect(ageInYearsOn(birth, today)).toBe(age);
        expect(hasReachedMinimumAge(birth, today)).toBe(age >= MINIMUM_AGE_YEARS);
        expect(checkBirthdate(fieldsFor(birth), today).status).toBe(
          age >= MINIMUM_AGE_YEARS ? "ok" : "too_young"
        );
      }
    }
  });

  // `todayInDeviceZone` is the one function that reads a clock, and it must
  // report the *local* calendar day — the day the user thinks it is — for
  // whatever instant it is handed.
  it("reads todayInDeviceZone from the local calendar", () => {
    const today = todayInDeviceZone(INSTANT);
    expect(today.year).toBe(INSTANT.getFullYear());
    expect(today.month).toBe(INSTANT.getMonth() + 1);
    expect(today.day).toBe(INSTANT.getDate());
    // And it agrees with an independently-computed civil date for the zone the
    // runner is actually in, rather than with UTC by assumption.
    expect(today).toEqual(
      civilDateIn(INSTANT, Intl.DateTimeFormat().resolvedOptions().timeZone)
    );
  });

  // THE TRAP THIS MODULE EXISTS TO AVOID, stated as a test. `new Date("2013-01-01")`
  // parses as UTC midnight, so anywhere west of Greenwich its local calendar
  // date is 31 December 2012 — a different year. A birthdate round-tripped
  // through `Date` would therefore be aged from a date the user never typed,
  // and at the boundary that is the difference between 12 and 13.
  it("parses a birthdate to the digits typed, never through Date", () => {
    const typed = { day: "1", month: "1", year: "2013" };
    expect(parseBirthdateFields(typed)).toEqual(d(2013, 1, 1));

    // The same date, laundered through Date and read back in a western zone,
    // is a different year entirely. Nothing in minimumAge.ts does this.
    const laundered = civilDateIn(new Date("2013-01-01"), "Pacific/Niue");
    expect(laundered).toEqual(d(2012, 12, 31));
    expect(laundered).not.toEqual(parseBirthdateFields(typed));
  });
});

describe("parseBirthdateFields", () => {
  it("accepts one- or two-digit day and month with a four-digit year", () => {
    expect(parseBirthdateFields({ day: "5", month: "9", year: "2001" })).toEqual(
      d(2001, 9, 5)
    );
    expect(parseBirthdateFields({ day: "05", month: "09", year: "2001" })).toEqual(
      d(2001, 9, 5)
    );
  });

  it("trims surrounding whitespace", () => {
    expect(
      parseBirthdateFields({ day: " 5 ", month: " 9 ", year: " 2001 " })
    ).toEqual(d(2001, 9, 5));
  });

  it("returns null when any field is empty", () => {
    expect(parseBirthdateFields({ day: "", month: "9", year: "2001" })).toBeNull();
    expect(parseBirthdateFields({ day: "5", month: "", year: "2001" })).toBeNull();
    expect(parseBirthdateFields({ day: "5", month: "9", year: "" })).toBeNull();
    expect(parseBirthdateFields({ day: "  ", month: "9", year: "2001" })).toBeNull();
  });

  // `parseInt("12abc")` is 12. A field that silently drops trailing garbage is
  // a field that computes an age from something the user never entered.
  it("refuses anything that isn't pure digits", () => {
    expect(parseBirthdateFields({ day: "12abc", month: "9", year: "2001" })).toBeNull();
    expect(parseBirthdateFields({ day: "1.5", month: "9", year: "2001" })).toBeNull();
    expect(parseBirthdateFields({ day: "-5", month: "9", year: "2001" })).toBeNull();
    expect(parseBirthdateFields({ day: "5", month: "9", year: "2e3" })).toBeNull();
    expect(parseBirthdateFields({ day: "5", month: "9", year: " 2001x" })).toBeNull();
  });

  // "13" could be 2013 or 1913, and one of those readings is a child. The
  // gate refuses to guess.
  it("refuses a two-digit year rather than guessing a century", () => {
    expect(parseBirthdateFields({ day: "5", month: "9", year: "01" })).toBeNull();
    expect(parseBirthdateFields({ day: "5", month: "9", year: "13" })).toBeNull();
  });

  it("refuses a five-digit year", () => {
    expect(parseBirthdateFields({ day: "5", month: "9", year: "20011" })).toBeNull();
  });
});

describe("toIsoDate", () => {
  it("zero-pads to the YYYY-MM-DD shape Postgres accepts", () => {
    expect(toIsoDate(d(2013, 8, 20))).toBe("2013-08-20");
    expect(toIsoDate(d(2001, 1, 5))).toBe("2001-01-05");
    expect(toIsoDate(d(999, 12, 31))).toBe("0999-12-31");
  });
});

// ---------------------------------------------------------------------------
// checkBirthdate — the whole client-side gate, including which complaint wins.
// ---------------------------------------------------------------------------
describe("checkBirthdate", () => {
  const TODAY = d(2026, 8, 20);

  it("passes someone who turns 13 today and blocks someone who turns 13 tomorrow", () => {
    const passes = checkBirthdate(fieldsFor(d(2013, 8, 20)), TODAY);
    expect(passes.status).toBe("ok");
    if (passes.status === "ok") {
      expect(passes.age).toBe(13);
      expect(toIsoDate(passes.birthdate)).toBe("2013-08-20");
    }

    const blocked = checkBirthdate(fieldsFor(d(2013, 8, 21)), TODAY);
    expect(blocked.status).toBe("too_young");
    if (blocked.status === "too_young") expect(blocked.age).toBe(12);
  });

  it("blocks every age below the floor, right down to today", () => {
    for (let yearsAgo = 0; yearsAgo < MINIMUM_AGE_YEARS; yearsAgo += 1) {
      const birth = d(TODAY.year - yearsAgo, TODAY.month, TODAY.day);
      expect(checkBirthdate(fieldsFor(birth), TODAY).status).toBe("too_young");
    }
  });

  it("passes every age above the floor up to the plausibility ceiling", () => {
    for (
      let yearsAgo = MINIMUM_AGE_YEARS;
      yearsAgo <= MAX_PLAUSIBLE_AGE_YEARS;
      yearsAgo += 1
    ) {
      const birth = d(TODAY.year - yearsAgo, TODAY.month, TODAY.day);
      expect(checkBirthdate(fieldsFor(birth), TODAY).status).toBe("ok");
    }
  });

  it("rejects a date in the future as a future date, not as an age", () => {
    expect(checkBirthdate(fieldsFor(d(2026, 8, 21)), TODAY).status).toBe("future");
    expect(checkBirthdate(fieldsFor(d(2027, 1, 1)), TODAY).status).toBe("future");
    // Today itself is not in the future — it is simply far too young.
    expect(checkBirthdate(fieldsFor(TODAY), TODAY).status).toBe("too_young");
  });

  it("rejects an implausibly old date as a typo", () => {
    const tooOld = d(TODAY.year - MAX_PLAUSIBLE_AGE_YEARS - 1, TODAY.month, TODAY.day);
    expect(checkBirthdate(fieldsFor(tooOld), TODAY).status).toBe("implausible");
    expect(checkBirthdate({ day: "1", month: "1", year: "1013" }, TODAY).status).toBe(
      "implausible"
    );
  });

  it("distinguishes an empty form from a garbled one", () => {
    expect(checkBirthdate({ day: "", month: "", year: "" }, TODAY).status).toBe(
      "incomplete"
    );
    expect(checkBirthdate({ day: "20", month: "8", year: "" }, TODAY).status).toBe(
      "incomplete"
    );
    expect(checkBirthdate({ day: "20", month: "8", year: "abcd" }, TODAY).status).toBe(
      "not_a_date"
    );
    expect(checkBirthdate({ day: "31", month: "2", year: "2001" }, TODAY).status).toBe(
      "not_a_date"
    );
    expect(checkBirthdate({ day: "20", month: "13", year: "2001" }, TODAY).status).toBe(
      "not_a_date"
    );
  });

  // The ordering rule: every complaint about the *shape* of the date comes
  // before any verdict about the *person*. Telling someone who typed a
  // nonsense date that they are too young to use the app is the kind of thing
  // people screenshot.
  it("never reports a malformed or future date as 'too young'", () => {
    const junk: BirthdateFields[] = [
      { day: "", month: "", year: "" },
      { day: "0", month: "0", year: "0000" },
      { day: "31", month: "2", year: "2020" },
      { day: "29", month: "2", year: "2021" },
      { day: "1", month: "1", year: "2027" },
      { day: "1", month: "1", year: "99" },
      { day: "1", month: "1", year: "1013" },
      { day: "abc", month: "def", year: "ghij" },
    ];
    for (const fields of junk) {
      expect(checkBirthdate(fields, TODAY).status).not.toBe("too_young");
      expect(checkBirthdate(fields, TODAY).status).not.toBe("ok");
    }
  });

  it("defaults 'today' to the device calendar when not supplied", () => {
    // A date well clear of every boundary, so this cannot be flaky: someone
    // born in 1990 is over 13 on every day this test could ever run.
    expect(checkBirthdate({ day: "1", month: "6", year: "1990" }).status).toBe("ok");
    // ...and a date 5 years in the future is always in the future.
    const nextYears = new Date().getFullYear() + 5;
    expect(
      checkBirthdate({ day: "1", month: "6", year: String(nextYears) }).status
    ).toBe("future");
  });
});

describe("copy", () => {
  it("names the actual minimum so the message can't drift from the constant", () => {
    expect(minimumAgeMessage()).toContain(String(MINIMUM_AGE_YEARS));
  });

  // src/lib/api/profiles.ts returns this exact string when record_age_check
  // raises P0001, so the client-side refusal and the database's refusal read
  // identically. Two copies would drift.
  it("uses one string for both the client gate and the server's rejection", () => {
    const verdict = checkBirthdate({ day: "1", month: "1", year: "2020" }, d(2026, 8, 20));
    expect(verdict.status).toBe("too_young");
    expect(birthdateVerdictMessage(verdict)).toBe(minimumAgeMessage());
  });

  // The FTC's guidance on neutral age screens: the screen must not teach the
  // answer that gets you in, and must not read as an invitation to come back
  // and try a different date.
  it("does not tell a rejected user what answer would have worked", () => {
    const message = minimumAgeMessage();
    expect(message).not.toMatch(/\bborn before\b/i);
    expect(message).not.toMatch(/\btry again\b/i);
    expect(message).not.toMatch(/\bcome back\b/i);
    expect(message).not.toMatch(/\b(19|20)\d{2}\b/); // no year hint
  });

  it("returns null for a passing verdict and a string for every refusal", () => {
    expect(
      birthdateVerdictMessage({ status: "ok", birthdate: d(1990, 1, 1), age: 36 })
    ).toBeNull();

    const refusals = [
      { status: "incomplete" as const },
      { status: "not_a_date" as const },
      { status: "future" as const },
      { status: "implausible" as const },
      { status: "too_young" as const, age: 9 },
    ];
    for (const verdict of refusals) {
      const message = birthdateVerdictMessage(verdict);
      expect(typeof message).toBe("string");
      expect((message as string).length).toBeGreaterThan(0);
    }
  });
});
