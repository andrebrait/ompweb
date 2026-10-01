import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { parse as parseYaml } from "yaml";

// skills-service.ts imports via the "@/" path alias, which jiti resolves only
// when it is told the project root.
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("..", import.meta.url).pathname.replace(/\/$/, "") } });
const {
  discoverSkills,
  getSkillScanRootDirs,
  getSkillToggleRoots,
  parseSkillFrontmatter,
  readDisableModelInvocation,
  setDisableModelInvocation,
  skillsFromCliPayload,
} = await jiti.import("./skills-service.ts");
// The toggle route authorizes existing files through the consolidated facade.
const { allowFileRoot, isExistingFilePathAllowed } = await jiti.import("./file-access.ts");
const { PATCH } = await jiti.import("../app/api/skills/route.ts");

/** Fake omp: a shell script (POSIX) or .cmd launcher (Windows). */
function writeStubOmp(dir, posixBody, cmdBody) {
  if (process.platform === "win32") {
    const bin = join(dir, "omp.cmd");
    writeFileSync(bin, cmdBody.map((line) => `@${line}\r\n`).join(""));
    return bin;
  }
  const bin = join(dir, "omp");
  writeFileSync(bin, `#!/bin/sh\n${posixBody.join("\n")}\n`, { mode: 0o755 });
  return bin;
}

function skillFile(frontmatter) {
  return `---\nname: demo\ndescription: A demo skill.\n${frontmatter}---\n\n# Demo\n\nBody text.\n`;
}

function flagOf(content) {
  return readDisableModelInvocation(parseSkillFrontmatter(content).frontmatter);
}

test("adds the standard key when no variant is present", () => {
  const out = setDisableModelInvocation(skillFile(""), true);
  assert.match(out, /^---\ndisable-model-invocation: true\nname: demo\n/);
  assert.equal(flagOf(out), true);
});

for (const key of ["disable-model-invocation", "disableModelInvocation", "hide"]) {
  test(`replaces an existing ${key} line instead of duplicating it`, () => {
    const out = setDisableModelInvocation(skillFile(`${key}: false\n`), true);
    assert.equal(out.match(/^(disable-model-invocation|disableModelInvocation|hide)\s*:/gm).length, 1);
    assert.equal(out.includes(`${key}: true`), true);
    // Duplicate keys would make the frontmatter unparseable YAML.
    assert.doesNotThrow(() => parseYaml(/^---\n([\s\S]*?)\n---\n/.exec(out)[1]));
    assert.equal(flagOf(out), true);
  });

  test(`clears ${key} when re-enabling model invocation`, () => {
    const out = setDisableModelInvocation(skillFile(`${key}: true\n`), false);
    assert.doesNotMatch(out, /disable-model-invocation|disableModelInvocation|hide/);
    assert.equal(flagOf(out), false);
    assert.match(out, /name: demo/);
  });
}

test("collapses duplicate variants written by earlier versions", () => {
  const corrupt = skillFile("disable-model-invocation: true\nhide: true\n");
  assert.equal(flagOf(setDisableModelInvocation(corrupt, false)), false);
  assert.doesNotMatch(setDisableModelInvocation(corrupt, false), /hide:/);

  const reenabled = setDisableModelInvocation(corrupt, true);
  assert.equal(reenabled.match(/^(disable-model-invocation|disableModelInvocation|hide)\s*:/gm).length, 1);
  assert.equal(flagOf(reenabled), true);
});

test("leaves indented keys of nested mappings alone", () => {
  const content = skillFile("metadata:\n  hide: true\n");
  const out = setDisableModelInvocation(content, true);
  assert.match(out, /metadata:\n {2}hide: true/);
  assert.match(out, /^disable-model-invocation: true$/m);
});

test("prepends frontmatter when the file has none", () => {
  const out = setDisableModelInvocation("# Demo\n\nBody.\n", true);
  assert.equal(out, "---\ndisable-model-invocation: true\n---\n# Demo\n\nBody.\n");
  assert.equal(setDisableModelInvocation("# Demo\n", false), "# Demo\n");
});

