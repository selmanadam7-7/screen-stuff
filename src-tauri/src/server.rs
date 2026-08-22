//! The local frame server.
//!
//! Both webviews (the cockpit and the board) talk to this over a WebSocket on
//! loopback. Control messages are JSON; frames come back as binary.
//!
//! It is bound to 127.0.0.1 on an ephemeral port and gated behind a token
//! generated fresh on every launch. Without the token, a random page that
//! happened to guess the port could read every screen you own — so the token is
//! not decoration.

use crate::capture::{start_stream, CaptureEngine, Stream, StreamEvent, StreamSpec};
use crate::protocol::{
    decode_frame_header, encode_frame, ClientMessage, ServerMessage, ServerStats,
    FLAG_GEOMETRY_CHANGED, PROTOCOL_VERSION,
};
use crate::sources::SourceId;
use anyhow::{Context as _, Result};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::Arc;

/// How many encoded frames may sit in flight per client before we start dropping.
/// Small on purpose — see the note in `capture::start_stream`.
const CLIENT_QUEUE: usize = 6;

#[derive(Clone)]
pub struct ServerState {
    pub engine: Arc<CaptureEngine>,
    pub token: Arc<str>,
}

pub struct RunningServer {
    pub addr: SocketAddr,
    pub token: String,
}

impl RunningServer {
    /// The URL the webviews connect to.
    pub fn stream_url(&self) -> String {
        format!("ws://{}/stream?token={}", self.addr, self.token)
    }
}

pub fn random_token() -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    (0..32).map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char).collect()
}

/// Start the server. Returns once it is bound and accepting.
pub async fn start(engine: Arc<CaptureEngine>) -> Result<RunningServer> {
    let token = random_token();
    let state = ServerState { engine, token: Arc::from(token.as_str()) };

    // The token is checked *before* the WebSocket upgrade extractor runs, so a
    // request without it is refused whether or not it is a well-formed upgrade.
    let guarded = Router::new()
        .route("/stream", get(stream_upgrade))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token));

    let app = Router::new().route("/health", get(health)).merge(guarded).with_state(state);

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .context("could not bind the frame server to loopback")?;
    let addr = listener.local_addr().context("frame server has no local address")?;

    tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, app).await {
            tracing::error!("frame server stopped: {err}");
        }
    });

    tracing::info!("frame server listening on {addr}");
    Ok(RunningServer { addr, token })
}

async fn health() -> impl IntoResponse {
    (StatusCode::OK, "screen-drop")
}

/// Pulls `token` out of a query string without pulling in a URL parser.
fn token_from_query(query: Option<&str>) -> Option<&str> {
    query?.split('&').find_map(|pair| pair.strip_prefix("token="))
}

async fn require_token(
    State(state): State<ServerState>,
    request: Request,
    next: Next,
) -> Response {
    if token_from_query(request.uri().query()) != Some(&*state.token) {
        return (StatusCode::FORBIDDEN, "bad token").into_response();
    }
    next.run(request).await
}

async fn stream_upgrade(ws: WebSocketUpgrade, State(state): State<ServerState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_client(socket, state))
}

