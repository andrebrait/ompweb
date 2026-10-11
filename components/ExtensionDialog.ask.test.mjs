import "../tests/setup-dom.mjs";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach, describe } from "node:test";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react/pure.js";
import userEvent from "@testing-library/user-event";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ExtensionDialog } = await jiti.import("./ExtensionDialog.tsx");
const { MOBILE_QUERY } = await jiti.import("@/hooks/useIsMobile");

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

/** A phone-width viewport: the Other answer is typed in the composer. */
function phone() {
  const original = window.matchMedia;
  window.matchMedia = (query) => ({ matches: query === MOBILE_QUERY, addEventListener() {}, removeEventListener() {} });
  return () => {
    if (original) window.matchMedia = original;
    else delete window.matchMedia;
  };
}

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
const otherIn = (name) => within(group(name)).getByRole(/Extras/.test(String(name)) ? "checkbox" : "radio", { name: new RegExp(`^${OTHER}`) });
const composer = () => screen.queryByRole("textbox", { name: /^Answering:/ });
const footerSubmit = () => screen.queryByRole("button", { name: "Submit" });
const footerCancel = () => screen.queryByRole("button", { name: "Cancel" });

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
});

test("Cancel answers cancelled", async () => {
  const user = userEvent.setup();
  const { responses } = renderAsk([color]);
  await user.click(footerCancel());
  assert.deepEqual(responses, [{ cancelled: true }]);
});

// ---- desktop: one text field per question, in the panel ----------------------

test("desktop keeps a text field per question even with a composer host", async () => {
  const user = userEvent.setup();
  const { responses, composerStates } = renderAsk([color, extras]);
  assert.equal(document.querySelectorAll('[role="dialog"] textarea').length, 2);
  const colorField = group(/Pick a color/).querySelector("textarea");
  await user.type(colorField, " Teal ");
  assert.equal(otherIn(/Pick a color/).checked, true, "typing chooses Other");
  assert.equal(screen.getByRole("radio", { name: /Green/ }).checked, false, "and replaces the radio choice");
  assert.equal(composer(), null);
  assert.deepEqual(composerStates, []);
  await user.click(footerSubmit());
  assert.deepEqual(responses.pop(), { answers: [{ id: "color", selectedOptions: [], customInput: "Teal" }, { id: "extras", selectedOptions: [] }] });
});

test("desktop: picking an option keeps the typed text, and Other brings it back", async () => {
  const user = userEvent.setup();
  const { responses } = renderAsk([color]);
  const field = group(/Pick a color/).querySelector("textarea");
  await user.type(field, "Teal");
  await user.click(screen.getByRole("radio", { name: "Red" }));
  assert.equal(field.value, "Teal", "the text outlives the choice");
  await user.click(footerSubmit());
  assert.deepEqual(responses.pop(), { answers: [{ id: "color", selectedOptions: ["Red"] }] }, "an unchosen Other is not sent");

  await user.click(otherIn(/Pick a color/));
  assert.equal(document.activeElement, field, "choosing Other focuses its field");
  await user.click(footerSubmit());
  assert.deepEqual(responses.pop(), { answers: [{ id: "color", selectedOptions: [], customInput: "Teal" }] });
});

test("desktop: Submit stays disabled until every single-select question is answered", async () => {
  const user = userEvent.setup();
  const { responses } = renderAsk([color, size, extras]);
  assert.equal(footerSubmit().disabled, true, "size has no recommendation and no answer yet");
  await user.click(footerSubmit());
  assert.deepEqual(responses, []);
  await user.type(group(/Pick a size/).querySelector("textarea"), "   ");
  assert.equal(footerSubmit().disabled, true, "blank Other is not an answer");
  await user.click(screen.getByRole("radio", { name: "M" }));
  assert.equal(footerSubmit().disabled, false, "empty multi-select does not block submit");
});

test("desktop: answers go in question order, multi choices in option order, trimmed Other", async () => {
  const user = userEvent.setup();
  const { responses } = renderAsk([color, extras, size]);
  await user.click(screen.getByRole("checkbox", { name: /Egg/ }));
  await user.click(screen.getByRole("checkbox", { name: /Cheese/ }));
  await user.type(group(/Extras\?/).querySelector("textarea"), "  pickles  ");
  await user.click(screen.getByRole("radio", { name: "S" }));
  await user.click(footerSubmit());
  assert.deepEqual(responses, [{
    answers: [
      { id: "color", selectedOptions: ["Green"] },
      { id: "extras", selectedOptions: ["Cheese", "Egg"], customInput: "pickles" },
      { id: "size", selectedOptions: ["S"] },
    ],
  }]);
});

// ---- phone: the answer is typed in the composer ------------------------------

