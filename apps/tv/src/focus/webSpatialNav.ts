/**
 * D-pad style arrow-key navigation for the browser preview.
 *
 * On Fire TV / Apple TV the platform focus engine does this natively; browsers
 * only have Tab order. Rules (matching TV focus engines):
 *   - Left/Right only move within the same row (vertical overlap required).
 *   - Up/Down go to the nearest row in that direction, then the item in that row
 *     closest horizontally.
 *   - The newly focused item is scrolled into view.
 */

type Dir = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
const SELECTOR = '[data-tv-focusable="true"]';
const ROW_TOLERANCE = 24; // px: items whose top edges are this close count as the same row

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

const overlapX = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left);
const overlapY = (a: DOMRect, b: DOMRect) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
const cx = (r: DOMRect) => r.left + r.width / 2;
const cy = (r: DOMRect) => r.top + r.height / 2;

export function pickNext(from: DOMRect, candidates: { el: HTMLElement; r: DOMRect }[], dir: Dir): HTMLElement | null {
  if (dir === 'ArrowLeft' || dir === 'ArrowRight') {
    const sign = dir === 'ArrowRight' ? 1 : -1;
    const inRow = candidates.filter(({ r }) => overlapY(from, r) > Math.min(from.height, r.height) * 0.3 && (cx(r) - cx(from)) * sign > 1);
    inRow.sort((a, b) => Math.abs(cx(a.r) - cx(from)) - Math.abs(cx(b.r) - cx(from)));
    if (inRow.length) return inRow[0].el;
    // Nothing level with us: allow a nearby element (e.g. keyboard -> results list),
    // but never a jump across the screen (e.g. end of a shelf -> header button).
    const near = candidates.filter(({ r }) => (sign > 0 ? r.left >= from.right - 4 : r.right <= from.left + 4) && Math.abs(cy(r) - cy(from)) < Math.min(from.height, window.innerHeight * 0.08) * 4);
    near.sort((a, b) => Math.abs(cy(a.r) - cy(from)) - Math.abs(cy(b.r) - cy(from)));
    return near[0]?.el ?? null;
  }
  const sign = dir === 'ArrowDown' ? 1 : -1;
  const ahead = candidates.filter(({ r }) => (cy(r) - cy(from)) * sign > 1 && overlapY(from, r) <= 0);
  if (!ahead.length) return null;
  const dist = ({ r }: { r: DOMRect }) => (sign > 0 ? r.top - from.bottom : from.top - r.bottom);
  const nearest = Math.min(...ahead.map(dist));
  const row = ahead.filter((c) => dist(c) <= nearest + ROW_TOLERANCE);
  row.sort((a, b) => {
    const oa = overlapX(from, a.r) > 0 ? 0 : 1;
    const ob = overlapX(from, b.r) > 0 ? 0 : 1;
    return oa - ob || Math.abs(cx(a.r) - cx(from)) - Math.abs(cx(b.r) - cx(from));
  });
  return row[0].el;
}

export function installWebSpatialNav(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const all = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR)).filter(visible);
    if (!all.length) return;
    e.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    let next: HTMLElement | null;
    if (!active || !all.includes(active)) {
      next = all[0];
    } else {
      const from = active.getBoundingClientRect();
      next = pickNext(from, all.filter((el) => el !== active).map((el) => ({ el, r: el.getBoundingClientRect() })), e.key as Dir);
    }
    if (next) {
      next.focus({ preventScroll: true });
      // Leave room for the shelf title above a row and the card text below it.
      next.style.scrollMargin = '90px 120px 110px 120px';
      // Instant, not smooth: smooth-scrolling two nested scrollers at once gets cut short in Chrome.
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
