import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ClampedDescription, clampDescriptionStyle, toast, toastHistory, TOAST_HISTORY_LIMIT } = await jiti.import("./toast.tsx");

const TOOL_LIST = "xd://: mounted mcp__ida_reverse_engineering_ida_address_context, mcp__ida_decompile";

test("clamped description renders collapsed to 2 lines with an expand affordance", () => {
  const html = renderToStaticMarkup(React.createElement(ClampedDescription, null, TOOL_LIST));

  assert.match(html, new RegExp(TOOL_LIST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /-webkit-line-clamp:2/);
  assert.match(html, /-webkit-box/);
  assert.match(html, /overflow:hidden/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /cursor:pointer/);
  assert.match(html, /Click to expand/);
});

test("clamp style helper drops the clamp when expanded", () => {
  const collapsed = clampDescriptionStyle(false);
  const expanded = clampDescriptionStyle(true);

  assert.equal(collapsed.display, "-webkit-box");
  assert.equal(collapsed.WebkitLineClamp, 2);
  assert.equal(collapsed.overflow, "hidden");
  assert.equal(collapsed.cursor, "pointer");

  assert.equal(expanded.display, undefined);
  assert.equal(expanded.WebkitLineClamp, undefined);
  assert.equal(expanded.overflow, undefined);
  assert.equal(expanded.cursor, "default");
});

test("history keeps the newest toasts first, capped at the limit", () => {
  toastHistory.clear();
  for (let i = 0; i < TOAST_HISTORY_LIMIT + 5; i++) toast.info(`n${i}`);
  const entries = toastHistory.get();
  assert.equal(entries.length, TOAST_HISTORY_LIMIT);
  assert.equal(entries[0].title, `n${TOAST_HISTORY_LIMIT + 4}`);
  assert.equal(entries.at(-1).title, "n5");
});

test("a reused toast id replaces its history entry; remove and clear drop entries", () => {
  toastHistory.clear();
  toast.info("update v1", undefined, { id: "update" });
  const other = toast.error("failed");
  toast.info("update v2", undefined, { id: "update" });
  assert.deepEqual(toastHistory.get().map((e) => [e.id, e.title, e.kind]), [["update", "update v2", "info"], [other, "failed", "error"]]);

  toastHistory.remove("update");
  assert.deepEqual(toastHistory.get().map((e) => e.id), [other]);
  toastHistory.clear();
  assert.equal(toastHistory.get().length, 0);
});
