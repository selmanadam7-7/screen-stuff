//! The guest listener: a second HTTP server, bound to the local network, off
//! until the host turns it on.
//!
//! It serves the guest page and one WebSocket. Guests get the board document and
//! the tiles that board uses — nothing else on the machine is reachable through
//! this port, whatever they ask for.

use crate::capture::{start_stream, Stream, StreamEvent, StreamSpec};
use crate::guest::{
    guest_token, is_reaction, lan_address, FromGuest, GuestHub, RunningGuestServer, ToGuest,
    ToHost,
    MAX_GUEST_FILE_BYTES,
};
use crate::protocol::{encode_frame, FLAG_GEOMETRY_CHANGED};
use crate::sources::SourceId;
use anyhow::{Context as _, Result};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, RawQuery, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;

const GUEST_QUEUE: usize = 6;
/// Guests never get a bigger rendition than this, however far they zoom in.
const GUEST_MAX_WIDTH: u32 = 1920;
const GUEST_MAX_HEIGHT: u32 = 1080;

#[derive(Clone)]
struct GuestState {
    hub: Arc<GuestHub>,
    token: Arc<str>,
}

/// Start the guest listener. `port` of 0 asks the OS for a free one.
pub async fn start(hub: Arc<GuestHub>, port: u16) -> Result<RunningGuestServer> {
    let token = guest_token();
    let state = GuestState { hub: hub.clone(), token: Arc::from(token.as_str()) };

    let app = Router::new()
        .route("/g/:token", get(guest_page))
        .route("/o/:token", get(guest_page))
        .route("/gw", get(guest_socket))
        .route("/assets/*path", get(asset))
        .fallback(not_found)
        .layer(middleware::from_fn_with_state(state.clone(), no_store))
        .with_state(state);

    // Bound to every interface on purpose: a guest link that only works on
    // loopback is not a guest link. It is off by default and token-gated.
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .context("could not open the guest port")?;
    let addr = listener.local_addr().context("guest server has no address")?;

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(async move {
        let served = axum::serve(listener, app).with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        });
        if let Err(err) = served.await {
            tracing::error!("guest server stopped: {err}");
        }
        tracing::info!("guest server closed");
    });

    let host = lan_address().unwrap_or_else(|_| "127.0.0.1".to_string());
    tracing::info!("guest server listening on {addr}");
    Ok(RunningGuestServer::new(addr, token, &host, shutdown_tx))
}

/// Guest pages must never be cached — the token in the path is the only secret.
async fn no_store(State(_state): State<GuestState>, request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, header::HeaderValue::from_static("no-store"));
    response
}

async fn not_found() -> impl IntoResponse {
    (StatusCode::NOT_FOUND, "no such page")
}

async fn guest_page(
    Path(token): Path<String>,
    State(state): State<GuestState>,
) -> impl IntoResponse {
    if token != *state.token {
        return (StatusCode::FORBIDDEN, "that link is not valid any more").into_response();
    }
    match state.hub.read_web_file("guest.html") {
        Some(body) => ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], body).into_response(),
        None => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "the guest page is missing from this build",
        )
            .into_response(),
    }
}

async fn asset(Path(path): Path<String>, State(state): State<GuestState>) -> impl IntoResponse {
    // Only ever reads from the app's own built assets, and never above them.
    if path.contains("..") || path.contains('\\') {
        return (StatusCode::BAD_REQUEST, "no").into_response();
    }
    let Some(body) = state.hub.read_web_file(&format!("assets/{path}")) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    let mime = if path.ends_with(".js") || path.ends_with(".mjs") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    };
    ([(header::CONTENT_TYPE, mime)], body).into_response()
}

