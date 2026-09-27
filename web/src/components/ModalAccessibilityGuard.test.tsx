// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ModalAccessibilityGuard,
  modalFocusableElements,
  trapModalTab,
} from "./ModalAccessibilityGuard";

let host: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ModalAccessibilityGuard />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("ModalAccessibilityGuard", () => {
  it("cycles Tab and Shift+Tab inside an aria-modal dialog", () => {
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const first = document.createElement("button");
    const last = document.createElement("button");
    modal.append(first, last);
    document.body.append(modal);

    expect(modalFocusableElements(modal)).toEqual([first, last]);

    last.focus();
    const forward = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    expect(trapModalTab(forward, modal)).toBe(true);
    expect(document.activeElement).toBe(first);

    first.focus();
    const backward = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      cancelable: true,
    });
    expect(trapModalTab(backward, modal)).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("moves focus into a newly opened modal and restores the opener on close", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.append(opener);
    opener.focus();

    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const action = document.createElement("button");
    action.textContent = "Action";
    modal.append(action);
    document.body.append(modal);

    await flush();
    expect(document.activeElement).toBe(action);

    modal.remove();
    await flush();
    expect(document.activeElement).toBe(opener);
  });

  it("pulls escaped focus back into the active modal", async () => {
    const outside = document.createElement("button");
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const action = document.createElement("button");
    modal.append(action);
    document.body.append(outside, modal);

    await flush();
    outside.focus();
    outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    expect(document.activeElement).toBe(action);
  });
});
