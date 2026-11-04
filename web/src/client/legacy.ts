// What the new client still takes from the old one (assets/js), all in this one file so porting the rest (Phase 4) only
// changes it. The bundle doesn't copy these modules: tools/web-build.mjs keeps them as imports of the old site's own
// files, so they're the very modules the old app already loaded (its language, its settings, its sign-in).

import { requestList as oldRequestList, api as oldApi } from '../../../assets/js/core/bananas.js';
import { chartHover as oldChartHover } from '../../../assets/js/core/charts.js';
import { track as oldTrack } from '../../../assets/js/core/track.js';

export { CONFIG } from '../../../assets/js/config.js';
export { lang } from '../../../assets/js/core/i18n.js';
export { NotFound } from '../../../assets/js/core/data.js';
// Not paginate(): its markup is the old html tag's, which escapes this client's. client/dom.ts has its own.
export {
  announce, writeQuery, readQuery, setTitle, myId, prefs, go, here, openSearch, scrollBehavior, reducedMotion,
} from '../../../assets/js/core/ui.js';
// The usage counts' switch in this browser (the privacy page).
export { trackingBlock, optOut, optIn } from '../../../assets/js/core/track.js';
// Toasts, and the easter eggs a page sets off itself (WYSI in the games).
export { toast, wysi } from '../../../assets/js/core/fun.js';

// Bananas' calls to the site's endpoints and the signed-in session.
export { sendRequest, myRequests, pendingSpend, closeOnEscape, signInHere, session } from '../../../assets/js/core/bananas.js';

/** Asks the site's endpoints, signed in (bananas.js): { ok, status, body }. A refused session is forgotten. */
export const api = oldApi as (path: string, options?: { method?: string; body?: unknown }) =>
  Promise<{ ok: boolean; status: number; body: unknown }>;

/** One usage event (track.js), for the few a page reports by name: a game's result has its score as `value`. */
export const track = oldTrack as (kind: string, name: string, detail?: string, ref?: string, value?: number | null,
  obj?: string) => void;

/**
 * A player's requests to the bot as a list (bananas.js). Its markup is the old html tag's: put it in as a string, never
 * inside this client's html`` as it is, which would escape it. `index.get(id)` names a tip's player.
 */
export const requestList = oldRequestList as (requests: unknown[], index: { get(id: number): { name: string } | undefined },
  options?: { limit?: number; maps?: Record<string, unknown> }) => { toString(): string } | '';

/**
 * A line chart's hover readout (charts.js), over a chart ui/charts.ts drew: it reads the scales the chart writes in.
 * `rows` = [{ t, title, items: [{ name, color, value, approx }] }]; `onKey(text)` reads a row out on each key press.
 */
export const chartHover = oldChartHover as (wrap: HTMLElement, rows: readonly unknown[],
  options?: { format?: (v: number) => string; onKey?: (text: string) => void }) => void;

/** The Portuguese strings (already loaded by the old app when the page is in Portuguese). */
export const portuguese = () => import('../../../assets/js/core/pt.js').then(m => m.PT);

/**
 * An old page module (assets/js/pages/<name>.js), for what the new client doesn't draw yet. Found from this module's
 * own address (assets/web/…), with its ?v= version, which is the one the old app's modules have: the same address is
 * the same module, so the page shares the old app's state.
 */
export function oldPage(name: string): Promise<(root: HTMLElement, args: unknown) => Promise<void>> {
  const here = new URL(import.meta.url);
  return import(/* @vite-ignore */ new URL(`../js/pages/${name}.js${here.search}`, here).href).then(m => m.default);
}
