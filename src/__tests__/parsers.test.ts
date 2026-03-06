import { describe, test, expect } from "bun:test";
import { createEmptyPullProgress, updatePullProgressFromJsonLine } from "../utils/parsers";

describe("createEmptyPullProgress", () => {
  test("returns empty progress state", () => {
    const p = createEmptyPullProgress();
    expect(p.services.size).toBe(0);
    expect(p.pulledCount).toBe(0);
    expect(p.upToDateCount).toBe(0);
    expect(p.totalServices).toBe(0);
  });
});

describe("updatePullProgressFromJsonLine", () => {
  test("ignores empty lines", () => {
    const p = createEmptyPullProgress();
    updatePullProgressFromJsonLine("", p);
    expect(p.services.size).toBe(0);
  });

  test("ignores malformed JSON", () => {
    const p = createEmptyPullProgress();
    updatePullProgressFromJsonLine("not json", p);
    expect(p.services.size).toBe(0);
  });

  test("registers a pulling service", () => {
    const p = createEmptyPullProgress();
    updatePullProgressFromJsonLine(JSON.stringify({ id: "myservice", text: "Pulling myservice" }), p);
    expect(p.services.has("myservice")).toBe(true);
    expect(p.services.get("myservice")?.status).toBe("pulling");
  });

  test("marks service as pulled", () => {
    const p = createEmptyPullProgress();
    updatePullProgressFromJsonLine(JSON.stringify({ id: "svc", text: "Pulled" }), p);
    expect(p.services.get("svc")?.status).toBe("pulled");
    expect(p.pulledCount).toBe(1);
  });

  test("marks service as up-to-date", () => {
    const p = createEmptyPullProgress();
    updatePullProgressFromJsonLine(JSON.stringify({ id: "svc", text: "Already exists" }), p);
    expect(p.services.get("svc")?.status).toBe("up-to-date");
    expect(p.upToDateCount).toBe(1);
  });

  test("prefers parent_id over id for service name", () => {
    const p = createEmptyPullProgress();
    const layerId = "abc123def456"; // looks like a layer hash
    updatePullProgressFromJsonLine(
      JSON.stringify({ id: layerId, parent_id: "web", text: "Pulling" }),
      p,
    );
    expect(p.services.has("web")).toBe(true);
  });

  test("tracks layer progress", () => {
    const p = createEmptyPullProgress();
    const layerId = "a1b2c3d4e5f6"; // 12-char hex = layer id
    updatePullProgressFromJsonLine(
      JSON.stringify({ id: layerId, parent_id: "svc", text: "Downloading", current: 512, total: 1024 }),
      p,
    );
    const svc = p.services.get("svc");
    expect(svc?.layers.has(layerId)).toBe(true);
    const layer = svc?.layers.get(layerId);
    expect(layer?.action).toBe("Downloading");
    expect(layer?.current).toBe(512);
    expect(layer?.total).toBe(1024);
  });

  test("updates summary with multiple services", () => {
    const p = createEmptyPullProgress();
    updatePullProgressFromJsonLine(JSON.stringify({ id: "svc1", text: "Pulled" }), p);
    updatePullProgressFromJsonLine(JSON.stringify({ id: "svc2", text: "Already exists" }), p);
    expect(p.pulledCount).toBe(1);
    expect(p.upToDateCount).toBe(1);
    expect(p.totalServices).toBe(2);
  });
});