/// Serve one connection until it goes away.
///
/// Everything lives in this single task on purpose. An earlier version split the
/// socket across a writer task and a frame pump, and it deadlocked: the pump
/// blocked forwarding to a socket that had died, so it never drained the stream
/// channel, so the workers never saw `Closed`, so they carried on capturing and
/// encoding for a client that had long since hung up. One task, one `select!`,
/// and the streams die with the connection because this scope owns them.
async fn handle_client(socket: WebSocket, state: ServerState) {
    let client = CLIENT_SEQ.fetch_add(1, Ordering::Relaxed);
    tracing::info!("client {client} connected");
    let (mut sink, mut incoming) = socket.split();
    let (events_tx, mut events_rx) = tokio::sync::mpsc::channel::<StreamEvent>(CLIENT_QUEUE);

    let mut streams: HashMap<u32, Stream> = HashMap::new();
    let mut sources: HashMap<u32, String> = HashMap::new();
    // Slots this client publishes into, so they can be closed when it goes.
    let mut feeds: HashMap<u32, String> = HashMap::new();
    // Every exit from the loop below sets this before breaking.
    let reason: String;

    let hello =
        ServerMessage::Hello { version: env!("CARGO_PKG_VERSION"), protocol: PROTOCOL_VERSION };
    if sink.send(Message::Text(json(&hello))).await.is_err() {
        return;
    }

    loop {
        tokio::select! {
            // Control messages from the client.
            incoming_message = incoming.next() => {
                let message = match incoming_message {
                    Some(Ok(message)) => message,
                    Some(Err(err)) => {
                        reason = format!("read failed: {err}");
                        break;
                    }
                    None => {
                        reason = "client hung up".into();
                        break;
                    }
                };
                let text = match message {
                    Message::Text(text) => text,
                    // A frame going the other way: the host publishing its camera.
                    Message::Binary(bytes) => {
                        if let Some((slot, width, height)) = decode_frame_header(&bytes) {
                            if let Some(name) = feeds.get(&slot) {
                                state.engine.feeds.publish(
                                    name,
                                    width,
                                    height,
                                    bytes[crate::protocol::FRAME_HEADER_LEN..].to_vec(),
                                );
                            }
                        }
                        continue;
                    }
                    Message::Close(_) => {
                        reason = "client closed the socket".into();
                        break;
                    }
                    _ => continue,
                };
                let Ok(parsed) = serde_json::from_str::<ClientMessage>(&text) else {
                    tracing::warn!("ignoring a malformed client message");
                    continue;
                };
                if handle_control(
                    &state,
                    parsed,
                    &mut streams,
                    &mut sources,
                    &mut feeds,
                    &events_tx,
                    &mut sink,
                )
                .await
                .is_err()
                {
                    reason = "reply could not be written".into();
                    break;
                }
            }

            // Encoded frames on their way out.
            event = events_rx.recv() => {
                let Some(event) = event else { continue };
                let message = match event {
                    StreamEvent::Frame(frame) => {
                        let flags = if frame.geometry_changed { FLAG_GEOMETRY_CHANGED } else { 0 };
                        Message::Binary(encode_frame(
                            frame.stream_id,
                            frame.seq,
                            frame.width,
                            frame.height,
                            flags,
                            &frame.jpeg,
                        ))
                    }
                    StreamEvent::Live { stream_id, native_width, native_height } => {
                        Message::Text(json(&ServerMessage::StreamLive {
                            stream_id,
                            source: sources.get(&stream_id).cloned().unwrap_or_default(),
                            native_width,
                            native_height,
                        }))
                    }
                    StreamEvent::Ended { stream_id } => {
                        Message::Text(json(&ServerMessage::StreamEnded {
                            stream_id,
                            source: sources.get(&stream_id).cloned().unwrap_or_default(),
                        }))
                    }
                    StreamEvent::Failed { stream_id, message } => {
                        Message::Text(json(&ServerMessage::StreamError {
                            stream_id,
                            source: sources.get(&stream_id).cloned().unwrap_or_default(),
                            message,
                        }))
                    }
                };
                // Backpressure lands here and nowhere else: while this send is in
                // flight the stream channel fills and workers drop frames rather
                // than queue them, which is the right behaviour for live video.
                if sink.send(message).await.is_err() {
                    reason = "frame could not be written".into();
                    break;
                }
            }
        }
    }

    // Dropping the streams stops the workers, which release their sessions;
    // closing the feeds tells anyone watching them, rather than freezing.
    tracing::info!(
        "client {client} gone ({reason}); releasing {} streams and {} feeds",
        streams.len(),
        feeds.len()
    );
    for name in feeds.values() {
        state.engine.feeds.close(name);
    }
    drop(streams);
    let _ = sink.close().await;
}

