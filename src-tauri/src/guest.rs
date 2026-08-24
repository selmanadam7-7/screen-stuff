//! Guest links.
//!
//! A guest is not sent a video of the board. They are sent the board *document*
//! and the same source streams the engine is already producing, and they run the
//! same renderer. That is what makes free-roaming cheap: a guest who zooms into
//! one tile is just drawing the same document at a different view.
//!
//! Two rules hold this together:
//!
//!   * Guests live on their own listener, bound to the LAN, off by default, with
//!     a short shareable token that is not the local one.
//!   * A guest may only open sources that the currently published board actually
//!     uses. Without that, anyone with the link could ask for any monitor on the
//!     machine, whether it is on the board or not.

use crate::capture::CaptureEngine;
use anyhow::{Context as _, Result};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::broadcast;

/// What the cockpit last published for guests to render.
#[derive(Debug, Clone, Serialize)]
pub struct Publication {
    pub doc: serde_json::Value,
    pub frame: serde_json::Value,
    pub revision: u64,
    pub powers: Powers,
    #[serde(skip)]
    pub allowed: HashSet<String>,
}

/// What guests are allowed to do. Toggled live from the cockpit.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Powers {
    pub draw: bool,
    pub roam: bool,
    pub files: bool,
    /// Whether guests may put their own screen or camera on the board.
    ///
    /// Defaults off, unlike the others. Drawing and roaming affect what a guest
    /// sees; this puts a live picture from their machine onto yours, and that
    /// is a decision rather than a default.
    #[serde(default)]
    pub share: bool,
}

impl Default for Powers {
    fn default() -> Self {
        Self { draw: true, roam: true, files: true, share: false }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestInfo {
    pub id: u64,
    pub name: String,
    /// Where this guest is looking, if they have roamed off the frame.
    pub view: Option<serde_json::Value>,
}

/// Sent to every guest.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ToGuest {
    Board(Publication),
    /// The host revoked a power, or ended the session.
    Closed { reason: String },
}

/// Sent to the cockpit.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ToHost {
    GuestJoined { guest: GuestInfo },
    GuestLeft { id: u64 },
    GuestInk { id: u64, stroke: serde_json::Value },
    GuestFile { id: u64, name: String, mime: String, data_url: String },
    GuestView { id: u64, view: serde_json::Value },
    /// Where a guest is pointing, in board space.
    GuestPointer { id: u64, x: f64, y: f64 },
    /// A guest started sharing. `source` is a feed id, ready to be a tile.
    GuestShare { id: u64, name: String, source: String, kind: ShareKind },
    /// ...and stopped, or left.
    GuestShareEnded { id: u64, source: String },
    /// A guest reacting. One of a small fixed set, never arbitrary text.
    GuestReaction { id: u64, reaction: String },
}

/// What a guest may send.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum FromGuest {
    Hello { name: String },
    Ink { stroke: serde_json::Value },
    /// Where this guest is pointing. Sent often; carries no other state.
    Pointer { x: f64, y: f64 },
    /// A reaction. Validated against a fixed list on arrival.
    Reaction { reaction: String },
    View { view: serde_json::Value },
    File { name: String, mime: String, data_url: String },
    Subscribe { stream_id: u32, source: String, width: u32, height: u32, #[serde(default)] fps: u32, #[serde(default)] quality: u8 },
    Unsubscribe { stream_id: u32 },
    Ping { #[serde(default)] nonce: u64 },
    /// Start sharing a screen or a camera. The host decides the feed name.
    Share { kind: ShareKind },
    /// Stop one share. Leaving stops them all anyway.
    StopShare { kind: ShareKind },
}

pub struct GuestHub {
    published: RwLock<Option<Publication>>,
    guests: Mutex<HashMap<u64, GuestInfo>>,
    next_guest: AtomicU64,
    to_guests: broadcast::Sender<ToGuest>,
    to_host: broadcast::Sender<ToHost>,
    running: Mutex<Option<RunningGuestServer>>,
    pub engine: Arc<CaptureEngine>,
    /// Reads the app's own built assets. A release build has them embedded in
    /// the binary; a dev build has them on disk. The host installs whichever
    /// reader applies, so this module never has to care.
    web_reader: Mutex<Option<WebReader>>,
}

pub type WebReader = Arc<dyn Fn(&str) -> Option<Vec<u8>> + Send + Sync>;

pub struct RunningGuestServer {
    pub addr: SocketAddr,
    pub token: String,
    pub url: String,
    /// The same page with no toolbar, no roaming and no cursors: the shot, and
    /// nothing else, for anything that takes a browser source.
    pub output_url: String,
    shutdown: tokio::sync::oneshot::Sender<()>,
}

/// What a guest is sharing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShareKind {
    Screen,
    Camera,
}

