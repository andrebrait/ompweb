import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./git-status.ts");
}

test("parses null-delimited Git status entries including renames", async () => {
  const { parseGitPorcelainV1 } = await loadSubject();
  const entries = parseGitPorcelainV1([
    " M components/App.tsx",
    "?? notes.txt",
    "R  src/new-name.ts",
    "src/old-name.ts",
    "",
  ].join("\0"));

  assert.deepEqual(entries, [
    {
      path: "components/App.tsx",
      indexStatus: " ",
      worktreeStatus: "M",
    },
    {
      path: "notes.txt",
      indexStatus: "?",
      worktreeStatus: "?",
    },
    {
      path: "src/new-name.ts",
      originalPath: "src/old-name.ts",
      indexStatus: "R",
      worktreeStatus: " ",
    },
  ]);
});

test("classifies Git status for explorer badges", async () => {
  const { classifyGitStatus } = await loadSubject();
  const classify = (pair) => classifyGitStatus({
    path: "file.ts",
    indexStatus: pair[0],
    worktreeStatus: pair[1],
  });

  assert.deepEqual(classify(" M"), { status: "modified", code: "M" });
  assert.deepEqual(classify("??"), { status: "untracked", code: "U" });
  assert.deepEqual(classify("A "), { status: "added", code: "A" });
  assert.deepEqual(classify("R "), { status: "renamed", code: "R" });
  assert.deepEqual(classify("UU"), { status: "conflict", code: "C" });
  assert.deepEqual(classify(" D"), { status: "deleted", code: "D" });
});

test("maps .gitattributes review attributes from real git check-attr output", async (t) => {
  const { GIT_REVIEW_ATTRIBUTES, parseGitCollapseReasons } = await loadSubject();
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "git-attrs-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", repo]);
  fs.writeFileSync(path.join(repo, ".gitattributes"), [
    "graph.json linguist-generated=true -diff",
    "gen/** linguist-generated",
    "vendor/** linguist-vendored",
    "docs/** linguist-documentation",
    "docs/keep.md -linguist-documentation",
    "lock.txt -diff",
    "*.png binary",
    "",
  ].join("\n"));
  const paths = ["graph.json", "gen/a.ts", "vendor/b.js", "docs/c.md", "docs/keep.md", "lock.txt", "logo.png", "src/app.ts"];
  const output = execFileSync("git", ["-C", repo, "check-attr", "-z", "--stdin", ...GIT_REVIEW_ATTRIBUTES], {
    input: paths.map((p) => `${p}\0`).join(""),
    encoding: "utf8",
  });

  assert.deepEqual(Object.fromEntries(parseGitCollapseReasons(output)), {
    "graph.json": "no-diff",
    "gen/a.ts": "generated",
    "vendor/b.js": "vendored",
    "docs/c.md": "documentation",
    "lock.txt": "no-diff",
  });
});
