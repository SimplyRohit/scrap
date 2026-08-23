/**
 * Scheduled jobs.
 *
 * Deliberately short: anything worth running on a schedule is worth writing as
 * an ordinary internal function, so it can also be run by hand.
 */

import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval('prune the fetch cache', { hours: 6 }, internal.fetchCache.prune, {});
crons.interval('reap stalled analyses', { minutes: 30 }, internal.maintenance.reapStalledAnalyses, {});

export default crons;
