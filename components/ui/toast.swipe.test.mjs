import "../../tests/setup-dom.mjs";
import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import React from "react";
import { act, cleanup, render } from "@testing-library/react/pure.js";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tryNative: false, tsconfigPaths: true });
const { ToastProvider, toast } = await jiti.import("./toast.tsx");

before(() => {
  globalThis.AbortController = window.AbortController;
  window.Element.prototype.setPointerCapture = () => {};
});
afterEach(() => { act(() => toast.close()); cleanup(); });

function pointer(target, type, x, y, pointerType) {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
  act(() => { target.dispatchEvent(event); });
}
function swipeToast(pointerType, dx) {
  render(React.createElement(ToastProvider, null));
  act(() => { toast.info("Agent finished", "Body"); });
  const card = document.querySelector(".toast-card");
  pointer(card, "pointerdown", 200, 50, pointerType);
  pointer(card, "pointermove", 200 + dx / 4, 50, pointerType);
  pointer(card, "pointermove", 200 + dx, 52, pointerType);
  pointer(card, "pointerup", 200 + dx, 52, pointerType);
  return card;
}

test("a touch swipe either way dismisses a toast, which the sidebar gesture then leaves alone", () => {
  for (const dx of [80, -80]) {
    const card = swipeToast("touch", dx);
    assert.equal(card.hasAttribute("data-ending-style"), true);
    assert.equal(card.getAttribute("data-swipe-direction"), dx > 0 ? "right" : "left");
    assert.equal(card.hasAttribute("data-swipe-dismiss"), true);
    act(() => toast.close());
    cleanup();
  }
});

test("a mouse drag over a toast selects text instead of dismissing it", () => {
  const card = swipeToast("mouse", 120);
  assert.equal(card.hasAttribute("data-ending-style"), false);
});
