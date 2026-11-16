import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stringify } from "csv-stringify/sync";
import express from "express";
import multer from "multer";

import { inspectImages } from "./vision.js";
import { parseCsv } from "./csv.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const mediaDirectory = path.join(dataDirectory, "media");
const recordsPath = path.join(dataDirectory, "inspections.json");
const shortlistPath = path.join(dataDirectory, "shortlist.json");
const legacyCsvPath = path.join(dataDirectory, "inspections.csv");
const port = Number(process.env.PORT) || 3001;
const recordColumns = [
  "inspection_id",
  "timestamp",
  "batch_id",
  "product",
  "operator",
  "decision",
  "anomaly_score",
  "threshold",
  "review_threshold",
  "flagged_regions",
  "coverage_pct",
  "notes",
  "image_name",
];
const app = express();
const analyses = new Map();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 2 },
  fileFilter: (_request, file, callback) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) {
      callback(new Error("Upload a PNG, JPEG, or WebP image."));
      return;
    }
    callback(null, true);
  },
});

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

async function ensureStorage() {
  await fs.mkdir(mediaDirectory, { recursive: true, mode: 0o700 });
  try {
    await fs.access(recordsPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    let migrated = [];
    try {
      const csv = await fs.readFile(legacyCsvPath, "utf8");
      migrated = parseCsv(csv);
    } catch (readError) {
      if (readError.code !== "ENOENT") throw readError;
    }
    await writeJson(recordsPath, migrated);
  }
  try {
    await fs.access(shortlistPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeJson(shortlistPath, []);
  }
}

async function readRecords() {
  return readJson(recordsPath, []);
}

async function readShortlist() {
  return readJson(shortlistPath, []);
}

function safeNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function publicMediaUrl(filename) {
  return `/media/${encodeURIComponent(filename)}`;
}

app.use(express.json({ limit: "100kb" }));
app.use("/media", express.static(mediaDirectory, { dotfiles: "deny", index: false, maxAge: 0 }));

app.get("/api/health", (_request, response) => response.json({ status: "ok" }));

app.get("/api/records", async (request, response, next) => {
  try {
    const records = (await readRecords()).sort((left, right) =>
      String(right.timestamp).localeCompare(String(left.timestamp)),
    );
    const filtered = records.filter((record) => {
      const batchMatches = !request.query.batch || record.batch_id === request.query.batch;
      const decisionMatches =
        !request.query.decision || record.decision === request.query.decision;
      return batchMatches && decisionMatches;
    });
    response.json({ records: filtered });
  } catch (error) {
    next(error);
  }
});

app.get("/api/records.csv", async (_request, response, next) => {
  try {
    const records = await readRecords();
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="smartvision_quality_records.csv"');
    response.send(stringify(records, { header: true, columns: recordColumns }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/shortlist", async (_request, response, next) => {
  try {
    const items = (await readShortlist()).sort((left, right) =>
      String(right.createdAt).localeCompare(String(left.createdAt)),
    );
    response.json({ items });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/analyze",
  upload.fields([
    { name: "reference", maxCount: 1 },
    { name: "candidate", maxCount: 1 },
  ]),
  async (request, response, next) => {
    try {
      const reference = request.files?.reference?.[0];
      const candidate = request.files?.candidate?.[0];
      if (!reference || !candidate) {
        response.status(400).json({ error: "Upload both a known-good reference and an item image." });
        return;
      }
      const batchId = String(request.body.batchId || "").trim();
      if (!batchId) {
        response.status(400).json({ error: "Enter a batch / lot ID before analysis." });
        return;
      }

      const options = {
        threshold: safeNumber(request.body.threshold, 22, 5, 60),
        minArea: safeNumber(request.body.minArea, 35, 10, 500),
      };
      const analysis = await inspectImages(reference.buffer, candidate.buffer, options);
      const reviewThreshold = safeNumber(request.body.reviewThreshold, 30, 5, 100);
      const id = crypto.randomUUID();
      const decision = analysis.score >= reviewThreshold || analysis.count > 0
        ? "REVIEW REQUIRED"
        : "NO FLAGS DETECTED";
      const result = {
        id,
        batchId,
        partId: String(request.body.partId || "").trim(),
        product: String(request.body.product || "Other"),
        operator: String(request.body.operator || "Quality Supervisor").trim(),
        notes: String(request.body.notes || "").trim(),
        imageName: path.basename(candidate.originalname),
        threshold: options.threshold,
        minArea: options.minArea,
        reviewThreshold,
        score: Number(analysis.score.toFixed(2)),
        coverage: Number(analysis.coverage.toFixed(3)),
        count: analysis.count,
        regions: analysis.regions,
        decision,
        createdAt: new Date().toISOString(),
      };

      const media = {
        candidate: analysis.candidatePng,
        overlay: analysis.overlayPng,
        heatmap: analysis.heatmapPng,
        mask: analysis.maskPng,
      };
      for (const [kind, bytes] of Object.entries(media)) {
        const filename = `${id}-${kind}.png`;
        await fs.writeFile(path.join(mediaDirectory, filename), bytes, { mode: 0o600 });
        result[`${kind}Url`] = publicMediaUrl(filename);
      }
      analyses.set(id, result);

      if (decision === "REVIEW REQUIRED") {
        const shortlist = await readShortlist();
        const item = { ...result, status: "NEEDS REVIEW" };
        shortlist.unshift(item);
        await writeJson(shortlistPath, shortlist);
        result.shortlistId = id;
      }
      response.json({ result });
    } catch (error) {
      if (error.message.includes("aspect ratios")) {
        response.status(422).json({ error: error.message });
        return;
      }
      next(error);
    }
  },
);

app.post("/api/records", async (request, response, next) => {
  try {
    const analysis = analyses.get(String(request.body.analysisId || ""));
    if (!analysis) {
      response.status(404).json({ error: "This analysis has expired. Run the inspection again before saving." });
      return;
    }
    if (!String(request.body.approvedBy || "").trim()) {
      response.status(400).json({ error: "Enter the name of the supervisor approving this record." });
      return;
    }
    const records = await readRecords();
    const record = {
      inspection_id: crypto.randomUUID().slice(0, 8).toUpperCase(),
      timestamp: new Date().toISOString(),
      batch_id: analysis.batchId,
      product: analysis.partId || analysis.product,
      operator: String(request.body.approvedBy).trim(),
      decision: analysis.decision,
      anomaly_score: analysis.score,
      threshold: analysis.threshold,
      review_threshold: analysis.reviewThreshold,
      flagged_regions: analysis.count,
      coverage_pct: analysis.coverage,
      notes: analysis.notes,
      image_name: analysis.imageName,
    };
    records.push(record);
    await writeJson(recordsPath, records);

    if (analysis.shortlistId) {
      const shortlist = await readShortlist();
      const item = shortlist.find((entry) => entry.id === analysis.shortlistId);
      if (item) {
        item.status = "RECORD SAVED";
        item.reviewedBy = String(request.body.approvedBy).trim();
        item.reviewedAt = record.timestamp;
        await writeJson(shortlistPath, shortlist);
      }
    }
    analyses.delete(analysis.id);
    response.status(201).json({ record });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/shortlist/:id", async (request, response, next) => {
  try {
    const allowedStatuses = new Set(["NEEDS REVIEW", "CLEARED"]);
    const status = String(request.body.status || "");
    if (!allowedStatuses.has(status)) {
      response.status(400).json({ error: "Choose either Needs review or Cleared." });
      return;
    }
    const shortlist = await readShortlist();
    const item = shortlist.find((entry) => entry.id === request.params.id);
    if (!item) {
      response.status(404).json({ error: "Shortlist item not found." });
      return;
    }
    item.status = status;
    item.reviewedAt = new Date().toISOString();
    await writeJson(shortlistPath, shortlist);
    response.json({ item });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(root, "dist")));
app.get(/.*/, async (_request, response, next) => {
  try {
    response.sendFile(path.join(root, "dist", "index.html"));
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(413).json({ error: "Each image must be smaller than 12 MB." });
    return;
  }
  if (error instanceof multer.MulterError) {
    response.status(400).json({ error: "Could not read the uploaded images." });
    return;
  }
  if (error.message?.startsWith("Upload a ")) {
    response.status(415).json({ error: error.message });
    return;
  }
  if (
    error.message?.includes("Input buffer")
    || error.message?.includes("unsupported image")
    || error.message?.includes("pixel limit")
  ) {
    response.status(400).json({ error: "One of these files is not a supported image. Try PNG, JPEG, or WebP." });
    return;
  }
  console.error(error);
  response.status(500).json({ error: "Something went wrong while processing this request." });
});

await ensureStorage();
app.listen(port, "0.0.0.0", () => {
  console.log(`SmartVision API listening on http://localhost:${port}`);
});
