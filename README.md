# SmartVision — Quality, made visible

A Node.js and React application for image-based quality screening in small manufacturing teams. The workspace includes:

- A responsive overview of the quality-inspection gap and the SmartVision workflow
- A light/dark theme switch
- Node/OpenCV-free reference-based image comparison using Sharp and a local pixel-difference pipeline
- Candidate, highlighted-region, heatmap, and mask views
- An automatically maintained shortlist for flagged items needing human review
- Supervisor-approved, item-level inspection records and CSV export
- Local JSON persistence, with migration from the earlier `data/inspections.csv` file

## Requirements

- Node.js 22 or later
- npm

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL printed in the terminal (usually http://localhost:5173). The Express API runs on http://localhost:3001.

## Production build

```bash
npm run build
npm start
```

The Express server serves the built application and API on port `3001` by default. Set `PORT` to choose another port.

## Inspection workflow

1. Open Inspection Studio and enter a batch / lot ID.
2. Choose a product category and optionally enter a part or SKU.
3. Upload a known-good reference image and an item image of the same product. PNG, JPEG, and WebP files up to 12 MB each are accepted.
4. Use similar framing, orientation, camera distance, and lighting. Pairs with noticeably different aspect ratios are rejected.
5. Adjust the difference sensitivity and minimum region size if needed, then analyze.
6. Review the candidate image, flagged-region overlay, and difference map. Items with flags are added to the Review Shortlist automatically.
7. Enter the approving supervisor's name, review the result, and explicitly approve before saving an item-level record.
8. Use the shortlist to mark flagged items reviewed and clear, or return a cleared item to review. Filter and export saved records from Inspection Records.

## Data and privacy

- Inspection records are stored in `data/inspections.json`.
- Flagged-item shortlist entries are stored in `data/shortlist.json`.
- Generated review images are stored in `data/media/`.
- The first server startup imports existing rows from `data/inspections.csv` if no JSON inspection log exists. The CSV is left intact.
- Uploaded images are processed by the local Express server. No external vision service or hosted model is used.

These local files are ignored by Git. Back up or move them separately if you need to preserve local inspection history.

## Important technical scope

This version is a **reference-based anomaly-screening prototype**, not a trained or calibrated defect detector. It compares colour and edge changes between two images and highlights regions for an inspector. A visual difference is not necessarily a manufacturing defect, and a quiet result is not proof of defect-free quality. Camera movement, lighting, framing, and legitimate product variation can create false flags; subtle defects may be missed.

The displayed difference score is not a probability. “Review required” means a person should review the item; it is not an automatic rejection. “No flags detected” only means that differences did not cross the current screening settings. Never use this prototype as the sole basis for accepting or rejecting a production batch.

Before any operational use, collect expert-labelled images for a product family, test against factory-held-out images, measure precision, recall, false-accept rate, and false-reject rate, and have the quality owner approve the process. Inspecting samples does not certify every item in a batch.
