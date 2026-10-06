import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { createNotificationDetector, parseNotificationPrefs, renderNotification } = await jiti.import("./notification-events.ts");

const session = { sessionId: "s1", sessionName: "Refactor auth" };

function run(frames) {
  const detect = createNotificationDetector();
  return frames.map((frame) => detect(frame, session)).filter(Boolean);
}

test("completion fires when the session settles, not per prompt or per subagent", () => {
  const events = run([
    { type: "agent_start" },
    { type: "subagent_lifecycle", payload: { id: "a", status: "completed" } },
    { type: "subagent_event", payload: { id: "a", event: { type: "agent_end", isTerminal: true } } },
    { type: "agent_end", isTerminal: false },
    { type: "prompt_result", agentInvoked: true, status: "completed", sessionSettled: false },
    { type: "session_settled" },
  ]);
  assert.deepEqual(events, [{ sessionId: "s1", sessionName: "Refactor auth", type: "completed" }]);
});

test("local slash commands and aborted runs do not notify", () => {
  assert.deepEqual(run([{ type: "prompt_result", agentInvoked: false, status: "completed" }]), []);
  assert.deepEqual(run([{ type: "prompt_result", agentInvoked: true, status: "aborted" }, { type: "session_settled" }]), []);
});

test("a failed run notifies once as an error, not again as completed", () => {
  const events = run([
    { type: "prompt_result", agentInvoked: true, status: "error", error: { message: "Retry budget exhausted", retryable: true } },
    { type: "session_settled" },
  ]);
  assert.deepEqual(events.map((event) => [event.type, event.detail]), [["error", "Retry budget exhausted"]]);
});

test("the next stretch after a failure can complete normally", () => {
  const events = run([
    { type: "prompt_result", agentInvoked: true, status: "error", error: { message: "boom" } },
    { type: "session_settled" },
    { type: "prompt_result", agentInvoked: true, status: "completed" },
    { type: "session_settled" },
  ]);
  assert.deepEqual(events.map((event) => event.type), ["error", "completed"]);
});

test("blocking dialogs notify with their question; non-blocking UI frames do not", () => {
  const events = run([
    { type: "extension_ui_request", id: "1", method: "select", title: "Which database?", options: ["a"] },
    { type: "extension_ui_request", id: "2", method: "ask", questions: [{ id: "q", question: "Ship it?", options: [] }] },
    { type: "extension_ui_request", id: "3", method: "notify", message: "fyi" },
    { type: "extension_ui_request", id: "4", method: "setStatus", statusKey: "k" },
  ]);
  assert.deepEqual(events.map((event) => [event.type, event.detail]), [["input", "Which database?"], ["input", "Ship it?"]]);
});

test("model switch reason: explicit reason, else the preceding retry error, else none", () => {
  const events = run([
    { type: "retry_fallback_applied", from: "anthropic/fable", to: "anthropic/opus", role: "default", reason: "usage reserve reached" },
    { type: "auto_retry_start", attempt: 1, errorMessage: "Request refused by the safety classifier" },
    { type: "retry_fallback_applied", from: "anthropic/fable", to: "anthropic/opus", role: "default" },
    { type: "session_settled" },
    { type: "retry_fallback_applied", from: "anthropic/fable", to: "anthropic/opus", role: "default" },
    { type: "notice", level: "info", source: "prewalk", message: "Prewalk: switched to openai/gpt-5 after first edit call." },
    { type: "notice", level: "error", source: "session-persistence", message: "disk full" },
  ]).filter((event) => event.type === "modelSwitch");
  assert.deepEqual(events.map((event) => event.detail), [
    "usage reserve reached",
    "Request refused by the safety classifier",
    undefined,
    "Prewalk: switched to openai/gpt-5 after first edit call.",
  ]);
});

test("untrusted prefs fall back to defaults field by field", () => {
  assert.deepEqual(parseNotificationPrefs({ enabled: true, types: { input: false, bogus: true }, whenActive: "loud", locale: "<script>" }), {
    enabled: true,
    types: { completed: true, input: false, error: true, modelSwitch: false },
    whenActive: "toast",
    locale: "en",
  });
});

test("rendered notifications open their session and clip long details", () => {
  const t = (key, vars) => `${key}${vars ? JSON.stringify(vars) : ""}`;
  const rendered = renderNotification({ type: "error", sessionId: "a b", sessionName: null, detail: "x".repeat(500) }, t);
  assert.equal(rendered.url, "/?session=a%20b");
  assert.equal(rendered.title, "notifications.untitledSession");
  assert.equal(rendered.tag, "a b:error");
  assert.ok(rendered.body.length < 260, rendered.body);
});
