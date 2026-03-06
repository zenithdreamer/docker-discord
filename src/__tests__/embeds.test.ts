import { describe, test, expect } from "bun:test";
import { truncateText, createSuccessEmbed, createErrorEmbed, COLORS, ICONS } from "../utils/embeds";

describe("truncateText", () => {
  test("short text passes through", () => {
    expect(truncateText("hello", 100)).toBe("hello");
  });
  test("text at exact limit passes through", () => {
    const text = "a".repeat(100);
    expect(truncateText(text, 100)).toBe(text);
  });
  test("long text is truncated with suffix", () => {
    const text = "a".repeat(200);
    const result = truncateText(text, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain("... (truncated)");
  });
  test("default max is 1024", () => {
    const text = "a".repeat(1025);
    const result = truncateText(text);
    expect(result.length).toBeLessThanOrEqual(1024);
    expect(result).toContain("... (truncated)");
  });
});

describe("createSuccessEmbed", () => {
  test("sets correct color", () => {
    const embed = createSuccessEmbed("Title");
    const data = embed.toJSON();
    expect(data.color).toBe(COLORS.SUCCESS);
  });
  test("title includes success icon", () => {
    const embed = createSuccessEmbed("Done");
    expect(embed.toJSON().title).toContain("Done");
    expect(embed.toJSON().title).toContain(ICONS.SUCCESS);
  });
  test("sets description when provided", () => {
    const embed = createSuccessEmbed("T", "desc");
    expect(embed.toJSON().description).toBe("desc");
  });
});

describe("createErrorEmbed", () => {
  test("sets correct color", () => {
    const embed = createErrorEmbed("Oops", "Something failed");
    expect(embed.toJSON().color).toBe(COLORS.ERROR);
  });
  test("title includes error icon", () => {
    const embed = createErrorEmbed("Oops", "msg");
    expect(embed.toJSON().title).toContain(ICONS.ERROR);
  });
  test("sets error message as description", () => {
    const embed = createErrorEmbed("Oops", "msg");
    expect(embed.toJSON().description).toBe("msg");
  });
  test("adds details field when provided", () => {
    const embed = createErrorEmbed("Oops", "msg", "details here");
    const fields = embed.toJSON().fields ?? [];
    expect(fields.some((f) => f.name === "Details")).toBe(true);
  });
  test("truncates long details to fit Discord field limit", () => {
    const embed = createErrorEmbed("Oops", "msg", "x".repeat(2000));
    const fields = embed.toJSON().fields ?? [];
    const details = fields.find((f) => f.name === "Details");
    expect(details?.value.length).toBeLessThanOrEqual(1024);
  });
});
