// Small browser-only helpers for mount(): things that change the page after it's drawn.

/** Marks the chip (or other toggle) whose data-`attr` equals `value` as pressed, the rest as not. */
export function setPressed(scope: ParentNode, attr: string, value: string | number): void {
  const key = attr.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
  scope.querySelectorAll<HTMLElement>(`[data-${attr}]`).forEach(b => {
    const on = b.dataset[key] === String(value);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
