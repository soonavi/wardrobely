/**
 * Minimum-account-age rules — the client half of Selv's 13+ age gate.
 *
 * LAUNCH_CHECKLIST.md §1 carries a 🔴 BLOCKING item: "Set minimum account age
 * to 13 at signup (age gate / birthdate field) and confirm this is enforced,
 * not just stated in the ToS". legal/PRIVACY_POLICY.md §12 already tells users
 * "Selv is intended for users 13 and older (we enforce a minimum age at
 * signup)" — so this module and its database counterpart exist to make that
 * sentence true.
 *
 * WHAT THIS FILE IS, AND IS NOT
 * This is the *screen's* copy of the rule. It exists so a user gets an answer
 * while their thumb is still on the keypad, and — much more importantly — so a
 * rejected under-13 never reaches the email step, which means Supabase never
 * creates an `auth.users` row for them (`signInWithOtp` runs with
 * `shouldCreateUser: true`, so requesting a code *is* creating an account).
 * Not collecting a child's email in the first place is a better COPPA posture
 * than collecting it and deleting it afterwards.
 *
 * It is NOT the enforcement. Anyone holding the anon key can skip every line
 * below. The enforcement is `public.record_age_check()` in
 * supabase/migrations/006_age_gate.sql: a `security definer` RPC that repeats
 * this same test in SQL, is the only thing with permission to write the
 * verdict, and refuses to record one for an under-13. When the two disagree
 * the database wins — see the timezone note on `todayInDeviceZone` below.
 *
 * WHY EVERYTHING HERE IS A PLAIN {year, month, day} AND NEVER A `Date`
 * A birthdate is a *civil* date — a page on a calendar — not an instant. The
 * moment you put one in a `Date` you have silently attached a timezone to it,
 * and `new Date("2013-08-20")` in particular parses as UTC midnight, so
 * `.getFullYear()` on a device west of Greenwich returns the *previous* day's
 * year around new year. That is a real off-by-one that lands exactly on the
 * boundary this module exists to get right, and the only reliable fix is not
 * to use `Date` for the birthdate at all. `Date` appears in precisely one
 * function here (`todayInDeviceZone`), which reads the device's local calendar
 * and immediately converts to a civil triple.
 *
 * The `Date` constructor is avoided for validation too: `new Date(2013, 1, 30)`
 * happily rolls over to March 2nd rather than rejecting February 30th, and
 * `new Date(24, 0, 1)` means 1924, not year 24. `isRealCalendarDate` does the
 * arithmetic itself instead.
 */

/**
 * The floor, in years. 13 is COPPA's line in the US
 * (legal/PRIVACY_POLICY.md §12) and the lowest of the GDPR Art. 8
 * member-state thresholds, which run 13–16; the policy resolves the higher
 * ones by leaning on this floor plus Apple's platform-level age signals
 * rather than by collecting finer age data.
 *
 * Mirrored by the `interval '13 years'` in record_age_check() and by the
 * `- 13` in the `profiles_age_verified_consistent` constraint. Changing it
 * here alone changes nothing that matters.
 */
export const MINIMUM_AGE_YEARS = 13;

/**
 * Upper sanity bound, in years. Not a compliance rule — someone born in 1850
 * is comfortably over 13 — but a fat-fingered "1013" should produce "check
 * that date" rather than sailing through, and the DB constraint's 1900 floor
 * would reject it later anyway with an error that points at permissions and
 * constraints instead of at the typo. Matches the `interval '120 years'` guard
 * in record_age_check().
 */
export const MAX_PLAUSIBLE_AGE_YEARS = 120;

/**
 * A date on a calendar, with no timezone and no instant attached.
 * `month` is 1-based (1 = January) — deliberately unlike `Date.getMonth()`,
 * because every off-by-one bug in date code starts with a 0-based month that
 * looked 1-based at the call site.
 */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** The three raw text fields the age step collects, before parsing. */
export interface BirthdateFields {
  day: string;
  month: string;
  year: string;
}

/**
 * Why a birthdate was refused, or `"ok"`.
 *
 * A discriminated union rather than a boolean because the copy differs a lot:
 * "check that date" and "you're not old enough to use Selv" are not
 * interchangeable, and showing the second one to someone who typed 2O26
 * instead of 2026 is the kind of thing people screenshot.
 */
