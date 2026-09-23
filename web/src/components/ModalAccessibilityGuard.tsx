import { useEffect } from "react";

const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]';
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function isVisible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

export function topModal(): HTMLElement | null {
  const modals = Array.from(document.querySelectorAll<HTMLElement>(MODAL_SELECTOR)).filter(isVisible);
  return modals.at(-1) ?? null;
}

export function modalFocusableElements(modal: HTMLElement): HTMLElement[] {
  return Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

function focusModal(modal: HTMLElement): void {
  const target =
    modal.querySelector<HTMLElement>("[autofocus]") ??
    modalFocusableElements(modal)[0] ??
    modal;

  if (target === modal && !modal.hasAttribute("tabindex")) {
    modal.setAttribute("tabindex", "-1");
    modal.dataset.a11yGuardTabindex = "true";
  }
  target.focus({ preventScroll: true });
}

export function trapModalTab(event: KeyboardEvent, modal: HTMLElement): boolean {
  if (event.key !== "Tab") return false;

  const focusable = modalFocusableElements(modal);
  if (focusable.length === 0) {
    event.preventDefault();
    focusModal(modal);
    return true;
  }

  const active = document.activeElement as HTMLElement | null;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (!active || !modal.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
    return true;
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
    return true;
  }

  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
    return true;
  }

  return false;
}

/**
 * Accessibility backstop for the dashboard's legacy/manual modal surfaces.
 *
 * Several dashboard pages own their modal DOM directly rather than sharing a
 * single dialog primitive. aria-modal=true promises assistive technology that
 * keyboard focus cannot escape into the background, so enforce that promise
 * centrally until those surfaces are migrated to one primitive.
 *
 * This guard intentionally does not own Escape/close behavior: each dialog
 * still owns its business semantics. It only owns initial focus containment,
 * Tab/Shift+Tab cycling and focus restoration.
 */
export function ModalAccessibilityGuard() {
  useEffect(() => {
    let activeModal: HTMLElement | null = null;
    let restoreTarget: HTMLElement | null = null;
    let focusQueued = false;

    const sync = () => {
      const next = topModal();

      if (next === activeModal) return;

      if (!activeModal && next) {
        const current = document.activeElement;
        restoreTarget = current instanceof HTMLElement ? current : null;
      }

      if (activeModal?.dataset.a11yGuardTabindex === "true") {
        activeModal.removeAttribute("tabindex");
        delete activeModal.dataset.a11yGuardTabindex;
      }

      activeModal = next;

      if (next) {
        if (!focusQueued) {
          focusQueued = true;
          queueMicrotask(() => {
            focusQueued = false;
            const current = topModal();
            if (!current) return;
            activeModal = current;
            if (!current.contains(document.activeElement)) focusModal(current);
          });
        }
      } else {
        const target = restoreTarget;
        restoreTarget = null;
        if (target?.isConnected) queueMicrotask(() => target.focus({ preventScroll: true }));
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const modal = topModal();
      if (!modal) return;
      activeModal = modal;
      trapModalTab(event, modal);
    };

    const onFocusIn = (event: FocusEvent) => {
      const modal = topModal();
      if (!modal) return;
      activeModal = modal;
      if (event.target instanceof Node && !modal.contains(event.target)) {
        focusModal(modal);
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-modal", "role", "hidden", "style", "class"],
    });

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    sync();

    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      if (activeModal?.dataset.a11yGuardTabindex === "true") {
        activeModal.removeAttribute("tabindex");
        delete activeModal.dataset.a11yGuardTabindex;
      }
    };
  }, []);

  return null;
}
