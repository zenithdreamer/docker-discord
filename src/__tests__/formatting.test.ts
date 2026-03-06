import { describe, test, expect } from "bun:test";
import { formatDuration, formatBytes, formatPorts, getServiceStateIcon } from "../utils/formatting";
import { ICONS } from "../utils/embeds";

describe("formatDuration", () => {
  test("zero seconds", () => expect(formatDuration(0)).toBe("0s"));
  test("seconds only", () => expect(formatDuration(45)).toBe("45s"));
  test("minutes and seconds", () => expect(formatDuration(90)).toBe("1m 30s"));
  test("hours minutes seconds", () => expect(formatDuration(3661)).toBe("1h 1m 1s"));
  test("days", () => expect(formatDuration(86400)).toBe("1d 0s"));
  test("full combination", () => expect(formatDuration(90061)).toBe("1d 1h 1m 1s"));
});

describe("formatBytes", () => {
  test("zero bytes", () => expect(formatBytes(0)).toBe("0 B"));
  test("bytes", () => expect(formatBytes(500)).toBe("500 B"));
  test("kilobytes", () => expect(formatBytes(1024)).toBe("1 KB"));
  test("megabytes", () => expect(formatBytes(1024 * 1024)).toBe("1 MB"));
  test("gigabytes", () => expect(formatBytes(1024 ** 3)).toBe("1 GB"));
  test("fractional", () => expect(formatBytes(1536)).toBe("1.5 KB"));
});

describe("getServiceStateIcon", () => {
  test("running state", () => expect(getServiceStateIcon("running")).toBe(ICONS.RUNNING));
  test("up state", () => expect(getServiceStateIcon("up")).toBe(ICONS.RUNNING));
  test("paused state", () => expect(getServiceStateIcon("paused")).toBe(ICONS.PAUSED));
  test("exited state", () => expect(getServiceStateIcon("exited")).toBe(ICONS.STOPPED));
  test("stopped state", () => expect(getServiceStateIcon("stopped")).toBe(ICONS.STOPPED));
  test("case insensitive running", () => expect(getServiceStateIcon("Running")).toBe(ICONS.RUNNING));
});

describe("formatPorts", () => {
  test("empty string", () => expect(formatPorts("")).toBe(""));
  test("published port", () => expect(formatPorts("0.0.0.0:8080->80/tcp")).toBe("8080"));
  test("internal only port", () => expect(formatPorts("80/tcp")).toBe("80 (internal)"));
  test("multiple unique ports", () =>
    expect(formatPorts("0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp")).toBe("80, 443"),
  );
  test("truncates after 3 ports", () => {
    const ports = "0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp, 0.0.0.0:8080->8080/tcp, 0.0.0.0:9000->9000/tcp";
    const result = formatPorts(ports);
    expect(result).toMatch(/\+1$/);
  });
});
