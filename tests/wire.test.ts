import { describe, expect, it } from "vitest";
import {
  FLAG_GEOMETRY_CHANGED,
  FORMAT_JPEG,
  FRAME_HEADER_LEN,
  FRAME_MAGIC,
  readFrameHeader,
  writeFrameHeader,
} from "../src/core/wire";

/**
 * These mirror `protocol.rs`. If either side changes the layout without the
 * other, one of these fails rather than the board quietly showing static.
 */
describe("frame envelope", () => {
  it("agrees with the Rust constants", () => {
    expect(FRAME_MAGIC).toBe(0x53445246); // "SDRF"
    expect(FRAME_HEADER_LEN).toBe(20);
    expect(FORMAT_JPEG).toBe(0);
    expect(FLAG_GEOMETRY_CHANGED).toBe(1);
  });

  it("round-trips every field", () => {
    const header = {
      streamId: 4_000_000_000,
      seq: 123456,
      width: 1920,
      height: 1080,
      format: FORMAT_JPEG,
      geometryChanged: true,
    };
    const parsed = readFrameHeader(writeFrameHeader(header, 0))!;
    expect(parsed).toEqual(header);
  });

  it("reads the flag as false when it is not set", () => {
    const buffer = writeFrameHeader(
      { streamId: 1, seq: 1, width: 8, height: 8, format: 0, geometryChanged: false },
      4,
    );
    expect(readFrameHeader(buffer)!.geometryChanged).toBe(false);
  });

  it("refuses anything that is not one of our frames", () => {
    expect(readFrameHeader(new ArrayBuffer(4))).toBeNull(); // too short
    const wrongMagic = new ArrayBuffer(FRAME_HEADER_LEN);
    new DataView(wrongMagic).setUint32(0, 0xdeadbeef, true);
    expect(readFrameHeader(wrongMagic)).toBeNull();
  });

  it("accepts a header with no payload", () => {
    const buffer = writeFrameHeader(
      { streamId: 9, seq: 0, width: 2, height: 2, format: 0, geometryChanged: false },
      0,
    );
    expect(buffer.byteLength).toBe(FRAME_HEADER_LEN);
    expect(readFrameHeader(buffer)!.streamId).toBe(9);
  });
});
