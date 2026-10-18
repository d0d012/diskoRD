/**
 * Positions a fixed panel next to an anchor (the profile card): to its right,
 * or to its left when there's no room, top-aligned and kept on screen.
 * Writes straight to the element's style: it's a measurement, not render state.
 */
export function placeBeside(panel: HTMLElement | null, anchor: HTMLElement | null) {
  const rect = anchor?.getBoundingClientRect();
  if (!panel || !rect) return;
  const width = panel.offsetWidth || 240;
  const height = panel.offsetHeight || 0;
  const right = rect.right + 10;
  const left = right + width > window.innerWidth - 8 ? Math.max(8, rect.left - width - 10) : right;
  const top = Math.max(8, Math.min(rect.top, window.innerHeight - height - 8));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}
