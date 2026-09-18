import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { SettingsTabs, SETTINGS_CATEGORIES } = await jiti.import("./SettingsTabs.tsx");

test("horizontal settings tabs expose every category description", () => {
  const html = renderToStaticMarkup(React.createElement(SettingsTabs, {
    active: "general",
    onSelect: () => {},
    layout: "horizontal",
  }));

  for (const category of SETTINGS_CATEGORIES) {
    assert.ok(html.includes(`>${category.description}<`), `description is not visibly rendered for ${category.id}`);
  }
});

test("settings tabs render attention indicator when tab needs attention", () => {
  const verticalHtml = renderToStaticMarkup(React.createElement(SettingsTabs, {
    active: "general",
    onSelect: () => {},
    layout: "vertical",
    attentionTabs: { system: "Update available" },
  }));

  assert.ok(verticalHtml.includes('aria-label="Update available"'), "vertical tab should render attention indicator with aria-label");
  assert.ok(verticalHtml.includes('role="status"'), "vertical tab should render role=status");

  const horizontalHtml = renderToStaticMarkup(React.createElement(SettingsTabs, {
    active: "general",
    onSelect: () => {},
    layout: "horizontal",
    attentionTabs: { system: "Update available" },
  }));

  assert.ok(horizontalHtml.includes('aria-label="Update available"'), "horizontal tab should render attention indicator with aria-label");
  assert.ok(horizontalHtml.includes('(Update available)'), "horizontal tab title should include attention label");

  const noAttentionHtml = renderToStaticMarkup(React.createElement(SettingsTabs, {
    active: "general",
    onSelect: () => {},
    layout: "vertical",
  }));
  assert.ok(!noAttentionHtml.includes('role="status"'), "no attention indicator when attentionTabs is omitted");
});
