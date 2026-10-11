import "../tests/setup-dom.mjs";
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react/pure.js";
import userEvent from "@testing-library/user-event";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ExtensionDialog } = await jiti.import("./ExtensionDialog.tsx");

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const color = {
  id: "color",
  question: "Pick a color",
  header: "Color",
  options: [{ label: "Red" }, { label: "Green", description: "Calm" }, { label: "Blue" }],
  recommended: 1,
};
const size = { id: "size", question: "Pick a size", options: [{ label: "S" }, { label: "M" }] };
const extras = {
  id: "extras",
  question: "Extras?",
  multi: true,
  options: [{ label: "Cheese" }, { label: "Ham" }, { label: "Egg" }],
  recommended: 2,
};

const OTHER = "Other: type your own answer";

/** Renders the panel with a composer host, the way ChatWindow mounts it. */
function renderAsk(questions, { host = true } = {}) {
  const responses = [];
  const composerStates = [];
  const askComposerHost = host ? document.body.appendChild(document.createElement("div")) : undefined;
  render(React.createElement(ExtensionDialog, {
    request: { type: "extension_ui_request", id: "ask-1", method: "ask", questions },
    onRespond: (_request, response) => responses.push(response),
    attached: true,
    askComposerHost,
    onAskComposerChange: (active) => composerStates.push(active),
  }));
  return { responses, composerStates };
}

const group = (name) => screen.getByRole("group", { name });
const composer = () => screen.queryByRole("textbox", { name: /^Answering:/ });
const footerSubmit = () => screen.queryByRole("button", { name: "Submit" });

test("single-select renders radios with the recommended option marked and preselected; multi renders checkboxes", () => {
  renderAsk([color, extras]);
  const colorGroup = group(/Pick a color/);
  assert.equal(colorGroup.querySelectorAll('input[type="radio"]').length, 4, "three options and Other");
  assert.equal(colorGroup.querySelectorAll('input[type="checkbox"]').length, 0);
  assert.equal(screen.getByRole("radio", { name: /Green/ }).checked, true);
  assert.match(screen.getByRole("radio", { name: /Green/ }).closest("label").textContent, /Recommended/);
  assert.equal(screen.getByRole("radio", { name: /Red/ }).checked, false);

  const extrasGroup = group(/Extras\?/);
  assert.equal(extrasGroup.querySelectorAll('input[type="checkbox"]').length, 4, "three options and Other");
  assert.equal(extrasGroup.querySelectorAll('input[type="radio"]').length, 0);
  // Multi-select marks its recommendation but does not preselect it.
  assert.match(screen.getByRole("checkbox", { name: /Egg/ }).closest("label").textContent, /Recommended/);
  assert.equal(screen.getByRole("checkbox", { name: /Egg/ }).checked, false);
  assert.equal(document.querySelector('[role="dialog"] textarea'), null, "the panel has no text field");
});

test("without a composer host there is no Other option", () => {
  renderAsk([color], { host: false });
  assert.equal(within(group(/Pick a color/)).queryByRole("radio", { name: OTHER }), null);
});

test("choosing Other moves typing to the composer, which replaces the footer Submit with its Send", async () => {
  const user = userEvent.setup();
  const { responses, composerStates } = renderAsk([color]);
  await user.click(within(group(/Pick a color/)).getByRole("radio", { name: OTHER }));
  assert.equal(screen.getByRole("radio", { name: /Green/ }).checked, false, "Other replaces the recommended choice");
  assert.deepEqual(composerStates, [true]);
  assert.equal(footerSubmit(), null, "one send control, not two");
  assert.equal(document.activeElement, composer(), "the composer takes focus");

  const send = screen.getByRole("button", { name: "Send" });
  assert.equal(send.disabled, true, "a chosen Other needs text");
  await user.type(composer(), " Teal ");
  await user.click(send);
  assert.deepEqual(responses, [{ answers: [{ id: "color", selectedOptions: [], customInput: "Teal" }] }]);
});

