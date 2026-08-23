//! The control API: everything the operator can do, available to anything else
//! on the machine.
//!
//! A person driving this app has both hands busy — they are presenting. The
//! Stream Deck under their left hand, the script that starts their stand-up, the
//! hotkey daemon they already live in: those should be able to cut to a scene,
//! raise a holding card or grab the current shot without anyone clicking
//! anything. That is all this is.
//!
//! **It is off until it is turned on.** A control surface that appears by itself
//! is a surprise, and this one can move what an audience sees. Settings turns it
//! on, and the token it hands out is the same one the scripts keep.
//!
//! Three things make it safe to leave running:
//!
//!   * **Loopback only.** It binds 127.0.0.1. The tunnel never touches it, so
//!     turning it on does not put a control surface on the internet — the guest
//!     server, which *is* public, has no route into here.
//!   * **A token on every request.** Persisted in settings rather than
//!     regenerated per launch, because a Stream Deck button that stops working
//!     every morning is not a Stream Deck button. It can be rolled from the UI.
//!   * **No browser may call it.** Every request carrying an `Origin` header is
//!     refused outright. curl, Python, Node, a Stream Deck plugin and a shell
//!     script send no such header; a web page cannot avoid sending one. That is
//!     the whole of the cross-site defence, and it costs one comparison.
//!
//! The cockpit is what actually executes an action, because the cockpit owns the
//! document — Rust would only be guessing at it. So a request becomes an event
//! to the cockpit and a reply comes back on the way out, which also means the
//! answer describes what really happened rather than what was asked for.
//!
//! Even `GET /` is answered by the cockpit: the list of actions is generated
//! from the same table that dispatches them, so the reference cannot drift from
//! the implementation.

use anyhow::{Context as _, Result};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine as _;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, oneshot};

/// How long a caller waits for the cockpit before being told it is not there.
///
/// Long enough for a webview that is mid-repaint, short enough that a wedged
/// cockpit does not hold a Stream Deck button down.
const REPLY_TIMEOUT: Duration = Duration::from_secs(4);

/// The port scripts can hard-code. Configurable, but the default has to be
/// stable or every example in the documentation is wrong on someone's machine.
pub const DEFAULT_PORT: u16 = 4488;

/// One thing the cockpit has been asked to do.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlRequest {
    pub id: u64,
    pub action: String,
    pub body: Value,
}

type Dispatch = Box<dyn Fn(ControlRequest) + Send + Sync>;

/// What went wrong, in the terms the caller cares about.
pub enum ControlError {
    /// Nothing is listening. The cockpit window is gone or still starting.
    NotAttached,
    /// It was listening and did not answer.
    TimedOut,
    /// It answered, and the answer was no.
    Refused(String),
}

impl IntoResponse for ControlError {
    fn into_response(self) -> Response {
        let (code, message) = match self {
            // 503 rather than 500: the request was fine, the app was not ready.
            Self::NotAttached => {
                (StatusCode::SERVICE_UNAVAILABLE, "the cockpit window is not running".to_string())
            }
            Self::TimedOut => {
                (StatusCode::GATEWAY_TIMEOUT, "the cockpit did not answer".to_string())
            }
            // The cockpit rejected it, which means the request was wrong.
            Self::Refused(why) => (StatusCode::BAD_REQUEST, why),
        };
        (code, Json(json!({ "ok": false, "error": message }))).into_response()
    }
}

/// Where the running server can be reached, for the UI to show and copy.
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ControlStatus {
    pub running: bool,
    pub port: u16,
    pub token: String,
    /// The origin, ready to paste into a terminal.
    pub url: String,
}

struct Running {
    port: u16,
    token: String,
    /// Dropped to stop the server.
    _shutdown: oneshot::Sender<()>,
}

/// The bridge between HTTP and the cockpit.
pub struct ControlHub {
    /// The last state the cockpit published, answered without a round trip.
    state: Mutex<Option<Value>>,
    dispatch: Mutex<Option<Dispatch>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    events: broadcast::Sender<Value>,
    seq: AtomicU64,
    running: Mutex<Option<Running>>,
}

impl Default for ControlHub {
    fn default() -> Self {
        // Enough room that a watcher which blinks does not miss a beat, small
        // enough that a watcher which has gone away does not pin state forever.
        let (events, _) = broadcast::channel(16);
        Self {
            state: Mutex::new(None),
            dispatch: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            events,
            seq: AtomicU64::new(1),
            running: Mutex::new(None),
        }
    }
}