// ---------------------------------------------------------------------------
// The guest socket
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(tag = "t", rename_all = "snake_case")]
enum GuestReply<'a> {
    Welcome { id: u64, name: &'a str },
    Refused { message: &'a str },
}

async fn guest_socket(
    ws: WebSocketUpgrade,
    RawQuery(query): RawQuery,
    State(state): State<GuestState>,
) -> impl IntoResponse {
    let output = query.as_deref().is_some_and(|q| q.split('&').any(|p| p == "output=1"));
    ws.on_upgrade(move |socket| handle_guest(socket, state, output))
}

async fn handle_guest(socket: WebSocket, state: GuestState, output: bool) {
    let (mut sink, mut incoming) = socket.split();
    let hub = state.hub.clone();

    // An output view gets everything a guest gets except a place in the room.
    let guest = if output { hub.join_quietly() } else { hub.join(String::new()) };
    let guest_id = guest.id;
    tracing::info!("{} {guest_id} joined", if output { "output" } else { "guest" });

    let (events_tx, mut events_rx) = tokio::sync::mpsc::channel::<StreamEvent>(GUEST_QUEUE);
    let mut streams: HashMap<u32, Stream> = HashMap::new();
    let mut board_updates = hub.subscribe_guests();

    let _ = sink
        .send(Message::Text(
            serde_json::to_string(&GuestReply::Welcome { id: guest.id, name: &guest.name })
                .unwrap_or_default(),
        ))
        .await;

    // Whatever the board is showing right now, so the guest sees something
    // immediately rather than waiting for the host to move something.
    if let Some(current) = hub.current() {
        let _ = sink
            .send(Message::Text(
                serde_json::to_string(&ToGuest::Board(current)).unwrap_or_default(),
            ))
            .await;
    }

    loop {
        tokio::select! {
            message = incoming.next() => {
                let Some(Ok(message)) = message else { break };
                let Message::Text(text) = message else { continue };
                let Ok(parsed) = serde_json::from_str::<FromGuest>(&text) else { continue };
                if handle_guest_message(&hub, guest_id, parsed, &mut streams, &events_tx, &mut sink)
                    .await
                    .is_err()
                {
                    break;
                }
            }

            update = board_updates.recv() => {
                match update {
                    Ok(ToGuest::Closed { reason }) => {
                        let _ = sink
                            .send(Message::Text(
                                serde_json::to_string(&ToGuest::Closed { reason }).unwrap_or_default(),
                            ))
                            .await;
                        break;
                    }
                    Ok(update) => {
                        // A tile the host removed must stop streaming to guests
                        // straight away, not when they next scroll.
                        streams.retain(|_, stream| hub.source_allowed(&stream.source.to_string()));
                        if sink
                            .send(Message::Text(serde_json::to_string(&update).unwrap_or_default()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }

            event = events_rx.recv() => {
                let Some(event) = event else { continue };
                let StreamEvent::Frame(frame) = event else { continue };
                let flags = if frame.geometry_changed { FLAG_GEOMETRY_CHANGED } else { 0 };
                if sink
                    .send(Message::Binary(encode_frame(
                        frame.stream_id,
                        frame.seq,
                        frame.width,
                        frame.height,
                        flags,
                        &frame.jpeg,
                    )))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        }
    }

    drop(streams);
    hub.leave(guest_id);
    tracing::info!("guest {guest_id} left");
    let _ = sink.close().await;
}

async fn handle_guest_message(
    hub: &Arc<GuestHub>,
    guest_id: u64,
    message: FromGuest,
    streams: &mut HashMap<u32, Stream>,
    events_tx: &tokio::sync::mpsc::Sender<StreamEvent>,
    sink: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) -> Result<(), ()> {
    match message {
        FromGuest::Hello { name } => {
            // Re-joining under a name replaces the placeholder one.
            hub.leave(guest_id);
            let renamed = hub.join(name);
            let _ = sink
                .send(Message::Text(
                    serde_json::to_string(&GuestReply::Welcome {
                        id: guest_id,
                        name: &renamed.name,
                    })
                    .unwrap_or_default(),
                ))
                .await;
            Ok(())
        }

        FromGuest::Subscribe { stream_id, source, width, height, fps, quality } => {
            if !hub.source_allowed(&source) {
                return refuse(sink, "that tile is not on the board").await;
            }
            let spec = StreamSpec {
                width: width.min(GUEST_MAX_WIDTH),
                height: height.min(GUEST_MAX_HEIGHT),
                fps: if fps == 0 { 24 } else { fps.min(30) },
                quality: if quality == 0 { 80 } else { quality.min(92) },
            };

            if let Some(existing) = streams.get(&stream_id) {
                if existing.source.to_string() == source {
                    existing.retune(spec);
                    return Ok(());
                }
                streams.remove(&stream_id);
            }

            let Ok(parsed) = SourceId::parse(&source) else {
                return refuse(sink, "that is not a source").await;
            };
            match start_stream(&hub.engine, stream_id, parsed, spec, events_tx.clone()) {
                Ok(stream) => {
                    streams.insert(stream_id, stream);
                }
                Err(err) => {
                    tracing::warn!("guest {guest_id} could not open {source}: {err:#}");
                    return refuse(sink, "that tile is not available").await;
                }
            }
            Ok(())
        }

        FromGuest::Unsubscribe { stream_id } => {
            streams.remove(&stream_id);
            Ok(())
        }

        FromGuest::Pointer { x, y } => {
            // Not stored anywhere. A pointer is only interesting while it is
            // moving, and keeping the last position of everyone who ever joined
            // would be a small pile of nothing.
            if hub.powers().draw {
                hub.tell_host(ToHost::GuestPointer { id: guest_id, x, y });
            }
            Ok(())
        }

        FromGuest::Reaction { reaction } => {
            if is_reaction(&reaction) {
                hub.tell_host(ToHost::GuestReaction { id: guest_id, reaction });
            }
            Ok(())
        }

        FromGuest::Ink { stroke } => {
            if !hub.powers().draw {
                return refuse(sink, "drawing is off right now").await;
            }
            hub.tell_host(ToHost::GuestInk { id: guest_id, stroke });
            Ok(())
        }

        FromGuest::View { view } => {
            if hub.powers().roam {
                hub.note_view(guest_id, view);
            }
            Ok(())
        }

        FromGuest::File { name, mime, data_url } => {
            if !hub.powers().files {
                return refuse(sink, "dropping files is off right now").await;
            }
            // base64 is 4 bytes per 3, so cap the encoded form accordingly.
            if data_url.len() > MAX_GUEST_FILE_BYTES / 3 * 4 + 512 {
                return refuse(sink, "that file is too big").await;
            }
            if !mime.starts_with("image/") && mime != "application/pdf" {
                return refuse(sink, "images and PDFs only").await;
            }
            hub.tell_host(ToHost::GuestFile { id: guest_id, name, mime, data_url });
            Ok(())
        }

        FromGuest::Ping { .. } => Ok(()),
    }
}

async fn refuse(
    sink: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    message: &str,
) -> Result<(), ()> {
    sink.send(Message::Text(
        serde_json::to_string(&GuestReply::Refused { message }).unwrap_or_default(),
    ))
    .await
    .map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::CaptureEngine;
    use crate::guest::Powers;

    #[tokio::test]
    async fn binds_to_the_network_and_builds_a_shareable_link() {
        let hub = GuestHub::new(CaptureEngine::new());
        let server = start(hub.clone(), 0).await.unwrap();

        assert_ne!(server.addr.port(), 0);
        assert_eq!(server.addr.ip().to_string(), "0.0.0.0", "reachable from the network");
        assert!(server.url.contains(&server.token));
        assert!(server.url.starts_with("http://"));
        assert_eq!(server.token.len(), 16);
    }

    #[tokio::test]
    async fn the_page_is_refused_without_the_right_token() {
        let hub = GuestHub::new(CaptureEngine::new());
        hub.publish(serde_json::json!({ "tiles": [] }), serde_json::json!({}), Powers::default());
        let server = start(hub, 0).await.unwrap();
        let base = format!("127.0.0.1:{}", server.addr.port());

        let denied = get(&base, "/g/not-the-token").await;
        assert!(denied.contains("403"), "expected 403, got: {denied}");

        let missing = get(&base, "/nope").await;
        assert!(missing.contains("404"), "expected 404, got: {missing}");
    }

    #[tokio::test]
    async fn assets_cannot_be_used_to_read_the_disk() {
        let hub = GuestHub::new(CaptureEngine::new());
        let server = start(hub, 0).await.unwrap();
        let base = format!("127.0.0.1:{}", server.addr.port());

        for attempt in [
            "/assets/../../../../Windows/win.ini",
            "/assets/..%2f..%2fsecret",
        ] {
            let response = get(&base, attempt).await;
            assert!(
                response.contains("400") || response.contains("404"),
                "{attempt} should be refused, got: {response}"
            );
        }
    }

    #[tokio::test]
    async fn guest_pages_are_never_cached() {
        let hub = GuestHub::new(CaptureEngine::new());
        let server = start(hub, 0).await.unwrap();
        let base = format!("127.0.0.1:{}", server.addr.port());
        let response = get(&base, "/nope").await;
        assert!(response.to_lowercase().contains("cache-control: no-store"));
    }

    async fn get(host: &str, path: &str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(host).await.unwrap();
        let request =
            format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = Vec::new();
        let _ = stream.read_to_end(&mut response).await;
        String::from_utf8_lossy(&response).to_string()
    }
}
