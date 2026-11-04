// The recap's browser half (recap.ts draws it): "Copy recap" puts the year in a few lines, with the page's address, on
// the clipboard.

import type { Ctx } from '../kernel/ctx.ts';
import { shareText, type Data } from './recap.ts';

export function mount(root: HTMLElement, ctx: Ctx, { recap, year }: Data): void {
  const button = root.querySelector<HTMLButtonElement>('#share');
  if (!button || !recap || year === null) return;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareText(ctx, recap, year, location.href));
      button.textContent = ctx.t('Copied!');
    } catch {
      button.textContent = ctx.t('Couldn’t copy');
    }
  });
}