impl ShareKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Screen => "screen",
            Self::Camera => "camera",
        }
    }
}

/// The feed name a guest's share publishes under.
///
/// Derived from the guest's id on *this* side, never taken from the message.
/// A guest that could name its own feed could publish to `cam-<host tile id>`
/// and replace the host's face on every screen in the call. There is no
/// legitimate reason for a guest to choose this string, so it never gets to.
pub fn share_feed_name(guest_id: u64, kind: ShareKind) -> String {
    format!("guest{guest_id}-{}", kind.label())
}

/// The largest file a guest may drop on the board, before base64 overhead.
pub const MAX_GUEST_FILE_BYTES: usize = 12 * 1024 * 1024;

impl GuestHub {
    pub fn new(engine: Arc<CaptureEngine>) -> Arc<Self> {
        Arc::new(Self {
            published: RwLock::new(None),
            guests: Mutex::new(HashMap::new()),
            next_guest: AtomicU64::new(1),
            to_guests: broadcast::channel(16).0,
            to_host: broadcast::channel(64).0,
            running: Mutex::new(None),
            engine,
            web_reader: Mutex::new(None),
        })
    }

    pub fn set_web_reader(&self, reader: WebReader) {
        *self.web_reader.lock() = Some(reader);
    }

    /// Read one of the app's own built files, by its path inside the bundle.
    pub fn read_web_file(&self, relative: &str) -> Option<Vec<u8>> {
        // Nothing outside the bundle is ever reachable, whatever a guest asks for.
        if relative.contains("..") || relative.contains('\\') {
            return None;
        }
        let reader = self.web_reader.lock().clone()?;
        reader(relative)
    }

    /// Store what guests should be rendering, and push it to them.
    pub fn publish(&self, doc: serde_json::Value, frame: serde_json::Value, powers: Powers) {
        let allowed = sources_in(&doc);
        let revision = self
            .published
            .read()
            .as_ref()
            .map(|p| p.revision + 1)
            .unwrap_or(1);
        let publication = Publication { doc, frame, revision, powers, allowed };
        *self.published.write() = Some(publication.clone());
        let _ = self.to_guests.send(ToGuest::Board(publication));
    }

    pub fn current(&self) -> Option<Publication> {
        self.published.read().clone()
    }

    /// A guest may only watch what the board is already showing.
    pub fn source_allowed(&self, source: &str) -> bool {
        self.published
            .read()
            .as_ref()
            .map(|p| p.allowed.contains(source))
            .unwrap_or(false)
    }

    pub fn powers(&self) -> Powers {
        self.published.read().as_ref().map(|p| p.powers).unwrap_or(Powers {
            draw: false,
            roam: false,
            files: false,
            share: false,
        })
    }

    pub fn subscribe_guests(&self) -> broadcast::Receiver<ToGuest> {
        self.to_guests.subscribe()
    }

    pub fn subscribe_host(&self) -> broadcast::Receiver<ToHost> {
        self.to_host.subscribe()
    }

    pub fn tell_host(&self, event: ToHost) {
        let _ = self.to_host.send(event);
    }

    /// Join without being a person.
    ///
    /// The output view is a video feed for a broadcast tool, not somebody in
    /// the room. It still needs an id, because streams are owned by one, but
    /// putting OBS in the roster would have the host looking at "2 watching"
    /// with one guest in the call.
    pub fn join_quietly(&self) -> GuestInfo {
        let id = self.next_guest.fetch_add(1, Ordering::Relaxed);
        GuestInfo { id, name: "Output".into(), view: None }
    }

