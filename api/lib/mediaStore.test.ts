import { describe, it, expect } from "vitest";
import { externalizeDataUrl, readMedia, MEDIA_ROUTE } from "./mediaStore";

describe("mediaStore", () => {
  it("moves a large data: URL into a file and serves the same bytes back", () => {
    const bytes = Buffer.alloc(10_000, 7);
    const link = externalizeDataUrl(`data:audio/webm;codecs=opus;base64,${bytes.toString("base64")}`) as string;
    expect(link.startsWith(MEDIA_ROUTE)).toBe(true);
    const media = readMedia(link.slice(MEDIA_ROUTE.length));
    expect(media?.mime).toBe("audio/webm");
    expect(media?.body.equals(bytes)).toBe(true);
  });

  it("leaves short strings, normal URLs and bad names alone", () => {
    expect(externalizeDataUrl("data:text/plain,hi")).toBe("data:text/plain,hi");
    expect(externalizeDataUrl("https://example.com/a.mp3")).toBe("https://example.com/a.mp3");
    expect(readMedia("../db.json")).toBeNull();
  });
});
