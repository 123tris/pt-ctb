// The privacy page's browser half (privacy.ts draws it): the buttons that turn the usage counts off or on in this
// browser. After each, the "In this browser" section is drawn again with the new state and what was done.
//
// The listener is on that section, which stays: the old page put one on the page's root (#content), which outlives the
// page, so it added another on every visit and still answered [data-act] clicks on later pages.

import type { Ctx } from '../kernel/ctx.ts';
import { browserSection } from './privacy.ts';
import { trackingBlock, optOut, optIn } from '../client/track.ts';

export function mount(root: HTMLElement, ctx: Ctx): void {
  const { t } = ctx;
  const section = root.querySelector('#privacy-state')!.closest('section')!;
  const draw = (said: string) => { section.innerHTML = String(browserSection(ctx, trackingBlock(), said)); };
  section.addEventListener('click', e => {
    const act = (e.target as Element).closest?.<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'off') { optOut(); draw(t('Done. Nothing more is recorded in this browser.')); }
    else if (act === 'erase') { optOut({ erase: true }); draw(t('Done. Nothing more is recorded, and this browser’s records will be deleted within a day.')); }
    else if (act === 'on') { optIn(); draw(t('Thanks. Counting is on again, with a new random id.')); }
  });
}
