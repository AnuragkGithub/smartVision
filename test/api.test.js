import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const serverPath = fileURLToPath(new URL("../server/index.js", import.meta.url));

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function makeImage(color, changed = false) {
  const width = 96;
  const height = 96;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const isChanged = changed && x >= 30 && x < 66 && y >= 30 && y < 66;
      pixels[offset] = isChanged ? 245 : color[0];
      pixels[offset + 1] = isChanged ? 20 : color[1];
      pixels[offset + 2] = isChanged ? 20 : color[2];
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function waitForServer(child, baseUrl) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Test server exited during startup.");
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error("Test server did not start.");
}

test("analysis, shortlist, human sign-off, and CSV export work end to end", async (context) => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "smartvision-api-test-"));
  await writeFile(
    path.join(dataDirectory, "inspections.csv"),
    [
      "inspection_id,timestamp,batch_id,product,operator,decision,anomaly_score,threshold,review_threshold,flagged_regions,coverage_pct,notes,image_name",
      'LEGACY01,2026-01-01T10:00:00Z,LOT-OLD,Old bracket,Legacy operator,NO FLAGS DETECTED,0,22,30,0,0,"Imported, legacy record",old.png',
      "",
    ].join("\n"),
  );
  const port = await unusedPort();
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDirectory },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let serverErrors = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { serverErrors += chunk; });
  context.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
    await rm(dataDirectory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(child, baseUrl);
  } catch (error) {
    throw new Error(`${error.message}${serverErrors ? `: ${serverErrors}` : ""}`);
  }
  const migratedRecords = await (await fetch(`${baseUrl}/api/records`)).json();
  assert.equal(migratedRecords.records.length, 1);
  assert.equal(migratedRecords.records[0].notes, "Imported, legacy record");

  const reference = await makeImage([120, 120, 120]);
  const candidate = await makeImage([120, 120, 120], true);
  const form = new FormData();
  form.append("reference", new Blob([reference], { type: "image/png" }), "reference.png");
  form.append("candidate", new Blob([candidate], { type: "image/png" }), "part.png");
  form.append("batchId", "LOT-TEST-01");
  form.append("partId", "BRACKET-A12");
  form.append("product", "Metal component");
  form.append("operator", "Test operator");
  form.append("threshold", "22");
  form.append("minArea", "20");
  form.append("reviewThreshold", "30");

  const analysisResponse = await fetch(`${baseUrl}/api/analyze`, { method: "POST", body: form });
  const analysisPayload = await analysisResponse.json();
  assert.equal(analysisResponse.status, 200, analysisPayload.error);
  const { result } = analysisPayload;
  assert.equal(result.decision, "REVIEW REQUIRED");
  assert.ok(result.shortlistId);
  assert.ok((await fetch(new URL(result.overlayUrl, baseUrl))).ok);

  const shortlistResponse = await fetch(`${baseUrl}/api/shortlist`);
  const shortlist = await shortlistResponse.json();
  assert.equal(shortlist.items.length, 1);
  assert.equal(shortlist.items[0].status, "NEEDS REVIEW");

  const rejectedSave = await fetch(`${baseUrl}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analysisId: result.id, approvedBy: " " }),
  });
  assert.equal(rejectedSave.status, 400);

  const saveResponse = await fetch(`${baseUrl}/api/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analysisId: result.id, approvedBy: "Quality Supervisor" }),
  });
  assert.equal(saveResponse.status, 201);
  const { record } = await saveResponse.json();
  assert.equal(record.batch_id, "LOT-TEST-01");
  assert.equal(record.product, "BRACKET-A12");
  assert.equal(record.decision, "REVIEW REQUIRED");

  const updatedShortlist = await (await fetch(`${baseUrl}/api/shortlist`)).json();
  assert.equal(updatedShortlist.items[0].status, "RECORD SAVED");
  const csvResponse = await fetch(`${baseUrl}/api/records.csv`);
  assert.equal(csvResponse.status, 200);
  const exportedCsv = await csvResponse.text();
  assert.match(exportedCsv, /LOT-TEST-01/);
  assert.match(exportedCsv, /LOT-OLD/);
});
