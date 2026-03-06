import { describe, test, expect } from "bun:test";
import {
  createEmptyProgress,
  updateProgressFromJsonLine,
  isLayerId,
  resolveServiceName,
  normalizeAction,
} from "../utils/composeProgress";

describe("isLayerId", () => {
  test("valid short hex", () => expect(isLayerId("a1b2c3")).toBe(true));
  test("valid 64-char hex", () => expect(isLayerId("a".repeat(64))).toBe(true));
  test("too short", () => expect(isLayerId("abc")).toBe(false));
  test("non-hex chars", () => expect(isLayerId("xyz123")).toBe(false));
  test("non-string", () => expect(isLayerId(123)).toBe(false));
  test("empty string", () => expect(isLayerId("")).toBe(false));
});

describe("resolveServiceName", () => {
  test("prefers parent_id", () => {
    expect(resolveServiceName({ parent_id: "web", id: "abc123" })).toBe("web");
  });
  test("uses id when it looks like a service name", () => {
    expect(resolveServiceName({ id: "myservice" })).toBe("myservice");
  });
  test("returns undefined for layer hash id without parent_id", () => {
    // 12+ char hex = layer id, skip it
    expect(resolveServiceName({ id: "a1b2c3d4e5f6" })).toBeUndefined();
  });
  test("returns undefined when id is not a string", () => {
    expect(resolveServiceName({ id: 42 })).toBeUndefined();
  });
});

describe("normalizeAction", () => {
  test("Extracting", () => expect(normalizeAction("Extracting fs layer")).toBe("Extracting"));
  test("Pull complete", () => expect(normalizeAction("Pull complete")).toBe("Pull complete"));
  test("Pulled", () => expect(normalizeAction("Pulled")).toBe("Pull complete"));
  test("Already exists", () => expect(normalizeAction("Already exists")).toBe("Already exists"));
  test("Waiting", () => expect(normalizeAction("Waiting")).toBe("Waiting"));
  test("default to Downloading", () => expect(normalizeAction("some other text")).toBe("Downloading"));
});

describe("createEmptyProgress", () => {
  test("returns zeroed progress", () => {
    const p = createEmptyProgress();
    expect(p.services.size).toBe(0);
    expect(p.networks.size).toBe(0);
    expect(p.errorMessage).toBe("");
    expect(p.isPulling).toBe(false);
  });
});

describe("updateProgressFromJsonLine", () => {
  const noopMapper = () => null;

  test("ignores empty lines", () => {
    const p = createEmptyProgress();
    updateProgressFromJsonLine("", p, noopMapper);
    expect(p.services.size).toBe(0);
  });

  test("ignores non-JSON lines", () => {
    const p = createEmptyProgress();
    updateProgressFromJsonLine("plain text", p, noopMapper);
    expect(p.services.size).toBe(0);
  });

  test("captures error messages", () => {
    const p = createEmptyProgress();
    updateProgressFromJsonLine(JSON.stringify({ error: true, message: "failed!" }), p, noopMapper);
    expect(p.errorMessage).toBe("failed!");
  });

  test("tracks container status via mapper", () => {
    const p = createEmptyProgress();
    const mapper = (s: string) => s === "Starting" ? { status: "starting", event: "Starting..." } : null;
    updateProgressFromJsonLine(JSON.stringify({ id: "Container myapp", status: "Starting" }), p, mapper);
    expect(p.services.has("myapp")).toBe(true);
    expect(p.services.get("myapp")?.status).toBe("starting");
  });

  test("tracks network events", () => {
    const p = createEmptyProgress();
    updateProgressFromJsonLine(JSON.stringify({ id: "Network mynet", status: "Created" }), p, noopMapper);
    expect(p.networks.has("mynet")).toBe(true);
    expect(p.networks.get("mynet")).toBe("Created");
  });

  test("detects pull events and sets isPulling", () => {
    const p = createEmptyProgress();
    updateProgressFromJsonLine(JSON.stringify({ id: "web", text: "Pulling web" }), p, noopMapper);
    expect(p.isPulling).toBe(true);
    expect(p.pullServices.has("web")).toBe(true);
  });
});
