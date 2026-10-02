import assert from "node:assert/strict";
import { createServer } from "node:http";
import test, { afterEach } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: {
    "@/": new URL("../", import.meta.url).pathname,
  },
});
const { POST } = await jiti.import("../app/api/stt/route.ts");
const { GET } = await jiti.import("../app/api/stt/[jobId]/route.ts");

const { DELETE } = await jiti.import("../app/api/stt/[jobId]/route.ts");
const ctx = (jobId) => ({ params: Promise.resolve({ jobId }) });
const pollJob = async (jobId) => (await GET(new Request("http://localhost"), ctx(jobId))).json();
const claimJob = async (jobId, token) =>
  (await DELETE(new Request(`http://localhost/api/stt/${jobId}?claim=${token}`, { method: "DELETE" }), ctx(jobId))).json();

/** Polls a job until it leaves "pending". */
async function settledJob(jobId) {
  for (let i = 0; i < 500; i++) {
    const job = await pollJob(jobId);
    if (job.status !== "pending") return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("job never finished");
}

/** Starts a job through POST, waits for it, and claims a finished transcript. */
async function transcribeViaJob(req) {
  const started = await POST(req);
  assert.equal(started.status, 202);
  const { jobId } = await started.json();
  const job = await settledJob(jobId);
  assert.equal(job.text, undefined, "polls must never carry the transcript");
  return job.status === "done" ? claimJob(jobId, "test-claim") : job;
}

// The job store is process-global; start every test from an empty one.
afterEach(() => globalThis.__ompSttJobs?.clear());

const { MAX_STT_AUDIO_BYTES } = await jiti.import("./stt.ts");

test("stt route returns 501 when OMP_WEB_STT_ENDPOINT is not configured", async () => {
  const originalEndpoint = process.env.OMP_WEB_STT_ENDPOINT;
  delete process.env.OMP_WEB_STT_ENDPOINT;

  try {
    const formData = new FormData();
    formData.append("file", new Blob(["fake-audio"], { type: "audio/webm" }), "audio.webm");

    const req = new Request("http://localhost/api/stt", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    assert.equal(res.status, 501);
    const body = await res.json();
    assert.match(body.error, /STT not configured/i);
  } finally {
    if (originalEndpoint !== undefined) process.env.OMP_WEB_STT_ENDPOINT = originalEndpoint;
  }
});

test("stt job forwards audio to configured endpoint and resolves to its text", async () => {
  const originalEnv = { ...process.env };
  let receivedAuth = "";

  const server = createServer((req, res) => {
    receivedAuth = req.headers.authorization || "";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text: "git status and commit" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  process.env.OMP_WEB_STT_ENDPOINT = `http://127.0.0.1:${port}/v1/audio/transcriptions`;
  process.env.OMP_WEB_STT_KEY = "test-secret-key";

  try {
    const formData = new FormData();
    formData.append("file", new Blob(["test-audio-bytes"], { type: "audio/webm" }), "audio.webm");

    const req = new Request("http://localhost/api/stt", {
      method: "POST",
      body: formData,
    });

    const job = await transcribeViaJob(req);
    assert.equal(job.status, "done");
    assert.equal(job.text, "git status and commit");
    assert.equal(receivedAuth, "Bearer test-secret-key");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env = originalEnv;
  }
});

test("stt job normalizes upstream { error: { message } } to { error: string }", async () => {
  const originalEnv = { ...process.env };

  const server = createServer((req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  process.env.OMP_WEB_STT_ENDPOINT = `http://127.0.0.1:${port}/v1/audio/transcriptions`;
  process.env.OMP_WEB_STT_KEY = "bad-key";

  try {
    const formData = new FormData();
    formData.append("file", new Blob(["test-audio-bytes"], { type: "audio/webm" }), "audio.webm");

    const req = new Request("http://localhost/api/stt", {
      method: "POST",
      body: formData,
    });

    const job = await transcribeViaJob(req);
    assert.equal(job.status, "error");
    assert.equal(job.error, "Invalid API key");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env = originalEnv;
  }
});

test("stt route strips newlines and carriage returns from env vars", async () => {
  const originalEnv = { ...process.env };
  let receivedAuth = "";

  const server = createServer((req, res) => {
    receivedAuth = req.headers.authorization ?? "";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ text: "sanitized test" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  process.env.OMP_WEB_STT_ENDPOINT = `  http://127.0.0.1:${port}/v1/audio/transcriptions\n\n  `;
  process.env.OMP_WEB_STT_KEY = "  secret-key-123\r\n\\n  ";

  try {
    const formData = new FormData();
    formData.append("file", new Blob(["test-audio-bytes"], { type: "audio/webm" }), "audio.webm");

    const req = new Request("http://localhost/api/stt", {
      method: "POST",
      body: formData,
    });

    const job = await transcribeViaJob(req);
    assert.equal(receivedAuth, "Bearer secret-key-123");
    assert.equal(job.text, "sanitized test");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env = originalEnv;
  }
});

test("stt route rejects request with missing or empty audio file with 400", async () => {
  const originalEndpoint = process.env.OMP_WEB_STT_ENDPOINT;
  process.env.OMP_WEB_STT_ENDPOINT = "http://127.0.0.1:9999/v1/audio/transcriptions";

  try {
    // Missing file
    const emptyForm = new FormData();
    const reqMissing = new Request("http://localhost/api/stt", {
      method: "POST",
      body: emptyForm,
    });
    const resMissing = await POST(reqMissing);
    assert.equal(resMissing.status, 400);
    const bodyMissing = await resMissing.json();
    assert.equal(bodyMissing.code, "missing_audio_file");

    // Empty file
    const zeroForm = new FormData();
    zeroForm.append("file", new Blob([], { type: "audio/webm" }), "empty.webm");
    const reqZero = new Request("http://localhost/api/stt", {
      method: "POST",
      body: zeroForm,
    });
    const resZero = await POST(reqZero);
    assert.equal(resZero.status, 400);
    const bodyZero = await resZero.json();
    assert.equal(bodyZero.code, "missing_audio_file");
  } finally {
    if (originalEndpoint !== undefined) process.env.OMP_WEB_STT_ENDPOINT = originalEndpoint;
    else delete process.env.OMP_WEB_STT_ENDPOINT;
  }
});

test("stt route rejects oversized audio with 413", async () => {
  const originalEndpoint = process.env.OMP_WEB_STT_ENDPOINT;
  process.env.OMP_WEB_STT_ENDPOINT = "http://127.0.0.1:9999/v1/audio/transcriptions";

  try {
    // 1. Declared Content-Length exceeds maxBytes
    const reqDeclared = new Request("http://localhost/api/stt", {
      method: "POST",
      headers: {
        "content-length": String(MAX_STT_AUDIO_BYTES + 1024 * 1024 + 1),
        "content-type": "multipart/form-data; boundary=---boundary",
      },
      body: "---boundary--\r\n",
    });
    const resDeclared = await POST(reqDeclared);
    assert.equal(resDeclared.status, 413);
    const bodyDeclared = await resDeclared.json();
    assert.equal(bodyDeclared.code, "audio_too_large");

    // 2. Streamed chunks exceed maxBytes
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_STT_AUDIO_BYTES + 1024 * 1024 + 100));
        controller.close();
      },
    });
    const reqStream = new Request("http://localhost/api/stt", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=---boundary",
      },
      body: stream,
      duplex: "half",
    });
    const resStream = await POST(reqStream);
    assert.equal(resStream.status, 413);
    const bodyStream = await resStream.json();
    assert.equal(bodyStream.code, "audio_too_large");
  } finally {
    if (originalEndpoint !== undefined) process.env.OMP_WEB_STT_ENDPOINT = originalEndpoint;
    else delete process.env.OMP_WEB_STT_ENDPOINT;
  }
});

test("stt job outlives a slow upstream and unknown job ids are 404", async () => {
  const originalEnv = { ...process.env };
  let release;
  const server = createServer((req, res) => {
    release = () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: "late words" }));
    };
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.OMP_WEB_STT_ENDPOINT = `http://127.0.0.1:${server.address().port}/v1/audio/transcriptions`;

  try {
    const formData = new FormData();
    formData.append("file", new Blob(["test-audio-bytes"], { type: "audio/webm" }), "audio.webm");
    const started = await POST(new Request("http://localhost/api/stt", { method: "POST", body: formData }));
    assert.equal(started.status, 202, "POST must answer before the upstream does");
    const { jobId } = await started.json();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await pollJob(jobId)).status, "pending");
    release();
    assert.equal((await settledJob(jobId)).status, "done");
    assert.equal((await claimJob(jobId, "a")).text, "late words");

    const missing = await GET(new Request("http://localhost"), { params: Promise.resolve({ jobId: "nope" }) });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, "stt_job_not_found");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env = originalEnv;
  }
});

