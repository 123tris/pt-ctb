// Hard caps that keep publishing far inside R2's free tier (https://developers.cloudflare.com/r2/pricing/: per month
// 1,000,000 Class A operations, 10,000,000 Class B, 10 GB-month of storage; deletes are free). Every request
// tools/r2-sync.mjs sends is counted here first, and a request that would go over a cap is never sent: the run stops
// with a BudgetError, the site keeps serving the data it has, and publishing resumes when the day or month rolls over.
//
// The counts live in state/r2.json (with the list of retired files, see r2-sync.mjs), which publish keeps in the private
// state bucket too, so they survive a fresh checkout. They count only what this publisher sends; visitors' reads go
// through Cloudflare's cache (the Cache Rule in SETUP-HOSTING.md) and hit R2 only on a cache miss.

export const LIMITS = {
  classAMonth: 500_000,  // 50% of the free 1,000,000
  classADay: 16_000,     // 500,000 / 31: one bad day can't use up the month
  classBMonth: 1_000_000, // 10% of the free 10,000,000, for our own reads (restoring data, the old manifest)
  storageBytes: 2 * 1024 ** 3, // 2 GiB, 20% of the free 10 GB
  uploadsPerRun: 900,    // a full upload is ~710 files (~490 data, ~220 avatar thumbnails); more means something is wrong
};

export class BudgetError extends Error {}

const month = ms => new Date(ms).toISOString().slice(0, 7);
const day = ms => new Date(ms).toISOString().slice(0, 10);

/** The usage record in `record` (from state/r2.json, or undefined), rolled over to the current month and day. */
export function freshUsage(record, nowMs) {
  const usage = { month: month(nowMs), day: day(nowMs), a: 0, b: 0, dayA: 0, ...record };
  if (usage.month !== month(nowMs)) Object.assign(usage, { month: month(nowMs), a: 0, b: 0 });
  if (usage.day !== day(nowMs)) Object.assign(usage, { day: day(nowMs), dayA: 0 });
  return usage;
}

/** Counts operations against LIMITS. `spend` throws before going over; `need` checks a whole batch up front. */
export function budget(usage, limits = LIMITS) {
  const over = (a, b) => {
    if (usage.a + a > limits.classAMonth) return `Class A operations this month: ${usage.a} + ${a} would pass the cap of ${limits.classAMonth}`;
    if (usage.dayA + a > limits.classADay) return `Class A operations today (UTC): ${usage.dayA} + ${a} would pass the daily cap of ${limits.classADay}`;
    if (usage.b + b > limits.classBMonth) return `Class B operations this month: ${usage.b} + ${b} would pass the cap of ${limits.classBMonth}`;
    return null;
  };
  const stop = why => {
    throw new BudgetError(`R2 SAFETY CAP: ${why} (free tier: 1,000,000 A / 10,000,000 B per month). Nothing more was sent; the site keeps its current data. Publishing resumes when the day or month (UTC) rolls over.`);
  };
  return {
    usage,
    /** Throws unless `a` Class A and `b` Class B operations still fit. */
    need(a, b = 0) { const why = over(a, b); if (why) stop(why); },
    /** Throws if one run wants to upload more files than any normal export produces. */
    uploads(n) {
      if (n > limits.uploadsPerRun) stop(`this run would upload ${n} files, over the per-run cap of ${limits.uploadsPerRun}`);
    },
    /** Records one operation of class 'A', 'B' or null (free), refusing it if it doesn't fit. */
    spend(cls) {
      if (!cls) return;
      const why = cls === 'A' ? over(1, 0) : over(0, 1);
      if (why) stop(why);
      if (cls === 'A') { usage.a++; usage.dayA++; } else usage.b++;
    },
    /** Throws if the bucket would hold more than the storage cap. */
    storage(bytes) {
      if (bytes > limits.storageBytes) stop(`the data bucket would hold ${(bytes / 1024 ** 3).toFixed(2)} GiB, over the cap of ${(limits.storageBytes / 1024 ** 3).toFixed(0)} GiB`);
    },
  };
}
