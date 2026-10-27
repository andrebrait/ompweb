import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const jiti = createJiti(import.meta.url, {
  tryNative: false,
  alias: { "@/": fileURLToPath(new URL("../", import.meta.url)) },
});
const route = await jiti.import("../app/api/manifest/route.ts");

// Both colors must follow the cookie: theme_color tints the system bars and
// background_color shows through an edge-to-edge navigation bar.
const themeColor = async (cookie) => {
  const headers = cookie === undefined ? {} : { cookie };
  const { theme_color, background_color } = await route.GET(new NextRequest("http://localhost/api/manifest", { headers })).json();
  assert.equal(background_color, theme_color);
  return theme_color;
};

test("manifest colors follow the browser's theme cookie, so the installed app's system bars match", async () => {
  assert.equal(await themeColor("omp-theme-color=F2F0EA"), "#F2F0EA");
  assert.equal(await themeColor("a=1; omp-theme-color=0a0a0c"), "#0a0a0c");
});

test("manifest colors ignore a missing or malformed cookie", async () => {
  assert.equal(await themeColor(undefined), "#000000");
  for (const value of ["zzzzzz", "%23abcdef", "abcde", "abcdef0", "abcdef%22%7D"]) {
    assert.equal(await themeColor(`omp-theme-color=${value}`), "#000000", value);
  }
});