export type BirthdateVerdict =
  /** Passed. `birthdate` is what to send to `record_age_check`. */
  | { status: "ok"; birthdate: CivilDate; age: number }
  /** One or more fields empty. */
  | { status: "incomplete" }
  /** Non-numeric, or a day/month that does not exist (Feb 30, month 13). */
  | { status: "not_a_date" }
  /** In the future on the device's calendar. */
  | { status: "future" }
  /** Older than MAX_PLAUSIBLE_AGE_YEARS — almost certainly a typo. */
  | { status: "implausible" }
  /** A real, plausible date, and under MINIMUM_AGE_YEARS. */
  | { status: "too_young"; age: number };

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Proleptic Gregorian leap year. Written out rather than inferred from `Date`
 * so it is inspectable and so it behaves for years outside the range a
 * two-digit `Date` constructor would mangle.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Length of a given 1-based month, accounting for February in a leap year. */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) return 0;
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

/**
 * Whether a triple names a day that actually exists.
 *
 * The reason this is hand-rolled: `new Date(2013, 1, 30)` does not reject
 * February 30th, it silently becomes March 2nd. A validator built on that
 * would accept a date the user never typed and then compute an age from it.
 */
export function isRealCalendarDate(date: CivilDate): boolean {
  const { year, month, day } = date;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/**
 * Order two civil dates: negative if `a` is earlier, 0 if the same day.
 * Pure integer comparison, which is the entire point — no instants, no
 * offsets, nothing that can shift under a device's clock settings.
 */
export function compareCivilDates(a: CivilDate, b: CivilDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

/**
 * Completed years between two civil dates. Returns a negative number if
 * `birth` is after `today`, which callers should treat as a future date
 * rather than as an age.
 *
 * LEAP-DAY BIRTHDAYS. Someone born 29 February has no birthday in a common
 * year, and jurisdictions disagree about whether they age on the 28th or the
 * 1st. This comparison puts it on 1 March — `(2, 29)` sorts after `(2, 28)`,
 * so on 28 February of a common year the birthday has not yet passed and the
 * age is one lower. That is the conservative direction for a *minimum* age
 * gate: it holds a leap-day child back by a single day rather than letting
 * them in a day early, and "the stricter reading" is the right default for a
 * control whose failure mode is a 12-year-old with an account.
 *
 * record_age_check() reaches the same answer from the other side — Postgres
 * clamps `2025-02-28 - interval '13 years'` to `2012-02-28`, and a
 * `2012-02-29` birthdate is greater than that, so it is refused too. The two
 * implementations agree by construction; __tests__/minimumAge.test.ts pins the
 * shared boundaries so they cannot drift apart silently.
 */
export function ageInYearsOn(birth: CivilDate, today: CivilDate): number {
  let age = today.year - birth.year;
  const birthdayHasPassed =
    today.month > birth.month ||
    (today.month === birth.month && today.day >= birth.day);
  if (!birthdayHasPassed) age -= 1;
  return age;
}

/** Whether someone born on `birth` has reached the floor as of `today`. */
export function hasReachedMinimumAge(birth: CivilDate, today: CivilDate): boolean {
  return ageInYearsOn(birth, today) >= MINIMUM_AGE_YEARS;
}

/**
 * Today, as the device's calendar shows it.
 *
 * This is the one place a `Date` is read, and it reads *local* components on
 * purpose: the user's answer to "how old are you" is about the day they think
 * it is, not the day it is in UTC. `now` is injectable so tests never depend
 * on the wall clock.
 *
 * The server does the same thing against its own clock (`current_date`, UTC on
 * Supabase), so at the edges the two can disagree by a day. That disagreement
 * is safe in both directions and does not need reconciling: whichever side
 * thinks it is still yesterday refuses first, the user is told to try again,
 * and no ordering of the two admits someone under 13. The database's answer is
 * the one that gets recorded.
 */
export function todayInDeviceZone(now: Date = new Date()): CivilDate {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

/** `YYYY-MM-DD`, the shape Postgres accepts for a `date` argument. */
export function toIsoDate(date: CivilDate): string {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/**
 * Parse the three text inputs into a civil date, or null if they are not all
 * present and numeric.
 *
 * Strict digits-only: `Number("12abc")` is NaN but `parseInt("12abc")` is 12,
 * and a field that silently drops trailing garbage is a field that computes an
 * age from something the user did not enter. Two-digit years are refused
 * rather than guessed — "13" could be 2013 or 1913, and one of those readings
 * is a child.
 */
export function parseBirthdateFields(fields: BirthdateFields): CivilDate | null {
  const day = fields.day.trim();
  const month = fields.month.trim();
  const year = fields.year.trim();

  if (!day || !month || !year) return null;
  if (!/^\d{1,2}$/.test(day)) return null;
  if (!/^\d{1,2}$/.test(month)) return null;
  if (!/^\d{4}$/.test(year)) return null;

  return { year: Number(year), month: Number(month), day: Number(day) };
}

/**
 * The whole client-side gate in one call: parse, validate, then judge.
 *
 * Ordering is deliberate and matches record_age_check()'s branch order — every
 * complaint about the *shape* of the date comes before the verdict about the
 * *person*, so a mistyped year produces "check that date" and never "you're
 * too young".
 */
export function checkBirthdate(
  fields: BirthdateFields,
  today: CivilDate = todayInDeviceZone()
): BirthdateVerdict {
  const parsed = parseBirthdateFields(fields);
  if (!parsed) {
    const anyBlank = !fields.day.trim() || !fields.month.trim() || !fields.year.trim();
    return anyBlank ? { status: "incomplete" } : { status: "not_a_date" };
  }

  if (!isRealCalendarDate(parsed)) return { status: "not_a_date" };
  if (compareCivilDates(parsed, today) > 0) return { status: "future" };

  const age = ageInYearsOn(parsed, today);
  // Compared in whole years, where record_age_check() compares dates
  // (`< current_date - interval '120 years'`). The two therefore disagree
  // inside the 120th year of life: this accepts, the server refuses. That is
  // harmless — both are typo catchers, neither is the compliance rule, and the
  // server's refusal maps back to the same "check that date" copy — and it is
  // the safe direction anyway, since the stricter of the two is the one that
  // actually writes the row.
  if (age > MAX_PLAUSIBLE_AGE_YEARS) return { status: "implausible" };
  if (age < MINIMUM_AGE_YEARS) return { status: "too_young", age };

  return { status: "ok", birthdate: parsed, age };
}

/**
 * User-facing copy for each verdict.
 *
 * Centralised here rather than inlined in the screen for the same reason
 * `wardrobeLimitMessage()` lives in lib/pricing.ts: `src/lib/api/profiles.ts`
 * maps the server's rejection of the *same* rule onto the same string, so the
 * client-side refusal and the database's refusal read identically to the user.
 * Two copies would drift, and the drift would show up as "the app said one
 * thing when I tapped Continue and a different thing a second later".
 *
 * TONE. The under-13 message states the rule and stops. It does not apologise
 * for the user, does not invite them to "come back when you're older" (which
 * reads as an instruction to lie), and does not tell them what number would
 * have worked — the FTC's guidance on neutral age screens is that the screen
 * should not teach the answer that gets you in.
 */
export function birthdateVerdictMessage(verdict: BirthdateVerdict): string | null {
  switch (verdict.status) {
    case "ok":
      return null;
    case "incomplete":
      return "Please enter your full date of birth.";
    case "not_a_date":
      return "That doesn't look like a real date. Check the day, month and year.";
    case "future":
      return "That date is in the future. Check the year.";
    case "implausible":
      return "That date doesn't look right. Check the year.";
    case "too_young":
      return minimumAgeMessage();
  }
}

/**
 * The single sentence shown when someone is under the floor, wherever the
 * refusal came from. `src/lib/api/profiles.ts` returns this exact string when
 * `record_age_check` raises `P0001`, so the client-side gate and the database
 * gate speak with one voice.
 */
export function minimumAgeMessage(): string {
  return `You need to be at least ${MINIMUM_AGE_YEARS} to use Selv.`;
}