impl ControlHub {
    /// Point the hub at whatever can reach the cockpit. Called once, at startup.
    pub fn attach(&self, dispatch: Dispatch) {
        *self.dispatch.lock() = Some(dispatch);
    }

    /// The cockpit's current state, pushed whenever it changes.
    pub fn publish(&self, state: Value) {
        *self.state.lock() = Some(state.clone());
        // Fails only when nobody is watching, which is the normal case.
        let _ = self.events.send(state);
    }

    pub fn snapshot(&self) -> Option<Value> {
        self.state.lock().clone()
    }

    /// The cockpit answering one request.
    pub fn resolve(&self, id: u64, result: Result<Value, String>) {
        if let Some(waiting) = self.pending.lock().remove(&id) {
            // The receiver is gone if the caller already timed out. Not an error.
            let _ = waiting.send(result);
        }
    }

    /// Ask the cockpit to do something, and wait for it to say what happened.
    pub async fn call(&self, action: &str, body: Value) -> Result<Value, ControlError> {
        let id = self.seq.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();

        {
            let dispatch = self.dispatch.lock();
            let Some(dispatch) = dispatch.as_ref() else {
                return Err(ControlError::NotAttached);
            };
            self.pending.lock().insert(id, tx);
            // Emitting an event is a queue push, not a round trip, so holding
            // the lock here costs nothing. Nothing below awaits while held.
            dispatch(ControlRequest { id, action: action.to_string(), body });
        }

        match tokio::time::timeout(REPLY_TIMEOUT, rx).await {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(why))) => Err(ControlError::Refused(why)),
            // The sender was dropped without a reply: the cockpit went away.
            Ok(Err(_)) => Err(ControlError::NotAttached),
            Err(_) => {
                self.pending.lock().remove(&id);
                Err(ControlError::TimedOut)
            }
        }
    }

    pub fn status(&self) -> ControlStatus {
        match self.running.lock().as_ref() {
            Some(running) => ControlStatus {
                running: true,
                port: running.port,
                token: running.token.clone(),
                url: format!("http://127.0.0.1:{}", running.port),
            },
            None => ControlStatus::default(),
        }
    }

    pub fn stop(&self) {
        // Dropping the sender closes the channel the server is waiting on.
        *self.running.lock() = None;
    }
}

#[derive(Clone)]
struct ApiState {
    hub: Arc<ControlHub>,
    token: Arc<str>,
}

/// Start listening. Replaces any server already running.
pub async fn start(hub: Arc<ControlHub>, port: u16, token: String) -> Result<ControlStatus> {
    hub.stop();

    let state = ApiState { hub: hub.clone(), token: Arc::from(token.as_str()) };
    let app = Router::new()
        .route("/", get(reference))
        .route("/state", get(state_now))
        .route("/sources", get(sources))
        .route("/shot", get(shot))
        .route("/events", get(events))
        .route("/:action", post(perform))
        .route_layer(middleware::from_fn_with_state(state.clone(), guard))
        .with_state(state);

    // Loopback, never 0.0.0.0. This is the difference between a control surface
    // for the machine and a control surface for the network.
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .with_context(|| format!("port {port} is already in use"))?;
    let bound = listener.local_addr().context("the control API has no address")?.port();

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    tokio::spawn(async move {
        let served = axum::serve(listener, app).with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        });
        if let Err(err) = served.await {
            tracing::error!("control API stopped: {err}");
        }
    });

    *hub.running.lock() =
        Some(Running { port: bound, token: token.clone(), _shutdown: shutdown_tx });
    tracing::info!("control API listening on 127.0.0.1:{bound}");
    Ok(hub.status())
}

/// A token, and nothing that has an origin.
async fn guard(State(state): State<ApiState>, request: Request, next: Next) -> Response {
    // A web page cannot suppress this header; nothing else sends it. Refusing it
    // means a page that somehow learned the token still cannot drive the app.
    if request.headers().contains_key(header::ORIGIN) {
        return refuse(
            StatusCode::FORBIDDEN,
            "the control API does not take requests from web pages",
        );
    }

    let headers = request.headers();
    let supplied = headers
        .get("x-control-token")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
        .or_else(|| {
            request
                .uri()
                .query()?
                .split('&')
                .find_map(|pair| pair.strip_prefix("token="))
                .map(str::to_string)
        });

    if supplied.as_deref() != Some(&*state.token) {
        return refuse(StatusCode::FORBIDDEN, "wrong or missing token");
    }
    next.run(request).await
}

fn refuse(code: StatusCode, why: &str) -> Response {
    (code, Json(json!({ "ok": false, "error": why }))).into_response()
}

