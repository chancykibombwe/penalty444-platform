/**
 * MatchRenderer3D ready-timeout override tests.
 * Pure resolve helper + source contracts — no jsdom timers.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_UNITY_READY_TIMEOUT_MS,
  MAX_UNITY_READY_TIMEOUT_MS,
  UNITY_READY_TIMEOUT_MS,
  resolveUnityReadyTimeoutMs,
} from "./MatchRenderer3D";

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, "MatchRenderer3D.tsx"), "utf8");

test("default ready timeout remains 15_000 ms", () => {
  assert.equal(DEFAULT_UNITY_READY_TIMEOUT_MS, 15_000);
  assert.equal(UNITY_READY_TIMEOUT_MS, 15_000);
  assert.equal(resolveUnityReadyTimeoutMs(), 15_000);
  assert.equal(resolveUnityReadyTimeoutMs(undefined), 15_000);
});

test("explicit proof timeout can be 90_000 ms", () => {
  assert.equal(MAX_UNITY_READY_TIMEOUT_MS, 90_000);
  assert.equal(resolveUnityReadyTimeoutMs(90_000), 90_000);
  assert.equal(resolveUnityReadyTimeoutMs(66_370), 66_370);
});

test("invalid timeout falls back safely to the default", () => {
  assert.equal(resolveUnityReadyTimeoutMs(Number.NaN), 15_000);
  assert.equal(resolveUnityReadyTimeoutMs(Number.POSITIVE_INFINITY), 15_000);
  assert.equal(resolveUnityReadyTimeoutMs(0), 15_000);
  assert.equal(resolveUnityReadyTimeoutMs(-1), 15_000);
  assert.equal(resolveUnityReadyTimeoutMs(90_001), 15_000);
  assert.equal(resolveUnityReadyTimeoutMs(1_000_000), 15_000);
  assert.equal(resolveUnityReadyTimeoutMs(12.7), 12);
});

test("ready clears the configured timeout (source contract)", () => {
  assert.ok(/clearReadyTimeout\(\)/.test(source));
  assert.ok(/event === "ready"/.test(source) || /msg\.event === "ready"/.test(source));
  // Ready path must clear the armed timer before marking ready.
  assert.ok(/clearReadyTimeout/.test(source));
  assert.ok(/readyTimeoutRef\.current = window\.setTimeout/.test(source));
});

test("configured timeout still triggers fail-open when no ready arrives", () => {
  assert.ok(/3D preview did not become ready\./.test(source));
  assert.ok(/readyTimeoutMsRef\.current/.test(source));
  assert.ok(/markUnavailable\("3D preview did not become ready\."\)/.test(source));
  assert.ok(/resolveUnityReadyTimeoutMs\(readyTimeoutMs\)/.test(source));
});

test("no gameplay behavior changes from the timeout override API", () => {
  assert.ok(/deliveryMode = "latest"/.test(source));
  assert.ok(/presentationOnly = false/.test(source));
  assert.ok(/NEXT_PUBLIC_UNITY_MATCH_ENABLED/.test(source));
  // Override is optional and never authoritative for React match state.
  assert.ok(/readyTimeoutMs\?: number/.test(source));
  assert.equal(/socket\.io|getSocket\(/.test(source), false);
});
