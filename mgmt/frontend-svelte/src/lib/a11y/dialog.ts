// ============ ACCESSIBLE DIALOG BEHAVIOUR (audit PR-36) ============
//
// The public portal had five dialogs — the shared `Modal` plus `AnnouncementPopup`,
// `Chatbot`, `ContributorDetail` and `MoreMenu` — and every one of them set
// `role="dialog"` with `aria-modal="true"` while managing no focus at all.
//
// That combination is worse than having no dialog role. `aria-modal="true"` tells a screen
// reader to ignore everything outside the dialog; leaving focus outside it then parks the
// user in content their own screen reader has been told does not exist. Tab walked out into
// the page behind, and closing dropped focus on `<body>` so the user restarted from the top
// of the document.
//
// WHY AN ACTION AND NOT ONE COMPONENT. The five dialogs genuinely have different shapes: a
// centred sheet, a bottom sheet, a docked chat panel, a slide-over menu. Forcing them into
// one wrapper would have meant rewriting four layouts to fix a focus bug. What they must
// share is BEHAVIOUR, so that is what this exports; each component keeps its own chrome and
// adds `use:dialog`.
//
// Everything here is framework-free apart from the action signature, so the trap and the
// focusable-ordering rules can be tested directly.

/** Elements that can actually receive focus, in DOM order. */
const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * The focusable elements inside `container`, in tab order.
 *
 * `offsetParent === null` filters out anything display:none — a hidden control that still
 * matches the selector would otherwise become a dead stop in the trap. jsdom reports
 * `offsetParent` as null for everything, so the check is skipped when layout is unavailable
 * (`offsetWidth`/`offsetHeight` are 0 for every element there too).
 */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  const all = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const layoutAvailable = typeof container.offsetParent !== 'undefined'
    && (container.offsetWidth > 0 || container.offsetHeight > 0);
  if (!layoutAvailable) return all.filter((el) => !el.hasAttribute('hidden'));
  return all.filter((el) => !el.hasAttribute('hidden') && (el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement));
}

/**
 * Where focus should go when the dialog opens.
 *
 * Preference order: an element the author marked `data-autofocus`, then the first focusable,
 * then the dialog itself. The dialog is the last resort rather than the first choice because
 * landing on the container announces the dialog's name and leaves the user one Tab from the
 * first control; landing on a Close button first would announce "Close".
 */
export function initialFocusTarget(container: HTMLElement): HTMLElement {
  const marked = container.querySelector<HTMLElement>('[data-autofocus]');
  if (marked) return marked;
  const first = focusableWithin(container)[0];
  return first ?? container;
}

/**
 * Given the focusables and the currently focused element, the element a Tab press should
 * move to — or `null` when the browser's own behaviour is already correct.
 *
 * Pure, so the wrap-around rules are testable without a real dialog.
 */
export function nextFocusOnTab(
  items: HTMLElement[],
  active: Element | null,
  shift: boolean,
): HTMLElement | null {
  if (!items.length) return null;
  const first = items[0];
  const last = items[items.length - 1];
  const index = active ? items.indexOf(active as HTMLElement) : -1;

  // Focus is outside the dialog entirely: pull it back to the nearest edge.
  if (index === -1) return shift ? last : first;
  if (shift && active === first) return last;
  if (!shift && active === last) return first;
  return null; // in the middle — let the browser move it
}

export interface DialogOptions {
  /** Called on Escape, and on a backdrop click if the component wires one. */
  onclose?: () => void;
  /** Set false for a dialog that must not be dismissed with Escape. Defaults to true. */
  closeOnEscape?: boolean;
  /** Element to return focus to. Defaults to whatever was focused when the dialog opened. */
  returnFocusTo?: HTMLElement | null;
  /**
   * MODAL (default) traps Tab, marks the rest of the page inert and locks scroll — the
   * behaviour `aria-modal="true"` promises.
   *
   * Pass `false` for a genuinely non-modal dialog: the chat panel is docked beside the page
   * and is meant to be used WITH it, so it carries no `aria-modal` and must not trap. It
   * still gets initial focus, Escape and focus return. Trapping a non-modal panel would be
   * the same category of lie as the modal ones told before this: the ARIA and the keyboard
   * behaviour have to agree, in whichever direction.
   */
  modal?: boolean;
}