/// The API describing itself, straight from the cockpit's dispatch table.
async fn reference(State(state): State<ApiState>) -> Result<Json<Value>, ControlError> {
    Ok(Json(state.hub.call("help", json!({})).await?))
}

/// What is on the board, without waking the cockpit for it.
async fn state_now(State(state): State<ApiState>) -> Response {
    match state.hub.snapshot() {
        Some(value) => Json(value).into_response(),
        None => ControlError::NotAttached.into_response(),
    }
}

/// What could be added. Answered by Rust, which is where the list comes from.
async fn sources() -> Json<Value> {
    Json(json!({
        "monitors": crate::sources::list_monitors(),
        "windows": crate::sources::list_windows(),
    }))
}

/// The stage, as a PNG, drawn by the same renderer the audience is watching.
async fn shot(State(state): State<ApiState>) -> Response {
    let answer = match state.hub.call("shot", json!({})).await {
        Ok(answer) => answer,
        Err(err) => return err.into_response(),
    };
    let Some(data_url) = answer.get("png").and_then(Value::as_str) else {
        return refuse(StatusCode::BAD_GATEWAY, "the cockpit sent no image");
    };
    let encoded = data_url.split(',').nth(1).unwrap_or(data_url);
    match base64::engine::general_purpose::STANDARD.decode(encoded) {
        Ok(bytes) => {
            // No caching: the whole point is that it is the shot right now.
            ([(header::CONTENT_TYPE, "image/png"), (header::CACHE_CONTROL, "no-store")], bytes)
                .into_response()
        }
        Err(_) => refuse(StatusCode::BAD_GATEWAY, "the cockpit sent a malformed image"),
    }
}

/// State, every time it changes, for anything that wants to light up a button.
async fn events(ws: WebSocketUpgrade, State(state): State<ApiState>) -> Response {
    ws.on_upgrade(move |socket| watch(socket, state.hub))
}