    pub fn join(&self, name: String) -> GuestInfo {
        let id = self.next_guest.fetch_add(1, Ordering::Relaxed);
        let name = sanitise_name(&name, id);
        let guest = GuestInfo { id, name, view: None };
        self.guests.lock().insert(id, guest.clone());
        self.tell_host(ToHost::GuestJoined { guest: guest.clone() });
        guest
    }

    /// Give a guest the name they typed, keeping the id their socket knows.
    ///
    /// This used to be a `leave` followed by a `join`, which minted a *new* id
    /// while the connection carried on using the old one. Two things followed
    /// from that: the roster entry could no longer be found by the id anything
    /// else had, so a guest's name was unavailable to the rest of the server;
    /// and the `leave` on disconnect removed nothing, so everyone who ever set
    /// a name stayed in the host's guest list forever.
    pub fn rename(&self, id: u64, name: String) -> GuestInfo {
        let name = sanitise_name(&name, id);
        let info = {
            let mut guests = self.guests.lock();
            let entry =
                guests.entry(id).or_insert_with(|| GuestInfo { id, name: name.clone(), view: None });
            entry.name = name;
            entry.clone()
        };
        // The host reloads the roster on this, so re-announcing is how a rename
        // reaches the guest list without a message of its own.
        self.tell_host(ToHost::GuestJoined { guest: info.clone() });
        info
    }

    /// What this guest is called, for a label on the host's board.
    pub fn name_of(&self, id: u64) -> String {
        self.guests.lock().get(&id).map(|g| g.name.clone()).unwrap_or_else(|| "Guest".into())
    }

    pub fn leave(&self, id: u64) {
        if self.guests.lock().remove(&id).is_some() {
            self.tell_host(ToHost::GuestLeft { id });
        }
    }

    pub fn roster(&self) -> Vec<GuestInfo> {
        let mut all: Vec<GuestInfo> = self.guests.lock().values().cloned().collect();
        all.sort_by_key(|g| g.id);
        all
    }

    pub fn note_view(&self, id: u64, view: serde_json::Value) {
        if let Some(guest) = self.guests.lock().get_mut(&id) {
            guest.view = Some(view.clone());
        }
        self.tell_host(ToHost::GuestView { id, view });
    }

    pub fn is_running(&self) -> bool {
        self.running.lock().is_some()
    }

    pub fn link(&self) -> Option<String> {
        self.running.lock().as_ref().map(|r| r.url.clone())
    }

    /// The same board with nobody's furniture on it, for a broadcast tool.
    pub fn output_link(&self) -> Option<String> {
        self.running.lock().as_ref().map(|r| r.output_url.clone())
    }

    /// The loopback port the guest server listens on, for anything that needs
    /// to forward to it.
    pub fn port(&self) -> Option<u16> {
        self.running.lock().as_ref().map(|r| r.addr.port())
    }

    pub fn set_running(&self, server: RunningGuestServer) {
        *self.running.lock() = Some(server);
    }

    /// Stop accepting guests and disconnect everyone already here.
    pub fn stop(&self) {
        if let Some(server) = self.running.lock().take() {
            let _ = server.shutdown.send(());
        }
        let _ =
            self.to_guests.send(ToGuest::Closed { reason: "the host ended the session".into() });
        let ids: Vec<u64> = self.guests.lock().keys().copied().collect();
        for id in ids {
            self.leave(id);
        }
    }
}

/// Pulls every capture source referenced by a board document.
fn sources_in(doc: &serde_json::Value) -> HashSet<String> {
    let mut out = HashSet::new();
    if let Some(tiles) = doc.get("tiles").and_then(|t| t.as_array()) {
        for tile in tiles {
            if let Some(source) = tile.get("source").and_then(|s| s.as_str()) {
                out.insert(source.to_string());
            }
        }
    }
    out
}

/// Guest names end up on other people's screens, so they get trimmed and capped.
fn sanitise_name(raw: &str, id: u64) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| !c.is_control())
        .take(24)
        .collect::<String>()
        .trim()
        .to_string();
    if cleaned.is_empty() {
        format!("Guest {id}")
    } else {
        cleaned
    }
}

