// What the app (app.ts) runs around the pages: the top bar's search and You menu, the usage counts, the consent prompt,
// the reveal motion, the easter eggs and the tips, and the helpers its router uses. In one module so client/page.ts
// can reach all of it too: see there why.

export { CONFIG } from './config.ts';
export { lang, htmlLang, setLang } from './i18n.ts';
export { store, clientCtx } from './boot.ts';
export { here, go, setTitle, enhanceTables, openSearch } from './ui.ts';
export { startTips, checkOldUi } from './tips.ts';
export { startTracking, trackView, trackError } from './track.ts';
export { startFun } from './fun.ts';
export { initSearch } from './search.ts';
export { initYou, readSignIn } from './you.ts';
export { initConsent } from './consent.ts';
export { moved } from './moved.ts';
export { NotFound } from '../kernel/store.ts';
export { loading } from '../ui/page.ts';
export { notFoundQuips, pick } from '../ui/lore.ts';