test("Escape or the composer's cancel button drops the Other answer and restores the footer", async () => {
  const user = userEvent.setup();
  const { responses, composerStates } = renderAsk([color]);
  const other = within(group(/Pick a color/)).getByRole("radio", { name: OTHER });
  await user.click(other);
  await user.type(composer(), "Teal{Escape}");
  assert.equal(composer(), null);
  assert.equal(other.checked, false);
  assert.deepEqual(composerStates, [true, false]);
  assert.equal(footerSubmit().disabled, true, "nothing is chosen any more");

  await user.click(other);
  assert.equal(composer().value, "", "a cancelled answer does not come back");
  await user.click(screen.getByRole("button", { name: "Cancel answer" }));
  assert.equal(composer(), null);
  assert.deepEqual(responses, [], "cancelling the answer does not cancel the question");
});

test("Submit stays disabled until every single-select question is answered", async () => {
  const user = userEvent.setup();
  const { responses } = renderAsk([color, size, extras]);
  const submit = footerSubmit();
  assert.equal(submit.disabled, true, "size has no recommendation and no answer yet");
  await user.click(submit);
  assert.deepEqual(responses, []);

  await user.click(within(group(/Pick a size/)).getByRole("radio", { name: OTHER }));
  await user.type(composer(), "   ");
  assert.equal(screen.getByRole("button", { name: "Send" }).disabled, true, "blank Other is not an answer");
  await user.click(screen.getByRole("radio", { name: "M" }));
  assert.equal(composer(), null, "a regular choice ends the Other answer");
  assert.equal(footerSubmit().disabled, false, "empty multi-select does not block submit");
});

test("submit sends answers in question order: single choice, multi choices in option order, trimmed Other", async () => {
  const user = userEvent.setup();
  const { responses } = renderAsk([color, extras, size]);
  await user.click(screen.getByRole("checkbox", { name: /Egg/ }));
  await user.click(screen.getByRole("checkbox", { name: /Cheese/ }));
  await user.click(within(group(/Extras\?/)).getByRole("checkbox", { name: OTHER }));
  await user.type(composer(), "  pickles  ");
  await user.click(screen.getByRole("radio", { name: "S" }));
  assert.ok(composer(), "answering another question keeps the Other answer open");
  await user.click(screen.getByRole("button", { name: "Send" }));
  assert.deepEqual(responses, [{
    answers: [
      { id: "color", selectedOptions: ["Green"] },
      { id: "extras", selectedOptions: ["Cheese", "Egg"], customInput: "pickles" },
      { id: "size", selectedOptions: ["S"] },
    ],
  }]);
});

test("the composer edits one Other answer at a time and keeps the others", async () => {
  const user = userEvent.setup();
  const { responses } = renderAsk([color, extras]);
  const colorOther = within(group(/Pick a color/)).getByRole("radio", { name: OTHER });
  const extrasOther = within(group(/Extras\?/)).getByRole("checkbox", { name: OTHER });
  await user.click(colorOther);
  await user.type(composer(), "Teal");
  await user.click(extrasOther);
  assert.equal(composer().value, "", "the composer now edits the extras answer");
  assert.match(colorOther.closest("label").textContent, /Teal/, "the parked answer shows in its row");
  await user.type(composer(), "Pickles");

  await user.click(colorOther);
  assert.equal(composer().value, "Teal", "clicking a checked Other hands the composer back to it");
  assert.equal(extrasOther.checked, true);
  await user.click(extrasOther);
  assert.equal(composer().value, "Pickles");
  await user.click(extrasOther);
  assert.equal(extrasOther.checked, false, "clicking the multi-select Other being edited unchecks it");
  assert.equal(composer(), null);

  await user.click(footerSubmit());
  assert.deepEqual(responses, [{ answers: [{ id: "color", selectedOptions: [], customInput: "Teal" }, { id: "extras", selectedOptions: [] }] }]);
});

test("Cancel answers cancelled", async () => {
  const user = userEvent.setup();
  const { responses } = renderAsk([color]);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  assert.deepEqual(responses, [{ cancelled: true }]);
});