test("stt POST refuses new jobs with 429 while four are already pending", async () => {
  const originalEnv = { ...process.env };
  let received = 0;
  const server = createServer(() => { received++; });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.OMP_WEB_STT_ENDPOINT = `http://127.0.0.1:${server.address().port}/v1/audio/transcriptions`;
  const post = () => {
    const formData = new FormData();
    formData.append("file", new Blob(["test-audio-bytes"], { type: "audio/webm" }), "audio.webm");
    return POST(new Request("http://localhost/api/stt", { method: "POST", body: formData }));
  };

  try {
    for (let i = 0; i < 4; i++) assert.equal((await post()).status, 202);
    const refused = await post();
    assert.equal(refused.status, 429);
    assert.equal((await refused.json()).code, "stt_busy");
  } finally {
    // Fail the hanging upstream requests so the pending jobs settle.
    while (received < 4) await new Promise((resolve) => setTimeout(resolve, 10));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    process.env = originalEnv;
  }
});

test("a scoped job keeps its audio for any browser: list, play, retry, claim once", async () => {
  const originalEnv = { ...process.env };
  const { GET: LIST } = await jiti.import("../app/api/stt/route.ts");
  const { POST: RETRY } = await jiti.import("../app/api/stt/[jobId]/route.ts");
  const { GET: AUDIO } = await jiti.import("../app/api/stt/[jobId]/audio/route.ts");
  const uploads = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      uploads.push(Buffer.concat(chunks).toString("latin1"));
      // First attempt fails upstream; the retry succeeds.
      if (uploads.length === 1) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "model loading" }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text: "kept words" }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.OMP_WEB_STT_ENDPOINT = `http://127.0.0.1:${server.address().port}/v1/audio/transcriptions`;

  try {
    const formData = new FormData();
    formData.append("file", new Blob(["unique-audio-bytes"], { type: "text/html" }), "audio.webm");
    formData.append("scope", "session-123");
    const { jobId } = await (await POST(new Request("http://localhost/api/stt", { method: "POST", body: formData }))).json();

    assert.equal((await settledJob(jobId)).error, "model loading");
    // Another browser on the same session finds the failed job and its audio.
    const listed = await (await LIST(new Request("http://localhost/api/stt?scope=session-123"))).json();
    assert.deepEqual(listed.jobs.map((job) => [job.id, job.status]), [[jobId, "error"]]);
    assert.deepEqual((await (await LIST(new Request("http://localhost/api/stt?scope=other"))).json()).jobs, []);
    const audio = await AUDIO(new Request("http://localhost"), ctx(jobId));
    assert.equal(await audio.text(), "unique-audio-bytes");
    assert.equal(audio.headers.get("content-type"), "application/octet-stream", "uploaded non-audio type must not be served");

    // Retry re-sends the audio the server kept.
    assert.equal((await RETRY(new Request("http://localhost", { method: "POST" }), ctx(jobId))).status, 200);
    assert.equal((await settledJob(jobId)).status, "done");
    assert.match(uploads[1], /unique-audio-bytes/);

    const claim = (token) => claimJob(jobId, token);
    assert.equal((await claim("browser-a")).text, "kept words");
    assert.equal((await claim("browser-b")).status, "gone", "a second browser must not get the transcript");
    assert.equal((await claim("browser-a")).text, "kept words", "the claimer may repeat a lost claim");
    const after = await (await GET(new Request("http://localhost"), ctx(jobId))).json();
    assert.equal(after.status, "gone");
    assert.equal(after.text, undefined);
    assert.equal((await AUDIO(new Request("http://localhost"), ctx(jobId))).status, 404);
    assert.deepEqual((await (await LIST(new Request("http://localhost/api/stt?scope=session-123"))).json()).jobs, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env = originalEnv;
  }
});

