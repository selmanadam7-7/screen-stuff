/**
 * The binary frame envelope, mirrored from `src-tauri/src/protocol.rs`.
 * Both sides have tests over the same layout, so a change on one side that is
 * not made on the other fails loudly instead of showing garbage pixels.
 */

export const FRAME_MAGIC = 0x53445246; // "SDRF"
export const FRAME_HEADER_LEN = 20;

export const FORMAT_JPEG = 0;
export const FLAG_GEOMETRY_CHANGED = 1 << 0;

export interface FrameHeader {
  streamId: number;
  seq: number;
  width: number;
  height: number;
  format: number;
  geometryChanged: boolean;
}

/** Returns null for anything that is not a frame we recognise. */
export function readFrameHeader(buffer: ArrayBuffer): FrameHeader | null {
  if (buffer.byteLength < FRAME_HEADER_LEN) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== FRAME_MAGIC) return null;
  const flags = view.getUint16(18, true);
  return {
    streamId: view.getUint32(4, true),
    seq: view.getUint32(8, true),
    width: view.getUint16(12, true),
    height: view.getUint16(14, true),
    format: view.getUint16(16, true),
    geometryChanged: (flags & FLAG_GEOMETRY_CHANGED) !== 0,
  };
}

/** Only used by tests and tooling; the real encoder lives in Rust. */
export function writeFrameHeader(header: FrameHeader, payloadLength: number): ArrayBuffer {
  const buffer = new ArrayBuffer(FRAME_HEADER_LEN + payloadLength);
  const view = new DataView(buffer);
  view.setUint32(0, FRAME_MAGIC, true);
  view.setUint32(4, header.streamId, true);
  view.setUint32(8, header.seq, true);
  view.setUint16(12, header.width, true);
  view.setUint16(14, header.height, true);
  view.setUint16(16, header.format, true);
  view.setUint16(18, header.geometryChanged ? FLAG_GEOMETRY_CHANGED : 0, true);
  return buffer;
}
