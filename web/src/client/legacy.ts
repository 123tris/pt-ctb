// What the new client still takes from the old one (assets/js), all in this one file so porting the rest (Phase 4) only
// changes it. The bundle doesn't copy these modules: tools/web-build.mjs keeps them as imports of the old site's own
// files, so they're the very modules the old app already loaded (its language, its settings, its sign-in).

export { CONFIG } from '../../../assets/js/config.js';
export { lang } from '../../../assets/js/core/i18n.js';
export { announce, writeQuery, setTitle, myId } from '../../../assets/js/core/ui.js';

/** The Portuguese strings (already loaded by the old app when the page is in Portuguese). */
export const portuguese = () => import('../../../assets/js/core/pt.js').then(m => m.PT);

/** The old leaderboards page, for the tabs not ported yet and for data without packs. */
export const oldRankings = () => import('../../../assets/js/pages/rankings.js').then(m => m.default);
