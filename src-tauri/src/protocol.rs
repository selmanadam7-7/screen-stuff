//! Wire protocol between the Rust core and the two webviews.
//!
//! Control traffic is JSON. Frames are binary, because a JSON-encoded JPEG
//! would cost us a base64 round-trip on every single frame of every tile.
//!
//! Binary frame layout (little-endian):
//!
//! ```text
//!   offset  size  field
//!   0       4     magic      0x53445246  "SDRF"
//!   4       4     stream_id  which subscription this belongs to
//!   8       4     seq        monotonic per stream, lets the client drop stale frames
//!   12      2     width      pixels in the payload
//!   14      2     height
//!   16      2     format     0 = JPEG
//!   18      2     flags      bit 0 = source resized since last frame
//!   20      ..    payload
//! ```

use serde::{Deserialize, Serialize};

pub const FRAME_MAGIC: u32 = 0x5344_5246;
pub const FRAME_HEADER_LEN: usize = 20;

pub const FORMAT_JPEG: u16 = 0;
pub const FLAG_GEOMETRY_CHANGED: u16 = 1 << 0;

/// Builds the binary envelope for one encoded frame.
pub fn encode_frame(
    stream_id: u32,
    seq: u32,
    width: u16,
    height: u16,
    flags: u16,
    payload: &[u8],
) -> Vec<u8> {
    let mut out = Vec::with_capacity(FRAME_HEADER_LEN + payload.len());
    out.extend_from_slice(&FRAME_MAGIC.to_le_bytes());
    out.extend_from_slice(&stream_id.to_le_bytes());
    out.extend_from_slice(&seq.to_le_bytes());
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.extend_from_slice(&FORMAT_JPEG.to_le_bytes());
    out.extend_from_slice(&flags.to_le_bytes());
    out.extend_from_slice(payload);
    out
}

/// Reads the header off a frame a client sent us. Same layout as outbound,
/// so a frame can be relayed without being re-packed.
pub fn decode_frame_header(bytes: &[u8]) -> Option<(u32, u16, u16)> {
    if bytes.len() < FRAME_HEADER_LEN {
        return None;
    }
    if u32::from_le_bytes(bytes[0..4].try_into().ok()?) != FRAME_MAGIC {
        return None;
    }
    Some((
        u32::from_le_bytes(bytes[4..8].try_into().ok()?),
        u16::from_le_bytes(bytes[12..14].try_into().ok()?),
        u16::from_le_bytes(bytes[14..16].try_into().ok()?),
    ))
}

/// Everything a client can ask the frame server to do.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Open a stream, or re-tune one that already exists.
    ///
    /// Re-sending `subscribe` with the same `stream_id` and a new size is the
    /// normal path: a tile that grows on the board asks for more pixels rather
    /// than tearing down and rebuilding the capture.
    Subscribe {
        stream_id: u32,
        source: String,
        width: u32,
        height: u32,
        #[serde(default = "default_fps")]
        fps: u32,
        #[serde(default = "default_quality")]
        quality: u8,
    },
    Unsubscribe {
        stream_id: u32,
    },
    /// Client-side heartbeat; the server replies with `Pong` carrying stats.
    Ping {
        #[serde(default)]
        nonce: u64,
    },
    /// Claim a slot to publish frames into. Frames sent afterwards with this
    /// `slot` as their stream id land in the named feed, which guests can then
    /// subscribe to like any other source.
    OpenFeed {
        slot: u32,
        name: String,
    },
    CloseFeed {
        slot: u32,
    },
    /// A line from a webview into the app's own log. There is no other way to
    /// see what happened inside a webview when the app is running as a packaged
    /// desktop window with no console attached.
    Log {
        #[serde(default)]
        level: String,
        message: String,
    },
}

const fn default_fps() -> u32 {
    30
}
const fn default_quality() -> u8 {
    85
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ServerMessage {
    Hello {
        version: &'static str,
        protocol: u32,
    },
    /// A stream could not be opened, or died (window closed, monitor unplugged).
    StreamError {
        stream_id: u32,
        source: String,
        message: String,
    },
    /// Sent once a stream produces its first frame, so the UI can drop placeholders.
    StreamLive {
        stream_id: u32,
        source: String,
        native_width: u32,
        native_height: u32,
    },
    /// A source vanished — the tile should show "source gone", not a frozen frame.
    StreamEnded {
        stream_id: u32,
        source: String,
    },
    Pong {
        nonce: u64,
        stats: ServerStats,
    },
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ServerStats {
    pub sessions: usize,
    pub streams: usize,
    pub frames_encoded: u64,
    pub bytes_sent: u64,
    pub dropped_frames: u64,
    pub encode_ms_avg: f32,
}

pub const PROTOCOL_VERSION: u32 = 1;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_header_is_twenty_bytes_and_round_trips() {
        let payload = [1u8, 2, 3, 4, 5];
        let buf = encode_frame(7, 42, 1920, 1080, FLAG_GEOMETRY_CHANGED, &payload);

        assert_eq!(buf.len(), FRAME_HEADER_LEN + payload.len());
        assert_eq!(u32::from_le_bytes(buf[0..4].try_into().unwrap()), FRAME_MAGIC);
        assert_eq!(u32::from_le_bytes(buf[4..8].try_into().unwrap()), 7);
        assert_eq!(u32::from_le_bytes(buf[8..12].try_into().unwrap()), 42);
        assert_eq!(u16::from_le_bytes(buf[12..14].try_into().unwrap()), 1920);
        assert_eq!(u16::from_le_bytes(buf[14..16].try_into().unwrap()), 1080);
        assert_eq!(u16::from_le_bytes(buf[16..18].try_into().unwrap()), FORMAT_JPEG);
        assert_eq!(u16::from_le_bytes(buf[18..20].try_into().unwrap()), FLAG_GEOMETRY_CHANGED);
        assert_eq!(&buf[FRAME_HEADER_LEN..], &payload);
    }

    #[test]
    fn subscribe_defaults_fill_in() {
        let msg: ClientMessage = serde_json::from_str(
            r#"{"t":"subscribe","stream_id":3,"source":"monitor:0","width":960,"height":540}"#,
        )
        .unwrap();
        match msg {
            ClientMessage::Subscribe { fps, quality, stream_id, .. } => {
                assert_eq!(stream_id, 3);
                assert_eq!(fps, 30);
                assert_eq!(quality, 85);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn inbound_frame_headers_round_trip() {
        let frame = encode_frame(9, 1, 640, 360, 0, &[7, 7, 7]);
        assert_eq!(decode_frame_header(&frame), Some((9, 640, 360)));

        assert_eq!(decode_frame_header(&[0u8; 4]), None, "too short");
        let mut wrong = frame.clone();
        wrong[0] = 0;
        assert_eq!(decode_frame_header(&wrong), None, "wrong magic");
    }

    #[test]
    fn log_lines_default_to_info() {
        let msg: ClientMessage =
            serde_json::from_str(r#"{"t":"log","message":"camera opened"}"#).unwrap();
        match msg {
            ClientMessage::Log { level, message } => {
                assert_eq!(level, "");
                assert_eq!(message, "camera opened");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn unknown_message_is_rejected_not_panicked() {
        let parsed: Result<ClientMessage, _> = serde_json::from_str(r#"{"t":"launch_missiles"}"#);
        assert!(parsed.is_err());
    }
}
