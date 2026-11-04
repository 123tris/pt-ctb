// What the new client still takes from the old one (assets/js), all in this one file so porting the rest (Phase 4) only
// changes it. The bundle doesn't copy these modules: tools/web-build.mjs keeps them as imports of the old site's own
// files, so they're the very modules the old app already loaded (its language, its settings, its sign-in).

export { CONFIG } from '../../../assets/js/config.js';
export { lang } from '../../../assets/js/core/i18n.js';
export { NotFound } from '../../../assets/js/core/data.js';
export {
  announce, writeQuery, readQuery, setTitle, myId, prefs, go, here, openSearch, scrollBehavior, reducedMotion, paginate,
} from '../../../assets/js/core/ui.js';

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
