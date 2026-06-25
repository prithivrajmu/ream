import { describe, expect, it } from "vitest";
import { elapsedSeconds, formatDuration } from "../shared/time";

describe("time helpers", () => {
  it("formats short and long durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  it("calculates elapsed seconds without returning negatives", () => {
    const now = new Date("2026-06-25T10:00:30.000Z");

    expect(elapsedSeconds("2026-06-25T10:00:00.000Z", now)).toBe(30);
    expect(elapsedSeconds("2026-06-25T10:01:00.000Z", now)).toBe(0);
    expect(elapsedSeconds("not-a-date", now)).toBe(0);
  });
});