describe("on a phone", () => {
  let restore;
  beforeEach(() => { restore = phone(); });
  afterEach(() => restore());

  test("the panel has no text field; Other moves typing to the composer and hides the footer", async () => {
    const user = userEvent.setup();
    const { responses, composerStates } = renderAsk([color]);
    assert.equal(document.querySelector('[role="dialog"] textarea'), null);
    await user.click(otherIn(/Pick a color/));
    assert.equal(screen.getByRole("radio", { name: /Green/ }).checked, false, "Other replaces the recommended choice");
    assert.deepEqual(composerStates, [true]);
    assert.equal(footerSubmit(), null, "the composer's Send is the only send control");
    assert.equal(footerCancel(), null, "and its × the only cancel");
    assert.equal(document.activeElement, composer());

    const send = screen.getByRole("button", { name: "Send" });
    assert.equal(send.disabled, true, "a chosen Other needs text");
    await user.type(composer(), " Teal ");
    await user.click(send);
    assert.deepEqual(responses, [{ answers: [{ id: "color", selectedOptions: [], customInput: "Teal" }] }]);
  });

  test("the typed answer survives picking an option, Escape and × until the question ends", async () => {
    const user = userEvent.setup();
    const { responses, composerStates } = renderAsk([color]);
    const other = otherIn(/Pick a color/);
    await user.click(other);
    await user.type(composer(), "Teal");
    await user.click(screen.getByRole("radio", { name: "Red" }));
    assert.equal(composer(), null);
    assert.equal(other.checked, false);
    assert.match(other.closest("label").textContent, /Teal/, "the row keeps showing it");

    await user.click(other);
    assert.equal(composer().value, "Teal", "coming back finds it");
    await user.type(composer(), "{Escape}");
    assert.equal(other.checked, false);
    assert.equal(footerSubmit().disabled, true, "nothing is chosen any more");
    await user.click(other);
    assert.equal(composer().value, "Teal");
    await user.click(screen.getByRole("button", { name: "Cancel answer" }));
    assert.equal(composer(), null);
    assert.deepEqual(composerStates, [true, false, true, false, true, false]);
    assert.deepEqual(responses, [], "leaving the answer never answers or cancels the question");
  });

  test("with several questions the composer's Done returns to the panel instead of submitting", async () => {
    const user = userEvent.setup();
    const { responses } = renderAsk([color, extras]);
    await user.click(otherIn(/Extras\?/));
    assert.match(screen.getByText(/question 2 of 2/).textContent, /2 of 2/);
    assert.match(otherIn(/Extras\?/).closest("label").textContent, /Typing in the message box/);
    const done = screen.getByRole("button", { name: "Done" });
    assert.equal(done.disabled, true);
    await user.type(composer(), "Pickles");
    await user.click(done);
    assert.deepEqual(responses, [], "the preselected answers were not sent");
    assert.equal(composer(), null);
    assert.equal(otherIn(/Extras\?/).checked, true);
    assert.match(otherIn(/Extras\?/).closest("label").textContent, /Pickles/);

    await user.click(footerSubmit());
    assert.deepEqual(responses, [{ answers: [{ id: "color", selectedOptions: ["Green"] }, { id: "extras", selectedOptions: [], customInput: "Pickles" }] }]);
  });

  test("the composer edits one Other answer at a time and keeps the others", async () => {
    const user = userEvent.setup();
    renderAsk([color, extras]);
    const colorOther = otherIn(/Pick a color/);
    const extrasOther = otherIn(/Extras\?/);
    await user.click(colorOther);
    await user.type(composer(), "Teal");
    await user.click(extrasOther);
    assert.equal(composer().value, "", "the composer now edits the extras answer");
    assert.equal(colorOther.checked, true);
    assert.match(colorOther.closest("label").textContent, /Teal/);
    await user.type(composer(), "Pickles");
    await user.click(colorOther);
    assert.equal(composer().value, "Teal", "clicking a checked Other hands the composer back to it");
    await user.click(extrasOther);
    await user.click(extrasOther);
    assert.equal(extrasOther.checked, false, "clicking the multi-select Other being edited unchecks it");
    assert.equal(composer(), null);
  });

  test("leaving a blank Other for another question unchecks it instead of blocking Submit", async () => {
    const user = userEvent.setup();
    renderAsk([color, extras]);
    const colorOther = otherIn(/Pick a color/);
    await user.click(colorOther);
    const extrasOther = otherIn(/Extras\?/);
    await user.click(extrasOther);
    assert.equal(colorOther.checked, false, "leaving through another Other");
    await user.click(screen.getByRole("radio", { name: /Green/ }));
    assert.equal(extrasOther.checked, false, "leaving through a regular option");
    assert.equal(composer(), null);
    assert.equal(footerSubmit().disabled, false);
  });

  test("without a composer host the answer is typed in the panel", () => {
    renderAsk([color], { host: false });
    assert.ok(group(/Pick a color/).querySelector("textarea"));
  });
});
