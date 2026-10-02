import "../tests/setup-dom.mjs";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { act, cleanup, renderHook } from "@testing-library/react/pure.js";

// These tests execute the dictation state machine against fake
// getUserMedia/MediaRecorder/AudioContext implementations. They assert the
// observable hook state a consumer renders from (isRecording/isPaused/
// isReviewing, live analyser, active-time accounting, blob-URL lifetime) —
// the states the composer and RecordingDeck actually read.

const jiti = createJiti(import.meta.url, {
  tryNative: false,
  alias: { "@/": fileURLToPath(new URL("../", import.meta.url)) },
});
const { useDictation } = await jiti.import("../hooks/useDictation.ts");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle(ms = 20) {
  await act(async () => {
    await sleep(ms);
  });
}

let world;

class FakeTrack {
  constructor() {
    this.stopped = false;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeMediaRecorder {
  constructor(stream) {
    this.stream = stream;
    this.state = "inactive";
    this.mimeType = "audio/webm";
    this.timeslice = null;
    this.ondataavailable = null;
    this.onstop = null;
    world.recorders.push(this);
  }
  start(timeslice) {
    this.state = "recording";
    this.timeslice = timeslice ?? null;
  }
  requestData() {
    this.ondataavailable?.({ data: new Blob(["chunk"], { type: this.mimeType }) });
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["chunk"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

class FakeAudioContext {
  constructor() {
    this.state = "running";
    this.closed = false;
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  createAnalyser() {
    return {
      fftSize: 2048,
      frequencyBinCount: 128,
      getByteFrequencyData: () => {},
      connect: () => {},
    };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

class FakePreviewAudio {
  constructor(src) {
    this.src = src;
    world.audioUrls.push(src);
    this.currentTime = 0;
    this.duration = 1;
    this.ended = false;
    this.paused = true;
  }
  play() {
    this.paused = false;
    this.onplay?.();
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.onpause?.();
  }
}

const overrides = [];
function override(target, key, replacement) {
  overrides.push({ target, key, original: Object.getOwnPropertyDescriptor(target, key) });
  Object.defineProperty(target, key, { configurable: true, writable: true, value: replacement });
}

beforeEach(() => {
  world = { recorders: [], createdUrls: [], revokedUrls: [], tracks: [] };
  const track = new FakeTrack();
  world.tracks.push(track);
  override(navigator, "mediaDevices", {
    getUserMedia: async () => ({ getTracks: () => [track] }),
  });
  override(window, "MediaRecorder", FakeMediaRecorder);
  override(globalThis, "MediaRecorder", FakeMediaRecorder);
  override(window, "AudioContext", FakeAudioContext);
  override(globalThis, "AudioContext", FakeAudioContext);
  override(window, "Audio", FakePreviewAudio);
  override(globalThis, "Audio", FakePreviewAudio);
  override(URL, "createObjectURL", (blob) => {
    const url = `blob:fake/${world.createdUrls.length}`;
    world.createdUrls.push({ url, blob });
    return url;
  });
  override(URL, "revokeObjectURL", (url) => {
    world.revokedUrls.push(url);
  });
  // Fake job API. POST /api/stt starts job-1; each GET poll answers with the
  // next scripted response (the last one repeating); a claiming DELETE takes
  // the last polled body; POST /api/stt/job-1 is a server-side retry.
  world.pollResponses = [{ ok: true, status: 200, json: async () => ({ status: "done", text: "transcribed words" }) }];
  world.polls = 0;
  world.lastPoll = null;
  world.postedFiles = [];
  world.deletes = [];
  world.retries = 0;
  world.retryResponse = { ok: true, status: 200, json: async () => ({ status: "pending" }) };
  world.scopeJobs = [];
  world.audioUrls = [];
  override(globalThis, "fetch", async (url, init) => {
    if (url.startsWith("/api/stt?scope=")) return { ok: true, status: 200, json: async () => ({ jobs: world.scopeJobs }) };
    if (init?.method === "POST" && url === "/api/stt") {
      world.postedFiles.push(init.body.get("file"));
      return { ok: true, status: 202, json: async () => ({ jobId: "job-1" }) };
    }
    if (init?.method === "POST") {
      world.retries++;
      return world.retryResponse;
    }
    if (init?.method === "DELETE") {
      world.deletes.push(url);
      const claimed = url.includes("?claim=") ? await world.lastPoll?.json() : null;
      return { ok: true, status: 200, json: async () => claimed ?? { status: "gone" } };
    }
    assert.equal(url, "/api/stt/job-1");
    world.lastPoll = world.pollResponses[Math.min(world.polls++, world.pollResponses.length - 1)];
    return world.lastPoll;
  });
});

afterEach(() => {
  try {
    cleanup();
  } finally {
    while (overrides.length) {
      const { target, key, original } = overrides.pop();
      if (original) Object.defineProperty(target, key, original);
      else delete target[key];
    }
  }
});

function mountDictation(scope) {
  const transcripts = [];
  const errors = [];
  const view = renderHook(() =>
    useDictation({
      scope,
      onTranscript: (text) => transcripts.push(text),
      onError: (message) => errors.push(message),
    }),
  );
  return { view, transcripts, errors };
}

test("starting capture puts the hook in the recording state with a live analyser", async () => {
  const { view, errors } = mountDictation();

  await act(async () => {
    view.result.current.toggle();
  });
  await settle();

  assert.equal(errors.length, 0, `unexpected dictation errors: ${errors.join(" | ")}`);
  assert.equal(view.result.current.isRecording, true, "consumer must see isRecording after start");
  assert.equal(view.result.current.isPaused, false);
  assert.equal(view.result.current.isReviewing, false);
  assert.equal(world.recorders.length, 1);
  assert.equal(world.recorders[0].state, "recording");
  assert.equal(world.recorders[0].timeslice, 100, "timeslice keeps chunks flowing for preview");
  assert.notEqual(view.result.current.captureRef.current.analyser, null, "waveform needs a live analyser");
  assert.ok(view.result.current.captureRef.current.startedAt > 0, "timer needs a start stamp");
});

test("pause then resume keeps the timer base and analyser while accumulating paused time", async () => {
  const { view } = mountDictation();

  await act(async () => {
    view.result.current.toggle();
  });
  await settle();

  const { startedAt, analyser } = view.result.current.captureRef.current;

  await act(async () => {
    view.result.current.togglePause();
  });
  await settle(40);

  assert.equal(view.result.current.isPaused, true);
  assert.ok(view.result.current.captureRef.current.pausedAt !== null);

  await act(async () => {
    view.result.current.togglePause();
  });
  await settle();

  const capture = view.result.current.captureRef.current;
  assert.equal(view.result.current.isPaused, false);
  assert.equal(capture.startedAt, startedAt, "resume must not reset the elapsed base");
  assert.equal(capture.analyser, analyser, "resume must not drop the live analyser");
  assert.equal(capture.pausedAt, null);
  assert.ok(capture.pausedAccum > 0, "paused time must be subtracted from active elapsed time");
  assert.equal(world.recorders[0].state, "recording");
});

test("stopping capture enters review with a playable preview, and confirming releases it", async () => {
  const { view, transcripts } = mountDictation();

  await act(async () => {
    view.result.current.toggle();
  });
  await settle();

  await act(async () => {
    view.result.current.stop();
  });
  await settle();

  assert.equal(view.result.current.isReviewing, true);
  assert.equal(view.result.current.isRecording, false);
  assert.equal(world.createdUrls.length, 1, "review mode needs a preview blob URL");
  assert.ok(world.tracks[0].stopped, "microphone tracks must be released on stop");

  await act(async () => {
    view.result.current.playPreview();
  });
  await settle();
  assert.equal(view.result.current.isPlayingPreview, true);

  await act(async () => {
    view.result.current.confirmTranscribe();
  });
  await settle(700);

  assert.deepEqual(world.revokedUrls, [world.createdUrls[0].url], "confirming must revoke the preview URL");
  assert.equal(view.result.current.isReviewing, false);
  assert.deepEqual(transcripts, ["transcribed words"]);
});

test("transcription keeps polling through pending and proxy error pages until the job is done", async () => {
  const { view, transcripts, errors } = mountDictation();
  world.pollResponses = [
    { ok: true, status: 200, json: async () => ({ status: "pending" }) },
    { ok: false, status: 504, json: async () => JSON.parse("<!DOCTYPE html>") },
    { ok: true, status: 200, json: async () => ({ status: "done", text: "slow words" }) },
  ];

  await act(async () => {
    view.result.current.toggle();
  });
  await settle();
  await act(async () => {
    view.result.current.stop();
  });
  await settle();
  await act(async () => {
    view.result.current.confirmTranscribe();
  });
  await settle(1800);

  assert.deepEqual(errors, []);
  assert.deepEqual(transcripts, ["slow words"]);
  assert.equal(world.polls, 3);
  assert.equal(view.result.current.isTranscribing, false);
});

async function recordAndTranscribe(view) {
  await act(async () => {
    view.result.current.toggle();
  });
  await settle();
  await act(async () => {
    view.result.current.stop();
  });
  await settle();
  await act(async () => {
    view.result.current.confirmTranscribe();
  });
  await settle(700);
}

test("retry reruns a failed job on the server with the audio it kept", async () => {
  const { view, transcripts, errors } = mountDictation();
  world.pollResponses = [{ ok: true, status: 200, json: async () => ({ status: "error", error: "Transcription timed out" }) }];

  await recordAndTranscribe(view);

  assert.deepEqual(transcripts, []);
  assert.deepEqual(errors, ["Transcription timed out"]);
  assert.equal(view.result.current.transcribeError, "Transcription timed out");

  world.pollResponses = [{ ok: true, status: 200, json: async () => ({ status: "done", text: "second try" }) }];
  await act(async () => {
    view.result.current.retry();
  });
  await settle(700);

  assert.equal(world.retries, 1);
  assert.equal(world.postedFiles.length, 1, "the server's copy is retried, not a re-upload");
  assert.deepEqual(transcripts, ["second try"]);
});

test("retry re-uploads the local recording when the server lost the job", async () => {
  const { view, transcripts } = mountDictation();
  world.pollResponses = [{ ok: true, status: 200, json: async () => ({ status: "error", error: "boom" }) }];
  await recordAndTranscribe(view);

  world.retryResponse = { ok: false, status: 404, json: async () => ({ error: "Transcription job not found" }) };
  world.pollResponses = [{ ok: true, status: 200, json: async () => ({ status: "done", text: "re-uploaded" }) }];
  await act(async () => {
    view.result.current.retry();
  });
  await settle(700);

  assert.equal(world.postedFiles.length, 2);
  assert.equal(await world.postedFiles[1].text(), await world.postedFiles[0].text());
  assert.deepEqual(transcripts, ["re-uploaded"]);
});

test("another browser's job for the same scope shows up with server audio, and a claim lost to it stands down", async () => {
  world.scopeJobs = [{ id: "job-1", status: "error", error: "model loading" }];
  const { view, transcripts, errors } = mountDictation("session-1");
  await settle(50);

  assert.equal(view.result.current.transcribeError, "model loading");
  await act(async () => {
    view.result.current.playPreview();
  });
  assert.deepEqual(world.audioUrls, ["/api/stt/job-1/audio"]);

  // Retry here; meanwhile the recording browser claims the transcript first.
  world.pollResponses = [{ ok: true, status: 200, json: async () => ({ status: "gone" }) }];
  await act(async () => {
    view.result.current.retry();
  });
  await settle(700);

  assert.equal(world.retries, 1);
  assert.deepEqual(transcripts, []);
  assert.deepEqual(errors, [], "losing the claim to another browser is not an error");
  assert.equal(view.result.current.transcribeError, null);
  assert.equal(view.result.current.isTranscribing, false);
});

test("a finished job is claimed, and only the claimed text is inserted", async () => {
  world.scopeJobs = [{ id: "job-1", status: "pending" }];
  world.pollResponses = [{ ok: true, status: 200, json: async () => ({ status: "done", text: "from the phone" }) }];
  const { view, transcripts } = mountDictation("session-1");
  await settle(700);

  assert.deepEqual(transcripts, ["from the phone"]);
  assert.equal(world.deletes.length, 1);
  assert.match(world.deletes[0], /^\/api\/stt\/job-1\?claim=/);
  assert.equal(view.result.current.isTranscribing, false);
});

test("a permanent 4xx poll fails at once instead of polling until the deadline", async () => {
  const { view, transcripts, errors } = mountDictation();
  world.pollResponses = [{ ok: false, status: 401, json: async () => ({ error: "Password required" }) }];

  await recordAndTranscribe(view);

  assert.deepEqual(transcripts, []);
  assert.deepEqual(errors, ["Password required"]);
  assert.equal(world.polls, 1);
  assert.equal(view.result.current.isTranscribing, false);
});

test("cancelling mid-transcription stops polling and drops a late result", async () => {
  const { view, transcripts, errors } = mountDictation();
  world.pollResponses = [
    { ok: true, status: 200, json: async () => ({ status: "pending" }) },
    { ok: true, status: 200, json: async () => ({ status: "done", text: "too late" }) },
  ];

  await recordAndTranscribe(view);
  assert.equal(world.polls, 1);
  assert.equal(view.result.current.isTranscribing, true);

  await act(async () => {
    view.result.current.cancel();
  });
  await settle(1200);

  assert.equal(world.polls, 1, "no poll may run after cancel");
  assert.deepEqual(world.deletes, ["/api/stt/job-1"], "discard must end the job for other browsers too");
  assert.deepEqual(transcripts, []);
  assert.deepEqual(errors, []);
  assert.equal(view.result.current.isTranscribing, false);
});

test("cancelling during capture clears state and releases the microphone", async () => {
  const { view, transcripts } = mountDictation();

  await act(async () => {
    view.result.current.toggle();
  });
  await settle();

  await act(async () => {
    view.result.current.cancel();
  });
  await settle();

  assert.equal(view.result.current.isRecording, false);
  assert.equal(view.result.current.isPaused, false);
  assert.equal(view.result.current.isReviewing, false);
  assert.equal(view.result.current.isTranscribing, false);
  assert.equal(view.result.current.captureRef.current.analyser, null);
  assert.ok(world.tracks[0].stopped);
  assert.deepEqual(transcripts, []);
});