/// Everything a guest is allowed to react with.
///
/// A closed list rather than free text: a guest is a stranger holding a link,
/// and anything they send ends up drawn on the host's board.
pub const REACTIONS: [&str; 6] = ["yes", "no", "wow", "clap", "think", "here"];

pub fn is_reaction(value: &str) -> bool {
    REACTIONS.contains(&value)
}

/// The secret in a guest link.
///
/// Sixteen characters from a 31-symbol alphabet is about 79 bits. That is far
/// more than a link on your own wifi needs, and roughly what it needs once the
/// tunnel can put that same link on the internet — where the token is the only
/// thing between a stranger and every screen you own. It is copied, never
/// typed, so the extra length costs nothing.
///
/// The alphabet still leaves out `0/o`, `1/l/i`: a link does occasionally get
/// read down a phone.
pub fn guest_token() -> String {
    use rand::Rng;
    const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..16).map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char).collect()
}

/// The address a guest on the same network should use.
pub fn lan_address() -> Result<String> {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .context("this machine has no address on the local network")
}

impl RunningGuestServer {
    pub fn new(
        addr: SocketAddr,
        token: String,
        host: &str,
        shutdown: tokio::sync::oneshot::Sender<()>,
    ) -> Self {
        let url = format!("http://{host}:{}/g/{token}", addr.port());
        // Same token, deliberately: anyone holding the guest link can already
        // see everything, and the output view shows strictly less — no roaming,
        // no drawing, no other people.
        let output_url = format!("http://{host}:{}/o/{token}", addr.port());
        Self { addr, token, url, output_url, shutdown }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc_with(sources: &[&str]) -> serde_json::Value {
        serde_json::json!({
            "tiles": sources
                .iter()
                .map(|s| serde_json::json!({ "id": s, "kind": "source", "source": s }))
                .collect::<Vec<_>>()
        })
    }

    #[test]
    fn only_sources_on_the_board_are_reachable() {
        let hub = GuestHub::new(CaptureEngine::new());
        hub.publish(doc_with(&["monitor:1", "window:42"]), serde_json::json!({}), Powers::default());

        assert!(hub.source_allowed("monitor:1"));
        assert!(hub.source_allowed("window:42"));
        // The other three displays are not on the board, so a guest cannot ask for them.
        assert!(!hub.source_allowed("monitor:2"));
        assert!(!hub.source_allowed("window:999"));
    }

    #[test]
    fn nothing_is_reachable_before_anything_is_published() {
        let hub = GuestHub::new(CaptureEngine::new());
        assert!(!hub.source_allowed("monitor:1"));
        let powers = hub.powers();
        assert!(!powers.draw && !powers.roam && !powers.files);
    }

    #[test]
    fn removing_a_tile_revokes_access_to_its_source() {
        let hub = GuestHub::new(CaptureEngine::new());
        hub.publish(doc_with(&["monitor:1", "monitor:2"]), serde_json::json!({}), Powers::default());
        assert!(hub.source_allowed("monitor:2"));

        hub.publish(doc_with(&["monitor:1"]), serde_json::json!({}), Powers::default());
        assert!(!hub.source_allowed("monitor:2"), "taking a tile off the board cuts guests off");
    }

    #[test]
    fn revision_climbs_so_guests_can_tell_stale_from_fresh() {
        let hub = GuestHub::new(CaptureEngine::new());
        hub.publish(doc_with(&[]), serde_json::json!({}), Powers::default());
        let first = hub.current().unwrap().revision;
        hub.publish(doc_with(&[]), serde_json::json!({}), Powers::default());
        assert_eq!(hub.current().unwrap().revision, first + 1);
    }

    #[test]
    fn naming_yourself_keeps_the_id_your_socket_is_using() {
        // This used to leave and re-join, minting a new id while the connection
        // carried on using the old one -- so the disconnect removed nothing and
        // everyone who typed a name stayed in the guest list forever.
        let hub = GuestHub::new(CaptureEngine::new());
        let joined = hub.join(String::new());
        let renamed = hub.rename(joined.id, "Ada".into());
        assert_eq!(renamed.id, joined.id, "the id has to survive a rename");
        assert_eq!(renamed.name, "Ada");
        assert_eq!(hub.name_of(joined.id), "Ada");
        assert_eq!(hub.roster().len(), 1, "renaming does not add a second guest");

        hub.leave(joined.id);
        assert!(hub.roster().is_empty(), "and leaving actually removes them");
    }

    #[test]
    fn a_guest_can_never_name_the_feed_it_publishes_to() {
        // The attack this closes: a guest that chose its own feed name could
        // publish to the host's camera feed and replace the host's face on
        // every screen in the call. The name is derived from the guest id on
        // this side and the message carries nothing that reaches it.
        let mine = share_feed_name(3, ShareKind::Screen);
        assert_eq!(mine, "guest3-screen");
        assert_ne!(mine, share_feed_name(4, ShareKind::Screen), "two guests never collide");
        assert_ne!(
            mine,
            share_feed_name(3, ShareKind::Camera),
            "one guest's two shares never collide"
        );
        // And it can never be a host camera feed, whose names start with cam-.
        for id in [0u64, 1, 99, u64::MAX] {
            for kind in [ShareKind::Screen, ShareKind::Camera] {
                let name = share_feed_name(id, kind);
                assert!(name.starts_with("guest"), "{name}");
                assert!(!name.starts_with("cam-"), "{name}");
                // And it always parses as a feed, so it can become a tile.
                assert!(crate::sources::SourceId::parse(&format!("feed:{name}")).is_ok());
            }
        }
    }

    #[test]
    fn sharing_is_off_until_the_host_turns_it_on() {
        // Drawing and roaming change what a guest sees. This puts a live
        // picture from their machine onto yours, so it is not a default.
        assert!(!Powers::default().share);
        let hub = GuestHub::new(CaptureEngine::new());
        // And nothing published at all means nothing is permitted.
        assert!(!hub.powers().share);
    }

    #[test]
    fn powers_come_from_the_publication() {
        let hub = GuestHub::new(CaptureEngine::new());
        hub.publish(
            doc_with(&[]),
            serde_json::json!({}),
            Powers { draw: false, roam: true, files: false, share: true },
        );
        let powers = hub.powers();
        assert!(!powers.draw);
        assert!(powers.roam);
        assert!(!powers.files);
        assert!(powers.share);
    }

    #[test]
    fn guests_join_and_leave_the_roster() {
        let hub = GuestHub::new(CaptureEngine::new());
        let a = hub.join("Aaron".into());
        let b = hub.join("  ".into());
        assert_eq!(hub.roster().len(), 2);
        assert_eq!(a.name, "Aaron");
        assert_eq!(b.name, format!("Guest {}", b.id), "a blank name gets a real one");

        hub.leave(a.id);
        assert_eq!(hub.roster().len(), 1);
        hub.leave(a.id); // leaving twice is not an error
        assert_eq!(hub.roster().len(), 1);
    }

    #[test]
    fn names_are_trimmed_and_stripped_of_control_characters() {
        assert_eq!(sanitise_name("  Adam \n", 1), "Adam");
        assert_eq!(sanitise_name("a\u{0007}b", 1), "ab");
        assert_eq!(sanitise_name(&"x".repeat(200), 1).len(), 24);
        assert_eq!(sanitise_name("", 7), "Guest 7");
    }

    #[test]
    fn guest_tokens_are_short_readable_and_unique() {
        let a = guest_token();
        let b = guest_token();
        assert_eq!(a.len(), 16, "long enough to survive being on the internet");
        assert_ne!(a, b);
        // No characters that are ambiguous when read out loud.
        assert!(!a.contains(['0', 'o', 'l', '1', 'i']));
    }

    #[test]
    fn stopping_clears_the_roster() {
        let hub = GuestHub::new(CaptureEngine::new());
        hub.join("A".into());
        hub.join("B".into());
        hub.stop();
        assert!(hub.roster().is_empty());
        assert!(!hub.is_running());
    }
}
