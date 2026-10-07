import "../../tests/setup-dom.mjs";
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import React from "react";
import { act, cleanup, render } from "@testing-library/react/pure.js";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tryNative: false, tsconfigPaths: true });
const { ToastProvider, toast } = await jiti.import("./toast.tsx");
afterEach(() => { act(() => toast.close()); cleanup(); window.getSelection()?.removeAllRanges(); });

function show(onButton) {
  const opened = [];
  render(React.createElement(ToastProvider, null));
  act(() => {
    toast.info("Agent finished", React.createElement("button", { type: "button", onClick: onButton }, "Open"), { onClick: () => opened.push(1) });
  });
  return { opened, card: () => document.querySelector(".toast-card") };
}

test("clicking anywhere on a toast card runs its action and closes it", () => {
  const { opened, card } = show();
  act(() => card().querySelector(".display-serif").click());
  assert.equal(opened.length, 1);
  assert.equal(card()?.hasAttribute("data-ending-style") ?? true, true);
});

test("the card's own buttons and a text selection do not trigger the card action", () => {
  let pressed = 0;
  const { opened, card } = show(() => { pressed += 1; });
  act(() => card().querySelector("button:not(.toast-close-button)").click());
  assert.equal(pressed, 1);
  const title = card().querySelector(".display-serif");
  window.getSelection().selectAllChildren(title);
  act(() => title.click());
  assert.equal(opened.length, 0);
});
