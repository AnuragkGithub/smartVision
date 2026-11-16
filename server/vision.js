import sharp from "sharp";

const MAX_SIDE = 800;

async function decodeImage(input) {
  const { data, info } = await sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error("Image must be a supported RGB or grayscale image.");
  }

  return { data, width: info.width, height: info.height };
}

function luminance(data, offset) {
  return data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
}

function percentile(values, fraction) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function smoothScores(scores, width, height) {
  const smoothed = new Float32Array(scores.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = x + dx;
          const sy = y + dy;
          if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
            total += scores[sy * width + sx];
            count += 1;
          }
        }
      }
      smoothed[y * width + x] = total / count;
    }
  }
  return smoothed;
}

function findRegions(mask, width, height, minArea) {
  const visited = new Uint8Array(mask.length);
  const regions = [];
  const neighbors = [-1, 0, 1];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;

    const queue = [start];
    visited[start] = 1;
    let head = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (head < queue.length) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (const dy of neighbors) {
        for (const dx of neighbors) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }
    }

    if (queue.length >= minArea) {
      regions.push({
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        area: queue.length,
      });
    }
  }
  return regions;
}

function colorForScore(score) {
  const t = Math.max(0, Math.min(1, score / 100));
  if (t < 0.5) {
    const mix = t * 2;
    return [Math.round(20 + 235 * mix), Math.round(115 + 130 * mix), Math.round(235 * (1 - mix))];
  }
  const mix = (t - 0.5) * 2;
  return [255, Math.round(245 - 205 * mix), Math.round(20 * (1 - mix))];
}

async function makePng(data, width, height, channels = 3) {
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

function drawOverlay(image, width, height, regions) {
  const overlay = Buffer.from(image);
  for (const region of regions) {
    const { x, y, width: boxWidth, height: boxHeight } = region;
    for (let offset = 0; offset < 2; offset += 1) {
      const left = Math.min(width - 1, x + offset);
      const right = Math.min(width - 1, x + boxWidth - 1 - offset);
      const top = Math.min(height - 1, y + offset);
      const bottom = Math.min(height - 1, y + boxHeight - 1 - offset);
      for (let px = left; px <= right; px += 1) {
        setRed(overlay, (top * width + px) * 3);
        setRed(overlay, (bottom * width + px) * 3);
      }
      for (let py = top; py <= bottom; py += 1) {
        setRed(overlay, (py * width + left) * 3);
        setRed(overlay, (py * width + right) * 3);
      }
    }
  }
  return overlay;
}

function setRed(buffer, offset) {
  buffer[offset] = 245;
  buffer[offset + 1] = 53;
  buffer[offset + 2] = 77;
}

export async function inspectImages(referenceInput, candidateInput, options) {
  const [reference, candidate] = await Promise.all([
    decodeImage(referenceInput),
    decodeImage(candidateInput),
  ]);
  const referenceRatio = reference.width / reference.height;
  const candidateRatio = candidate.width / candidate.height;
  const ratioDifference = Math.abs(referenceRatio - candidateRatio) / referenceRatio;
  if (ratioDifference > 0.02) {
    throw new Error("Reference and item images need matching aspect ratios. Crop or retake them, then try again.");
  }

  const width = reference.width;
  const height = reference.height;
  const candidateAligned = await sharp(candidateInput, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer();

  const scores = new Float32Array(width * height);
  const rawMask = new Uint8Array(width * height);
  const threshold = Number(options.threshold);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 3;
      let colorDifference =
        (Math.abs(reference.data[offset] - candidateAligned[offset]) +
          Math.abs(reference.data[offset + 1] - candidateAligned[offset + 1]) +
          Math.abs(reference.data[offset + 2] - candidateAligned[offset + 2])) /
        3;

      const right = Math.min(width - 1, x + 1) * 3 + y * width * 3;
      const down = Math.min(height - 1, y + 1) * width * 3 + x * 3;
      const refGradient =
        Math.abs(luminance(reference.data, offset) - luminance(reference.data, right)) +
        Math.abs(luminance(reference.data, offset) - luminance(reference.data, down));
      const itemGradient =
        Math.abs(luminance(candidateAligned, offset) - luminance(candidateAligned, right)) +
        Math.abs(luminance(candidateAligned, offset) - luminance(candidateAligned, down));
      const edgeDifference = Math.min(70, Math.abs(refGradient - itemGradient));
      colorDifference = 0.82 * colorDifference + 0.18 * edgeDifference;
      scores[index] = colorDifference;
    }
  }

  const smoothed = smoothScores(scores, width, height);
  for (let index = 0; index < smoothed.length; index += 1) {
    rawMask[index] = smoothed[index] > threshold ? 1 : 0;
  }
  const regions = findRegions(rawMask, width, height, Number(options.minArea));
  const acceptedMask = new Uint8Array(rawMask.length);
  for (const region of regions) {
    for (let y = region.y; y < region.y + region.height; y += 1) {
      for (let x = region.x; x < region.x + region.width; x += 1) {
        if (rawMask[y * width + x]) acceptedMask[y * width + x] = 255;
      }
    }
  }
  const coverage = (acceptedMask.reduce((total, value) => total + (value ? 1 : 0), 0) / acceptedMask.length) * 100;
  const score = percentile(smoothed, 0.95);
  const heat = Buffer.alloc(width * height * 3);
  for (let index = 0; index < smoothed.length; index += 1) {
    const color = colorForScore(smoothed[index] * 2.2);
    const offset = index * 3;
    heat[offset] = Math.round(candidateAligned[offset] * 0.48 + color[0] * 0.52);
    heat[offset + 1] = Math.round(candidateAligned[offset + 1] * 0.48 + color[1] * 0.52);
    heat[offset + 2] = Math.round(candidateAligned[offset + 2] * 0.48 + color[2] * 0.52);
  }

  const overlay = drawOverlay(candidateAligned, width, height, regions);
  const maskPng = await makePng(acceptedMask, width, height, 1);
  const [candidatePng, overlayPng, heatmapPng] = await Promise.all([
    makePng(candidateAligned, width, height),
    makePng(overlay, width, height),
    makePng(heat, width, height),
  ]);
  return {
    width,
    height,
    score,
    coverage,
    regions,
    count: regions.length,
    candidatePng,
    overlayPng,
    heatmapPng,
    maskPng,
  };
}
