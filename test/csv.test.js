import assert from "node:assert/strict";
import test from "node:test";

import { parseCsv } from "../server/csv.js";

test("legacy CSV migration preserves commas, quotes, and embedded newlines", () => {
  const csv = [
    "inspection_id,notes,image_name",
    'ABC123,"Line 1, ""north"" shift',
    'second note",part.png',
    "DEF456,,other.jpg",
  ].join("\r\n");
  assert.deepEqual(parseCsv(csv), [
    {
      inspection_id: "ABC123",
      notes: 'Line 1, "north" shift\r\nsecond note',
      image_name: "part.png",
    },
    { inspection_id: "DEF456", notes: "", image_name: "other.jpg" },
  ]);
});

test("legacy CSV migration rejects an unclosed quoted field", () => {
  assert.throws(() => parseCsv('inspection_id,notes\nABC123,"unfinished'), /unclosed quoted field/);
});
