import "../tests/setup-dom.mjs";
import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import React from "react";
import { act, cleanup, render } from "@testing-library/react/pure.js";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tryNative: false, tsconfigPaths: true });
const { NotificationList } = await jiti.import("./NotificationList.tsx");
const { toastHistory } = await jiti.import("./ui/toast.tsx");

before(() => {
  // Reduced motion removes a swiped row at once; jsdom fires no transitionend.
  window.matchMedia = (query) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} });
  window.Element.prototype.setPointerCapture = () => {};
});
afterEach(() => { cleanup(); toastHistory.clear(); });

function pointer(target, type, x, y, { pointerType = "touch", detail = 1 } = {}) {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
  act(() => { target.dispatchEvent(event); });
}
function drag(target, [x1, y1], [x2, y2], options) {
  pointer(target, "pointerdown", x1, y1, options);
  pointer(target, "pointermove", (x1 + x2) / 2, (y1 + y2) / 2, options);
  pointer(target, "pointermove", x2, y2, options);
  pointer(target, "pointerup", x2, y2, options);
}
function mount() {
  act(() => { toastHistory.record("info", "Agent finished", "A long description", { id: "n1", clamp: true }); });
  const view = render(React.createElement(NotificationList));
  return { view, description: () => view.container.querySelector("[aria-expanded]") };
}

test("a sideways touch swipe from anywhere on the row dismisses it, in either direction", () => {
  for (const [from, to] of [[[100, 50], [160, 58]], [[200, 50], [140, 44]]]) {
    const { description } = mount();
    drag(description(), from, to);
    assert.equal(toastHistory.get().length, 0);
    cleanup();
  }
});

test("short, mostly vertical, and mouse drags keep the row", () => {
  const { description } = mount();
  drag(description(), [100, 50], [130, 52]);
  drag(description(), [100, 50], [150, 120]);
  drag(description(), [100, 50], [200, 52], { pointerType: "mouse" });
  assert.equal(toastHistory.get().length, 1);
});

test("the click ending a drag is swallowed; taps and keyboard clicks still reach the row", () => {
  const { description } = mount();
  pointer(description(), "pointerdown", 100, 50, { pointerType: "mouse" });
  pointer(description(), "click", 160, 50, { pointerType: "mouse" });
  assert.equal(description().getAttribute("aria-expanded"), "false");
  pointer(description(), "pointerdown", 100, 50);
  pointer(description(), "click", 103, 51);
  assert.equal(description().getAttribute("aria-expanded"), "true");
  // A keyboard click reports no position; an earlier press must not make it look like a drag.
  pointer(description(), "pointerdown", 100, 50);
  pointer(description(), "click", 0, 0, { detail: 0 });
  assert.equal(description().getAttribute("aria-expanded"), "false");
});
