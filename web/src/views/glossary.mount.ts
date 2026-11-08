// The glossary's browser half (glossary.ts draws it): /glossary?at=bananas brings that entry into view.

import type { State } from './glossary.ts';

export function mount(root: HTMLElement, state: State): void {
  if (state.at) root.querySelector(`#g-${CSS.escape(state.at)}`)?.scrollIntoView({ block: 'center' });
}