test("discarding a pending job aborts its upstream request and keeps it gone", async () => {
  const originalEnv = { ...process.env };
  let upstreamClosed = false;
  let release;
  const server = createServer((req, res) => {
    res.on("close", () => { upstreamClosed = !res.writableEnded; });
    release = () => res.end(JSON.stringify({ text: "too late" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.OMP_WEB_STT_ENDPOINT = `http://127.0.0.1:${server.address().port}/v1/audio/transcriptions`;

  try {
    const formData = new FormData();
    formData.append("file", new Blob(["audio"], { type: "audio/webm" }), "audio.webm");
    const { jobId } = await (await POST(new Request("http://localhost/api/stt", { method: "POST", body: formData }))).json();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 10));

    // A claim token on an unfinished job must not end it.
    assert.equal((await claimJob(jobId, "early")).status, "pending");
    assert.equal((await pollJob(jobId)).status, "pending");

    const discarded = await (await DELETE(new Request(`http://localhost/api/stt/${jobId}`, { method: "DELETE" }), ctx(jobId))).json();
    assert.equal(discarded.status, "pending");
    for (let i = 0; i < 100 && !upstreamClosed; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(upstreamClosed, "discard must abort the upstream request");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await pollJob(jobId)).status, "gone", "a late upstream answer must not revive a discarded job");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    process.env = originalEnv;
  }
});

test("an empty transcript settles as a retryable error that keeps the audio", async () => {
  const originalEnv = { ...process.env };
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end(JSON.stringify({ text: "  " })));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.OMP_WEB_STT_ENDPOINT = `http://127.0.0.1:${server.address().port}/v1/audio/transcriptions`;
  const { GET: AUDIO } = await jiti.import("../app/api/stt/[jobId]/audio/route.ts");

  try {
    const formData = new FormData();
    formData.append("file", new Blob(["silence"], { type: "audio/webm" }), "audio.webm");
    const { jobId } = await (await POST(new Request("http://localhost/api/stt", { method: "POST", body: formData }))).json();
    const job = await settledJob(jobId);
    assert.equal(job.status, "error");
    assert.equal(job.error, "No speech detected");
    assert.equal(await (await AUDIO(new Request("http://localhost"), ctx(jobId))).text(), "silence");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env = originalEnv;
  }
});

test("the recording browser has first claim on its transcript", async () => {
  const originalEnv = { ...process.env };
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end(JSON.stringify({ text: "mine" })));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.OMP_WEB_STT_ENDPOINT = `http://127.0.0.1:${server.address().port}/v1/audio/transcriptions`;

  try {
    const formData = new FormData();
    formData.append("file", new Blob(["audio"], { type: "audio/webm" }), "audio.webm");
    formData.append("owner", "recorder");
    const { jobId } = await (await POST(new Request("http://localhost/api/stt", { method: "POST", body: formData }))).json();
    assert.equal((await settledJob(jobId)).status, "done");

    const early = await claimJob(jobId, "other-browser");
    assert.equal(early.status, "done");
    assert.equal(early.text, undefined, "another browser must wait while the recorder can still claim");
    assert.equal((await claimJob(jobId, "recorder")).text, "mine");
    assert.equal((await claimJob(jobId, "other-browser")).status, "gone");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env = originalEnv;
  }
});
