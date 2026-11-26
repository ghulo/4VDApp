/**
 * The chosen option in a segmented control, the current page in the
 * sidebar and among page numbers, and the line under the pointer in a menu, is drawn as one highlight on its group that glides to the next
 * choice, the way iOS segmented controls do (motion.css, "Sliding selection").
 *
 * Works for every group on the page without changes to the screens: it
 * watches for groups and choices coming and going, measures the chosen
 * option, and writes its box as --pill-x/-y/-w/-h on the group. A group shows
 * its first highlight in place and only animates after that, so nothing
 * slides in from the corner when a page opens.
 */
const GROUPS: { group: string; chosen: string }[] = [
  { group: '.segmented', chosen: ":scope > [aria-checked='true']" },
  { group: '.sidebar__nav', chosen: '.sidebar__link.active' },
  // The current page among the page numbers under a list.
  { group: '.pagination__pages', chosen: "[aria-current='page']" },
  // In a menu, the line under the pointer or the keyboard (marked by followPointer below).
  { group: '.menu', chosen: '.menu__item[data-hover]' },
];

/** Marks the menu line the pointer or the keyboard is on, so the highlight can glide to it. */
function followPointer(event: Event): void {
  const target = event.target instanceof Element ? event.target : null;
  const item = target?.closest<HTMLElement>('.menu__item');
  const menu = target?.closest<HTMLElement>('.menu');
  if (!menu) return;
  for (const other of menu.querySelectorAll<HTMLElement>('.menu__item[data-hover]')) if (other !== item) delete other.dataset.hover;
  if (item && !item.matches(':disabled')) item.dataset.hover = '';
}

/** The pointer left the menu (and the keyboard isn't in it): no line is marked. */
function leaveMenu(event: Event): void {
  const menu = event.target instanceof Element ? event.target.closest<HTMLElement>('.menu') : null;
  const next = (event as PointerEvent | FocusEvent).relatedTarget;
  if (!menu || (next instanceof Node && menu.contains(next))) return;
  if (event.type === 'pointerout' && menu.contains(document.activeElement)) return;
  for (const item of menu.querySelectorAll<HTMLElement>('.menu__item[data-hover]')) delete item.dataset.hover;
}

function place(group: HTMLElement, chosen: string): void {
  // A hidden group (inside a closed panel) keeps its last box.
  if (!group.offsetParent) return;
  const option = group.querySelector<HTMLElement>(chosen);
  if (!option) {
    if (group.dataset.pill) group.dataset.pill = 'none';
    return;
  }
  const fresh = !group.dataset.pill || group.dataset.pill === 'none';
  // Also makes the group the box its options are measured against.
  if (fresh) group.dataset.pill = 'still';

  // offset* ignore transforms, so an option pressed down mid-click doesn't skew the box.
  let x = option.offsetLeft;
  let y = option.offsetTop;
  for (let parent = option.offsetParent as HTMLElement | null; parent && parent !== group; parent = parent.offsetParent as HTMLElement | null) {
    x += parent.offsetLeft;
    y += parent.offsetTop;
  }
  group.style.setProperty('--pill-x', `${x}px`);
  group.style.setProperty('--pill-y', `${y}px`);
  group.style.setProperty('--pill-w', `${option.offsetWidth}px`);
  group.style.setProperty('--pill-h', `${option.offsetHeight}px`);

  // The first box appears in place; it glides from the next change on.
  if (fresh) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (group.dataset.pill === 'still') group.dataset.pill = 'live';
      }),
    );
  }
}

/** Starts watching the document; returns a function that stops. */
export function startSelectionPills(root: HTMLElement = document.body): () => void {
  let queued = false;
  const sized = new WeakSet<Element>();
  const resize = new ResizeObserver(() => schedule());

  function update() {
    queued = false;
    for (const { group, chosen } of GROUPS) {
      for (const element of root.querySelectorAll<HTMLElement>(group)) {
        if (!sized.has(element)) {
          sized.add(element);
          resize.observe(element);
        }
        place(element, chosen);
      }
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }

  const mutations = new MutationObserver(schedule);
  mutations.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-checked', 'aria-current', 'class', 'data-hover', 'hidden'] });
  root.addEventListener('pointerover', followPointer);
  root.addEventListener('focusin', followPointer);
  root.addEventListener('pointerout', leaveMenu);
  root.addEventListener('focusout', leaveMenu);
  window.addEventListener('resize', schedule);
  document.fonts?.ready.then(schedule);
  schedule();

  return () => {
    mutations.disconnect();
    root.removeEventListener('pointerover', followPointer);
    root.removeEventListener('focusin', followPointer);
    root.removeEventListener('pointerout', leaveMenu);
    root.removeEventListener('focusout', leaveMenu);
    resize.disconnect();
    window.removeEventListener('resize', schedule);
  };
}
