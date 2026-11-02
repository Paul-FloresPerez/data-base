import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProcessingJobShape,
  isProcessingJobType,
  progressPercentage,
} from "../lib/server/processing-job-policy.ts";

test("valida tipos, tamaño de bloques y presupuesto de reintentos", () => {
  assert.equal(isProcessingJobType("IMPORTACION"), true);
  assert.equal(isProcessingJobType("OTRO"), false);
  assert.doesNotThrow(() => assertProcessingJobShape(200_000, 3));
  assert.throws(() => assertProcessingJobShape(0, 3));
  assert.throws(() => assertProcessingJobShape(1, 21));
});

test("el progreso procede exclusivamente de bloques completados", () => {
  assert.equal(progressPercentage(0, 4), 0);
  assert.equal(progressPercentage(1, 4), 25);
  assert.equal(progressPercentage(3, 4), 75);
  assert.equal(progressPercentage(5, 4), 100);
});