test("preserves CRLF line endings", () => {
  const content = "---\r\nname: demo\r\nhide: true\r\n---\r\nBody\r\n";
  const out = setDisableModelInvocation(content, false);
  assert.equal(out, "---\r\nname: demo\r\n---\r\nBody\r\n");
});

test("scan roots cover the compat directories the app installs into", () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-web-skill-roots-"));
  const agentDir = join(dir, ".omp", "agent");
  const claudeDir = join(dir, ".claude");
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  const oldClaudeDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  try {
    const roots = getSkillScanRootDirs();
    for (const expected of [
      join(agentDir, "skills"),
      join(agentDir, "managed-skills"),
      join(claudeDir, "skills"),
      join(homedir(), ".agent", "skills"),
      join(homedir(), ".agents", "skills"),
      join(homedir(), ".codex", "skills"),
    ]) {
      assert.ok(roots.includes(expected), `missing scan root ${expected}`);
    }
  } finally {
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    if (oldClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = oldClaudeDir;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discovery honors all three frontmatter spellings", async () => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousClaudeDir = process.env.CLAUDE_CONFIG_DIR;
  const dir = mkdtempSync(join(tmpdir(), "omp-web-skill-scan-"));
  process.env.PI_CODING_AGENT_DIR = join(dir, ".omp", "agent");
  process.env.CLAUDE_CONFIG_DIR = join(dir, ".claude");
  try {
    const fixtures = [
      [join(process.env.PI_CODING_AGENT_DIR, "skills", "kebab"), "kebab", "disable-model-invocation: true\n", true],
      [join(process.env.CLAUDE_CONFIG_DIR, "skills", "camel"), "camel", "disableModelInvocation: true\n", true],
      [join(dir, "project", ".agents", "skills", "hidden"), "hidden", "hide: true\n", true],
      [join(dir, "project", ".codex", "skills", "plain"), "plain", "", false],
    ];
    // Where omp lists plugin skills from: outside every user-owned root.
    const pluginSkill = join(dir, "plugins", "node_modules", "pkg", "skills", "p", "SKILL.md");
    mkdirSync(join(pluginSkill, ".."), { recursive: true });
    writeFileSync(pluginSkill, skillFile(""), "utf8");
    for (const [skillDir, name, extra] of fixtures) {
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} fixture.\n${extra}---\n\nBody\n`,
        "utf8",
      );
    }
    const cwd = join(dir, "project");
    mkdirSync(cwd, { recursive: true });
    allowFileRoot(cwd);

    // A binary without `skill list` (node itself) fails the exec, so this
    // exercises the replica-scan fallback regardless of the host's omp.
    const { skills } = await discoverSkills(cwd, process.execPath);
    const byName = new Map(skills.map((s) => [s.name, s]));
    // The exact roots PATCH /api/skills authorizes against.
    const toggleRoots = await getSkillToggleRoots(cwd);
    for (const [, name, , expected] of fixtures) {
      assert.equal(byName.get(name)?.disableModelInvocation, expected, `${name} flag`);
      // Every replica-discovered skill must be togglable; the old hardcoded
      // allowlist failed this.
      assert.ok(
        isExistingFilePathAllowed(byName.get(name).filePath, toggleRoots),
        `${name} is discoverable but rejected by the toggle allowlist`,
      );
    }
    assert.equal(isExistingFilePathAllowed(pluginSkill, toggleRoots), false, "plugin skills stay read-only");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeDir;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discovery uses `omp skill list <cwd> --json` when the binary supports it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-web-skill-cli-"));
  try {
    const payload = join(dir, "payload.json");
    const argsOut = join(dir, "args.txt");
    writeFileSync(payload, JSON.stringify({
      skills: [{ name: "only-from-cli", description: "", filePath: join(dir, "x", "SKILL.md"), source: "native:user", hide: false }],
      warnings: [],
    }));
    const bin = writeStubOmp(
      dir,
      [`echo "$*" > '${argsOut}'`, `cat '${payload}'`],
      [`echo %*> "${argsOut}"`, `type "${payload}"`],
    );
    const { skills } = await discoverSkills(dir, bin);
    assert.deepEqual(skills.map((s) => s.name), ["only-from-cli"]);
    assert.equal(readFileSync(argsOut, "utf8").trim(), `skill list ${dir} --json`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a binary whose `skill list` fails is not re-spawned until it changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-web-skill-cli-miss-"));
  try {
    const log = join(dir, "runs.txt");
    const failing = (marker) =>
      writeStubOmp(dir, [`echo run >> '${log}'`, `# ${marker}`, "exit 1"], [`echo run>>"${log}"`, `rem ${marker}`, "exit /b 1"]);
    const runs = () => readFileSync(log, "utf8").trim().split(/\r?\n/).length;

    const bin = failing("v1");
    await discoverSkills(dir, bin);
    await discoverSkills(dir, bin);
    assert.equal(runs(), 1, "second request reused the cached failure");

    failing("v2 (an updated binary)");
    await discoverSkills(dir, bin);
    assert.equal(runs(), 2, "a changed binary is probed again");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PATCH /api/skills rewrites user-owned skills and refuses plugin skills", async () => {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const dir = mkdtempSync(join(tmpdir(), "omp-web-skill-patch-"));
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
  try {
    const owned = join(dir, "agent", "skills", "owned", "SKILL.md");
    const plugin = join(dir, "plugins", "node_modules", "pkg", "skills", "p", "SKILL.md");
    for (const file of [owned, plugin]) {
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, skillFile(""), "utf8");
    }
    const patch = (filePath) =>
      PATCH(new Request("http://localhost/api/skills", {
        method: "PATCH",
        body: JSON.stringify({ filePath, disableModelInvocation: true }),
      }));

    assert.equal((await patch(owned)).status, 200);
    assert.equal(flagOf(readFileSync(owned, "utf8")), true);
    assert.equal((await patch(plugin)).status, 403);
    assert.equal(readFileSync(plugin, "utf8"), skillFile(""));
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("maps an `omp skill list --json` payload onto SkillInfo", () => {
  const mapped = skillsFromCliPayload({
    skills: [
      {
        name: "calendar",
        description: "Calendar skill.",
        filePath: "/home/me/.omp/skills/calendar/SKILL.md",
        baseDir: "/home/me/.omp/skills/calendar",
        source: "native:user",
        hide: false,
      },
      {
        name: "superpowers/test-driven-development",
        description: "TDD.",
        filePath: "/cache/test-driven-development/SKILL.md",
        source: "claude-plugins:user",
        hide: true,
      },
    ],
    warnings: [{ skillPath: "/x/SKILL.md", message: "boom" }, { skillPath: "", message: "bare" }, "junk"],
  });
  assert.equal(mapped.skills.length, 2);
  assert.deepEqual(mapped.skills[0], {
    name: "calendar",
    description: "Calendar skill.",
    filePath: "/home/me/.omp/skills/calendar/SKILL.md",
    baseDir: "/home/me/.omp/skills/calendar",
    disableModelInvocation: false,
    sourceInfo: { source: ".omp", scope: "user" },
  });
  // BaseDir falls back to the filePath when absent, provider labels fall
  // through for providers the replica has no directory for, and `hide`
  // maps onto disableModelInvocation.
  assert.equal(mapped.skills[1].baseDir, "/cache/test-driven-development");
  assert.equal(mapped.skills[1].sourceInfo.source, "claude-plugins");
  assert.equal(mapped.skills[1].disableModelInvocation, true);
  assert.deepEqual(mapped.diagnostics, [
    { type: "warning", message: "boom", path: "/x/SKILL.md" },
    { type: "warning", message: "bare" },
  ]);
});

test("rejects a malformed `omp skill list --json` payload", () => {
  assert.equal(skillsFromCliPayload(null), undefined);
  assert.equal(skillsFromCliPayload("nope"), undefined);
  assert.equal(skillsFromCliPayload({ skills: "many", warnings: [] }), undefined);
  assert.equal(skillsFromCliPayload({ error: "x" }), undefined);
  // Entries present but none recognizable (e.g. upstream renamed filePath):
  // fall back instead of rendering an empty list.
  assert.equal(skillsFromCliPayload({ skills: [{ name: "x", path: "/p/SKILL.md" }], warnings: [] }), undefined);
  // A genuinely empty listing is still an answer.
  assert.deepEqual(skillsFromCliPayload({ skills: [], warnings: [] }), { skills: [], diagnostics: [] });
});