/// Only used to label connections in the log.
static CLIENT_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// A dead socket is the only failure worth unwinding for, so that is what `Err` means.
async fn handle_control(
    state: &ServerState,
    message: ClientMessage,
    streams: &mut HashMap<u32, Stream>,
    sources: &mut HashMap<u32, String>,
    feeds: &mut HashMap<u32, String>,
    events_tx: &tokio::sync::mpsc::Sender<StreamEvent>,
    sink: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) -> Result<(), ()> {
    match message {
        ClientMessage::Subscribe { stream_id, source, width, height, fps, quality } => {
            let spec = StreamSpec { width, height, fps, quality };

            // Re-tuning an existing stream never restarts the capture.
            if let Some(existing) = streams.get(&stream_id) {
                if existing.source.to_string() == source {
                    existing.retune(spec);
                    return Ok(());
                }
                streams.remove(&stream_id); // pointed at something else now
            }

            let parsed_source = match SourceId::parse(&source) {
                Ok(id) => id,
                Err(err) => {
                    return send_text(
                        sink,
                        &ServerMessage::StreamError { stream_id, source, message: err.to_string() },
                    )
                    .await;
                }
            };

            tracing::debug!(
                "stream {stream_id} -> {source} ({:?}) at {}x{}",
                parsed_source.kind(),
                spec.width,
                spec.height
            );

            match start_stream(&state.engine, stream_id, parsed_source, spec, events_tx.clone()) {
                Ok(stream) => {
                    sources.insert(stream_id, source);
                    streams.insert(stream_id, stream);
                    Ok(())
                }
                Err(err) => {
                    send_text(
                        sink,
                        &ServerMessage::StreamError {
                            stream_id,
                            source,
                            message: format!("{err:#}"),
                        },
                    )
                    .await
                }
            }
        }
        ClientMessage::Unsubscribe { stream_id } => {
            streams.remove(&stream_id);
            sources.remove(&stream_id);
            Ok(())
        }
        ClientMessage::OpenFeed { slot, name } => {
            match SourceId::parse(&format!("feed:{name}")) {
                Ok(_) => {
                    tracing::debug!("client publishing feed:{name} on slot {slot}");
                    feeds.insert(slot, name);
                }
                Err(err) => tracing::warn!("refusing feed name {name:?}: {err}"),
            }
            Ok(())
        }

        ClientMessage::CloseFeed { slot } => {
            if let Some(name) = feeds.remove(&slot) {
                state.engine.feeds.close(&name);
            }
            Ok(())
        }

        ClientMessage::Log { level, message } => {
            // Truncated, because this comes from a webview and ends up in a file.
            let message: String = message.chars().take(400).collect();
            match level.as_str() {
                "warn" => tracing::warn!("[webview] {message}"),
                "error" => tracing::error!("[webview] {message}"),
                _ => tracing::info!("[webview] {message}"),
            }
            Ok(())
        }

        ClientMessage::Ping { nonce } => {
            let stats = ServerStats {
                sessions: state.engine.session_count(),
                streams: streams.len(),
                frames_encoded: state.engine.stats.frames_encoded.load(Ordering::Relaxed),
                bytes_sent: state.engine.stats.bytes_sent.load(Ordering::Relaxed),
                dropped_frames: state.engine.stats.dropped_frames.load(Ordering::Relaxed),
                encode_ms_avg: state.engine.stats.encode_ms_avg(),
            };
            send_text(sink, &ServerMessage::Pong { nonce, stats }).await
        }
    }
}

async fn send_text<T: serde::Serialize>(
    sink: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    value: &T,
) -> Result<(), ()> {
    sink.send(Message::Text(json(value))).await.map_err(|_| ())
}

fn json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_pulled_out_of_a_query_string() {
        assert_eq!(token_from_query(Some("token=abc")), Some("abc"));
        assert_eq!(token_from_query(Some("a=1&token=abc")), Some("abc"));
        assert_eq!(token_from_query(Some("tokenish=abc")), None);
        assert_eq!(token_from_query(Some("")), None);
        assert_eq!(token_from_query(None), None);
    }

    #[test]
    fn tokens_are_long_and_not_repeated() {
        let a = random_token();
        let b = random_token();
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[tokio::test]
    async fn server_binds_and_reports_a_usable_url() {
        let engine = CaptureEngine::new();
        let server = start(engine).await.unwrap();
        assert_eq!(server.addr.ip().to_string(), "127.0.0.1");
        assert_ne!(server.addr.port(), 0);
        let url = server.stream_url();
        assert!(url.starts_with("ws://127.0.0.1:"));
        assert!(url.contains(&server.token));
    }

    #[tokio::test]
    async fn health_is_reachable_and_bad_tokens_are_refused() {
        let engine = CaptureEngine::new();
        let server = start(engine).await.unwrap();
        let base = format!("http://{}", server.addr);

        let health = simple_get(&format!("{base}/health")).await;
        assert!(health.contains("200"), "health check should answer 200, got: {health}");

        // Refused before the upgrade handshake is even considered, so a wrong
        // token cannot reach the capture engine by any route.
        for attempt in ["/stream?token=wrong", "/stream", "/stream?token="] {
            let denied = simple_get(&format!("{base}{attempt}")).await;
            assert!(denied.contains("403"), "expected 403 for {attempt}, got: {denied}");
        }

        let allowed = simple_get(&format!("{base}/stream?token={}", server.token)).await;
        assert!(
            !allowed.contains("403"),
            "the right token should get past the guard and fail on the upgrade instead"
        );
    }

    /// Minimal HTTP/1.1 GET so the test suite needs no HTTP client dependency.
    async fn simple_get(url: &str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let without_scheme = url.trim_start_matches("http://");
        let (host, path) = without_scheme.split_once('/').unwrap_or((without_scheme, ""));
        let mut stream = tokio::net::TcpStream::connect(host).await.unwrap();
        let request = format!("GET /{path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = Vec::new();
        let _ = stream.read_to_end(&mut response).await;
        String::from_utf8_lossy(&response).to_string()
    }
}
