import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { inspectImages } from "../server/vision.js";

async function solidImage(color, width = 128, height = 128) {
  const buffer = Buffer.alloc(width * height * 3);
  for (let offset = 0; offset < buffer.length; offset += 3) {
    buffer[offset] = color[0];
    buffer[offset + 1] = color[1];
    buffer[offset + 2] = color[2];
  }
  return sharp(buffer, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

test("matching images produce no flagged regions", async () => {
  const reference = await solidImage([120, 120, 120]);
  const result = await inspectImages(reference, reference, { threshold: 22, minArea: 35 });
  assert.equal(result.count, 0);
  assert.equal(result.coverage, 0);
  assert.equal(result.score, 0);
  assert.ok(result.candidatePng.length > 0);
  assert.ok(result.heatmapPng.length > 0);
});

test("a visible local difference is highlighted for review", async () => {
  const width = 128;
  const height = 128;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = x >= 42 && x < 82 && y >= 42 && y < 82 ? 235 : 120;
      pixels[offset + 1] = 120;
      pixels[offset + 2] = 120;
    }
  }
  const reference = await solidImage([120, 120, 120], width, height);
  const candidate = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const result = await inspectImages(reference, candidate, { threshold: 22, minArea: 35 });
  assert.ok(result.count > 0);
  assert.ok(result.coverage > 0);
  assert.ok(result.score > 22);
  assert.ok(result.overlayPng.length > 0);
  assert.ok(result.maskPng.length > 0);
});

test("image pairs with incompatible framing are rejected", async () => {
  const reference = await solidImage([120, 120, 120], 128, 128);
  const candidate = await solidImage([120, 120, 120], 128, 96);
  await assert.rejects(
    inspectImages(reference, candidate, { threshold: 22, minArea: 35 }),
    /matching aspect ratios/,
  );
});