/** The body children that are NOT the subtree containing this dialog. */
function backgroundSiblings(node: HTMLElement): HTMLElement[] {
  let top: HTMLElement = node;
  while (top.parentElement && top.parentElement !== document.body) top = top.parentElement;
  return [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== top);
}

/**
 * Svelte action. Attach to the element carrying `role="dialog"`:
 *
 *   <div role="dialog" aria-modal="true" aria-labelledby={titleId} use:dialog={{ onclose }}>
 *
 * Because the action lives on the dialog node, and the node only exists inside `{#if open}`,
 * Escape is bound exactly while the dialog is open. The previous code registered a
 * `<svelte:window onkeydown>` outside that block, so a mounted-but-closed dialog still
 * reacted to Escape anywhere on the page.
 */
export function dialog(node: HTMLElement, options: DialogOptions = {}) {
  let opts = options;

  const isModal = opts.modal !== false;
  const previouslyFocused = (opts.returnFocusTo ?? document.activeElement) as HTMLElement | null;
  const previousOverflow = document.body.style.overflow;
  const backgrounded = isModal ? backgroundSiblings(node) : [];

  // `inert` is the real mechanism (removes the subtree from focus AND from the a11y tree);
  // `aria-hidden` is set alongside it for engines that do not support inert yet. Both are
  // recorded so an element that already had them keeps them on release.
  const hadInert = new WeakSet<HTMLElement>();
  const hadAriaHidden = new WeakSet<HTMLElement>();
  for (const el of backgrounded) {
    if (el.hasAttribute('inert')) hadInert.add(el); else el.setAttribute('inert', '');
    if (el.getAttribute('aria-hidden') === 'true') hadAriaHidden.add(el); else el.setAttribute('aria-hidden', 'true');
  }

  if (isModal) document.body.style.overflow = 'hidden';

  // The container must be focusable for the "no focusable content" case to work.
  if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');

  // Focus after paint: the dialog's content may still be mounting.
  const focusFrame = requestAnimationFrame(() => initialFocusTarget(node).focus());
  // …and immediately as well, so a synchronous test (and a browser without rAF timing
  // luck) sees focus inside the dialog rather than on the trigger.
  initialFocusTarget(node).focus();

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && opts.closeOnEscape !== false) {
      e.stopPropagation();
      opts.onclose?.();
      return;
    }
    if (e.key !== 'Tab' || !isModal) return;
    const target = nextFocusOnTab(focusableWithin(node), document.activeElement, e.shiftKey);
    if (target) {
      e.preventDefault();
      target.focus();
    }
  }

  // Capture on the document: a Tab pressed while focus has escaped the dialog (a stray
  // programmatic focus, a browser quirk) still has to be caught, and a listener on the
  // dialog node alone would never see it.
  document.addEventListener('keydown', onKeydown, true);

  return {
    update(next: DialogOptions) { opts = next ?? {}; },
    destroy() {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKeydown, true);
      for (const el of backgrounded) {
        if (!hadInert.has(el)) el.removeAttribute('inert');
        if (!hadAriaHidden.has(el)) el.removeAttribute('aria-hidden');
      }
      if (isModal) document.body.style.overflow = previousOverflow;
      // Only take focus back if it is still inside the dialog (or nowhere). If something
      // else has deliberately claimed it since — a toast, a following dialog — stealing it
      // back would be the more surprising behaviour.
      const active = document.activeElement;
      if (previouslyFocused?.isConnected && (active === document.body || node.contains(active))) {
        previouslyFocused.focus();
      }
    },
  };
}
