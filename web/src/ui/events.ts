// How activity events read, as assets/js/core/events.js has it. So far what the profile needs: a Dan stage's name. The
// home and activity pages will bring the events themselves.

import type { Ctx } from '../kernel/ctx.ts';
import { DAN_STAGES } from '../kernel/model.ts';

/** "Zeroth Dan", "7th Dan", "Aleph". */
export const danName = (ctx: Ctx, i: number): string =>
  (i === 0 ? ctx.t('Zeroth Dan') : i <= 10 ? ctx.t('{nth} Dan', { nth: ctx.fmt.ordinal(i) }) : String(DAN_STAGES[i].key));