async fn watch(mut socket: WebSocket, hub: Arc<ControlHub>) {
    let mut feed = hub.events.subscribe();
    // Whatever is true now, so a watcher that connects mid-show is not blank
    // until the operator happens to touch something.
    if let Some(current) = hub.snapshot() {
        if socket.send(Message::Text(current.to_string())).await.is_err() {
            return;
        }
    }
    loop {
        match feed.recv().await {
            Ok(state) => {
                if socket.send(Message::Text(state.to_string())).await.is_err() {
                    return;
                }
            }
            // Fell behind. The next state is a full snapshot anyway, so there is
            // nothing to reconstruct — carry on from wherever we are.
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

/// Everything else: hand it to the cockpit and report what it did.
async fn perform(
    State(state): State<ApiState>,
    Path(action): Path<String>,
    body: Option<Json<Value>>,
) -> Result<Json<Value>, ControlError> {
    // A POST with no body is a legitimate way to say "take" or "punch out".
    let body = body.map(|Json(value)| value).unwrap_or_else(|| json!({}));
    Ok(Json(state.hub.call(&action, body).await?))
}

/// A token that survives restarts, so a script written once keeps working.
pub fn new_token() -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    use rand::Rng as _;
    let mut rng = rand::thread_rng();
    (0..32).map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read as _;

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()
    }

    #[test]
    fn a_hub_with_nothing_attached_says_so() {
        let hub = ControlHub::default();
        let answer = runtime().block_on(hub.call("stage", json!({})));
        assert!(matches!(answer, Err(ControlError::NotAttached)));
    }

    #[test]
    fn a_reply_reaches_the_caller() {
        let runtime = runtime();
        let hub = Arc::new(ControlHub::default());
        let seen = Arc::new(Mutex::new(Vec::<ControlRequest>::new()));

        // Stand in for the cockpit: record the request, then answer it.
        let answering = hub.clone();
        let recorder = seen.clone();
        hub.attach(Box::new(move |request| {
            recorder.lock().push(request.clone());
            answering.resolve(request.id, Ok(json!({ "ok": true, "did": request.action })));
        }));

        let answer = runtime.block_on(hub.call("layout", json!({ "layout": "grid" })));
        assert_eq!(answer.ok().unwrap()["did"], "layout");
        assert_eq!(seen.lock()[0].body["layout"], "grid");
    }

    #[test]
    fn a_cockpit_that_never_answers_times_out() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .start_paused(true)
            .build()
            .unwrap();
        let hub = ControlHub::default();
        hub.attach(Box::new(|_| {}));
        let answer = runtime.block_on(hub.call("take", json!({})));
        assert!(matches!(answer, Err(ControlError::TimedOut)));
        // And the request is not left sitting in the table forever.
        assert!(hub.pending.lock().is_empty());
    }

    #[test]
    fn a_refusal_carries_the_reason() {
        let runtime = runtime();
        let hub = Arc::new(ControlHub::default());
        let answering = hub.clone();
        hub.attach(Box::new(move |request| {
            answering.resolve(request.id, Err("there is no tile called that".into()));
        }));
        let answer = runtime.block_on(hub.call("tile", json!({ "name": "nope" })));
        match answer {
            Err(ControlError::Refused(why)) => assert!(why.contains("no tile")),
            _ => panic!("a refusal should say why"),
        }
    }

    #[test]
    fn two_requests_do_not_collect_each_other_s_answers() {
        let runtime = runtime();
        let hub = Arc::new(ControlHub::default());
        let held = Arc::new(Mutex::new(Vec::<ControlRequest>::new()));
        let recorder = held.clone();
        hub.attach(Box::new(move |request| recorder.lock().push(request)));

        let first = runtime.spawn({
            let hub = hub.clone();
            async move { hub.call("stage", json!({ "preset": "home" })).await.ok() }
        });
        let second = runtime.spawn({
            let hub = hub.clone();
            async move { hub.call("card", json!({ "preset": "brb" })).await.ok() }
        });

        // Answer them out of order, which is what a real cockpit will do the
        // moment one action is cheaper than another.
        runtime.block_on(async {
            while held.lock().len() < 2 {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        });
        let ids: Vec<u64> = held.lock().iter().map(|r| r.id).collect();
        hub.resolve(ids[1], Ok(json!({ "who": "card" })));
        hub.resolve(ids[0], Ok(json!({ "who": "stage" })));

        assert_eq!(runtime.block_on(first).unwrap().unwrap()["who"], "stage");
        assert_eq!(runtime.block_on(second).unwrap().unwrap()["who"], "card");
    }

    #[test]
    fn state_is_readable_without_the_cockpit_being_asked() {
        let hub = ControlHub::default();
        assert!(hub.snapshot().is_none());
        hub.publish(json!({ "stage": { "w": 1920 } }));
        assert_eq!(hub.snapshot().unwrap()["stage"]["w"], 1920);
    }

    #[test]
    fn watchers_hear_every_change() {
        let runtime = runtime();
        let hub = ControlHub::default();
        let mut feed = hub.events.subscribe();
        hub.publish(json!({ "n": 1 }));
        hub.publish(json!({ "n": 2 }));
        runtime.block_on(async {
            assert_eq!(feed.recv().await.unwrap()["n"], 1);
            assert_eq!(feed.recv().await.unwrap()["n"], 2);
        });
    }

    #[test]
    fn a_token_is_long_enough_to_be_worth_having() {
        let token = new_token();
        assert_eq!(token.len(), 32);
        assert_ne!(token, new_token());
    }

    /// The server, for real, over a socket.
    ///
    /// Everything below could be asserted against handlers directly, and none
    /// of it would prove the thing that matters: that the guard actually runs
    /// before the routes, on a real request, in the order axum assembles them.
    /// A middleware attached to the wrong layer type-checks and does nothing.
    fn serving() -> (tokio::runtime::Runtime, Arc<ControlHub>, String) {
        let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        let hub = Arc::new(ControlHub::default());

        // A cockpit that agrees to everything and says what it was asked.
        let answering = hub.clone();
        hub.attach(Box::new(move |request| {
            let answer = match request.action.as_str() {
                // One pixel, transparent. Enough to prove the decode.
                "shot" => json!({
                    "png": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                }),
                "boom" => {
                    answering.resolve(request.id, Err("nope".into()));
                    return;
                }
                _ => json!({ "did": request.action, "with": request.body }),
            };
            answering.resolve(request.id, Ok(answer));
        }));

        let token = "test-token".to_string();
        let status = runtime.block_on(start(hub.clone(), 0, token.clone())).unwrap();
        let base = format!("http://127.0.0.1:{}", status.port);
        (runtime, hub, base)
    }

    /// Status code and body, without ureq turning a 4xx into an error type.
    fn call(request: ureq::Request) -> (u16, String) {
        match request.call() {
            Ok(response) => (response.status(), response.into_string().unwrap_or_default()),
            Err(ureq::Error::Status(code, response)) => {
                (code, response.into_string().unwrap_or_default())
            }
            Err(err) => panic!("the request never got there: {err}"),
        }
    }

    #[test]
    fn the_token_is_the_whole_door() {
        let (_runtime, hub, base) = serving();
        hub.publish(json!({ "stage": { "w": 1920 } }));

        let (code, body) = call(ureq::get(&format!("{base}/state")));
        assert_eq!(code, 403, "no token, no answer");
        assert!(body.contains("token"), "and it says why: {body}");

        let (code, _) = call(ureq::get(&format!("{base}/state?token=wrong")));
        assert_eq!(code, 403);

        let (code, body) = call(ureq::get(&format!("{base}/state?token=test-token")));
        assert_eq!(code, 200);
        assert!(body.contains("1920"), "{body}");

        // The header is the tidier way to hold it, and works the same.
        let (code, _) = call(
            ureq::get(&format!("{base}/state")).set("x-control-token", "test-token"),
        );
        assert_eq!(code, 200);
    }

    #[test]
    fn a_web_page_is_turned_away_even_with_the_token() {
        let (_runtime, hub, base) = serving();
        hub.publish(json!({ "stage": {} }));
        // A page that has somehow learned the token still cannot use it: this
        // is the whole cross-site defence, so it is worth a real request.
        let (code, body) = call(
            ureq::get(&format!("{base}/state?token=test-token"))
                .set("origin", "https://somewhere.example"),
        );
        assert_eq!(code, 403);
        assert!(body.contains("web pages"), "{body}");
    }

    #[test]
    fn a_post_reaches_the_cockpit_and_comes_back_with_its_answer() {
        let (_runtime, _hub, base) = serving();
        let response = ureq::post(&format!("{base}/stage?token=test-token"))
            .set("content-type", "application/json")
            .send_string(&json!({ "preset": "everything" }).to_string())
            .unwrap();
        let body: Value = serde_json::from_str(&response.into_string().unwrap()).unwrap();
        assert_eq!(body["did"], "stage");
        assert_eq!(body["with"]["preset"], "everything");
    }

    #[test]
    fn a_post_with_no_body_at_all_still_works() {
        let (_runtime, _hub, base) = serving();
        // "take" and "punch out" are legitimately bodiless, and a Stream Deck
        // plugin that sends nothing should not get a 400 for it.
        let (code, body) = call(ureq::post(&format!("{base}/take?token=test-token")));
        assert_eq!(code, 200, "{body}");
        assert!(body.contains("take"));
    }

    #[test]
    fn a_refusal_from_the_cockpit_is_a_400_with_the_reason() {
        let (_runtime, _hub, base) = serving();
        let (code, body) = call(ureq::post(&format!("{base}/boom?token=test-token")));
        assert_eq!(code, 400);
        assert!(body.contains("nope"), "{body}");
    }

    #[test]
    fn the_shot_comes_back_as_an_image_rather_than_a_data_url() {
        let (_runtime, _hub, base) = serving();
        let response = ureq::get(&format!("{base}/shot?token=test-token")).call().unwrap();
        assert_eq!(response.content_type(), "image/png");
        let mut bytes = Vec::new();
        response.into_reader().read_to_end(&mut bytes).unwrap();
        // The PNG signature, so a base64 mistake cannot pass as an image.
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn state_is_there_before_anything_has_been_asked_of_the_cockpit() {
        let (_runtime, hub, base) = serving();
        // Nothing published yet: honest about not knowing rather than empty.
        let (code, _) = call(ureq::get(&format!("{base}/state?token=test-token")));
        assert_eq!(code, 503);

        hub.publish(json!({ "board": "Standup" }));
        let (code, body) = call(ureq::get(&format!("{base}/state?token=test-token")));
        assert_eq!(code, 200);
        assert!(body.contains("Standup"));
    }

    #[test]
    fn stopping_closes_the_door() {
        let (runtime, hub, base) = serving();
        hub.publish(json!({}));
        assert_eq!(call(ureq::get(&format!("{base}/state?token=test-token"))).0, 200);

        hub.stop();
        assert!(!hub.status().running);
        // The graceful shutdown is not instant; what matters is that it happens.
        runtime.block_on(async { tokio::time::sleep(Duration::from_millis(200)).await });
        let refused = ureq::get(&format!("{base}/state?token=test-token"))
            .timeout(Duration::from_millis(500))
            .call();
        assert!(refused.is_err(), "the port should be closed");
    }

    #[test]
    fn status_is_empty_until_something_is_listening() {
        let hub = ControlHub::default();
        let status = hub.status();
        assert!(!status.running);
        assert!(status.url.is_empty());
    }
}
