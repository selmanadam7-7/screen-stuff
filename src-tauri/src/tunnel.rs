//! Getting a guest link off the local network.
//!
//! The guest server listens on this machine. On a call that is fine as long as
//! everyone is in the same building, and useless the moment they are not —
//! which is most calls. Reaching it from outside normally means port forwarding
//! and a static address, which is a router conversation nobody wants to have
//! before a meeting.
//!
//! So we borrow Cloudflare's quick tunnels instead. `cloudflared` dials *out*
//! to Cloudflare and gets back a public `https://….trycloudflare.com` address
//! that forwards to our loopback port. Outbound only, so it works behind NAT,
//! CGNAT, hotel wifi and a corporate firewall, and it needs no account, no
//! payment and no configuration.
//!
//! What that costs, stated plainly because it is a real trade:
//!
//! * The guest server becomes reachable from the internet while the tunnel is
//!   up. The token in the URL is the only thing between a stranger and the
//!   board, which is why that token is long, and why this is opt-in and
//!   stoppable from one button.
//! * The address is random and changes every session. That is a feature here —
//!   yesterday's link is dead — but it means the link has to be re-sent.
//! * Frames go through Cloudflare. They are already JPEG over TLS, but they are
//!   not end-to-end encrypted, and someone else's machine is carrying them.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use parking_lot::Mutex;
use serde::Serialize;

/// The official build. Only ever fetched over HTTPS from Cloudflare's own repo.
const DOWNLOAD_URL: &str =
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

/// Bounds for the sanity check on whatever comes back. The real binary is
/// around 40 MB; anything far outside this is a redirect page or an error.
const MIN_BYTES: usize = 5 * 1024 * 1024;
const MAX_BYTES: usize = 200 * 1024 * 1024;

/// How long to wait for Cloudflare to hand back an address before giving up.
const READY_TIMEOUT: Duration = Duration::from_secs(45);

/// Stops a console window flashing up when we spawn cloudflared. The app itself
/// is a windows-subsystem binary; a child that ignores that undoes the point.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatus {
    /// "off" | "preparing" | "starting" | "running" | "failed"
    pub state: String,
    /// The public origin, e.g. `https://xyz.trycloudflare.com`. Only when running.
    pub url: Option<String>,
    /// Something a person can read. Empty unless there is something to say.
    pub message: String,
}

impl Default for TunnelStatus {
    fn default() -> Self {
        Self { state: "off".into(), url: None, message: String::new() }
    }
}

impl TunnelStatus {
    fn of(state: &str, message: impl Into<String>) -> Self {
        Self { state: state.into(), url: None, message: message.into() }
    }
}

struct Running {
    child: Child,
    url: String,
}

#[derive(Default)]
pub struct Tunnel {
    running: Mutex<Option<Running>>,
    status: Mutex<TunnelStatus>,
}

impl Tunnel {
    pub fn status(&self) -> TunnelStatus {
        self.status.lock().clone()
    }

    fn set(&self, status: TunnelStatus) {
        *self.status.lock() = status;
    }

    /// The public origin, if one is live.
    pub fn url(&self) -> Option<String> {
        self.running.lock().as_ref().map(|r| r.url.clone())
    }

    /// Open a public address that forwards to `port` on loopback.
    ///
    /// Blocking: it may download ~40 MB the first time, then waits for
    /// Cloudflare to answer. Call it off the UI thread.
    pub fn start(&self, port: u16) -> Result<String> {
        if let Some(existing) = self.url() {
            return Ok(existing);
        }

        self.set(TunnelStatus::of("preparing", "getting the tunnel helper"));
        let exe = match ensure_cloudflared() {
            Ok(path) => path,
            Err(err) => {
                self.set(TunnelStatus::of("failed", format!("{err:#}")));
                return Err(err);
            }
        };

        self.set(TunnelStatus::of("starting", "asking Cloudflare for an address"));
        match spawn(&exe, port) {
            Ok((child, url)) => {
                *self.running.lock() = Some(Running { child, url: url.clone() });
                *self.status.lock() =
                    TunnelStatus { state: "running".into(), url: Some(url.clone()), message: String::new() };
                tracing::info!("tunnel open at {url}");
                Ok(url)
            }
            Err(err) => {
                self.set(TunnelStatus::of("failed", format!("{err:#}")));
                Err(err)
            }
        }
    }

    pub fn stop(&self) {
        if let Some(mut running) = self.running.lock().take() {
            let _ = running.child.kill();
            let _ = running.child.wait();
            tracing::info!("tunnel closed");
        }
        self.set(TunnelStatus::default());
    }
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        // A tunnel that outlives the app would keep a public door open onto a
        // server that is no longer there — or worse, onto the next thing to
        // take that port.
        if let Some(mut running) = self.running.get_mut().take() {
            let _ = running.child.kill();
        }
    }
}

/// Where we keep the downloaded helper.
///
/// The shared data directory, so a helper downloaded under the app's old name
/// is still there after the rename rather than being fetched again.
fn cache_path() -> Result<PathBuf> {
    Ok(crate::store::app_data_dir()?.join("cloudflared.exe"))
}

/// Find cloudflared, downloading it once if this machine has never needed it.
///
/// Checked in order: next to our own executable (so a future bundled copy wins),
/// our cache, then `PATH` (someone may already run it for other things).
fn ensure_cloudflared() -> Result<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let beside = dir.join("cloudflared.exe");
            if beside.is_file() {
                return Ok(beside);
            }
        }
    }

    let cached = cache_path()?;
    if cached.is_file() {
        return Ok(cached);
    }

    if let Some(found) = which_on_path("cloudflared.exe") {
        return Ok(found);
    }

    tracing::info!("downloading cloudflared to {}", cached.display());
    download(DOWNLOAD_URL, &cached).with_context(|| {
        format!(
            "could not download the tunnel helper. Check the connection, or put \
             cloudflared.exe at {}",
            cached.display()
        )
    })?;
    Ok(cached)
}

fn which_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|dir| dir.join(name)).find(|p| p.is_file())
}

/// Fetch to a temporary file, check it, then move it into place.
///
/// Downloading straight to the final path leaves a truncated file behind if the
/// connection drops, and every later run would treat that stub as the helper.
fn download(url: &str, target: &PathBuf) -> Result<()> {
    let response = ureq::get(url).timeout(Duration::from_secs(300)).call()?;

    let mut bytes = Vec::with_capacity(MIN_BYTES);
    response.into_reader().take(MAX_BYTES as u64 + 1).read_to_end(&mut bytes)?;

    if bytes.len() < MIN_BYTES || bytes.len() > MAX_BYTES {
        bail!("the download was {} bytes, which is not the helper", bytes.len());
    }
    // We cannot verify a signature without shipping a key, but we can refuse
    // anything that is not a Windows executable — which catches a captive
    // portal or an error page served with a 200.
    if !bytes.starts_with(b"MZ") {
        bail!("the download was not a Windows executable");
    }

    let temp = target.with_extension("part");
    {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }
    std::fs::rename(&temp, target)?;
    Ok(())
}

/// Start cloudflared and wait for it to announce an address.
fn spawn(exe: &PathBuf, port: u16) -> Result<(Child, String)> {
    let mut command = Command::new(exe);
    command
        .arg("tunnel")
        .arg("--no-autoupdate")
        .arg("--url")
        .arg(format!("http://127.0.0.1:{port}"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().context("could not start the tunnel helper")?;

    // cloudflared announces the address on stderr, inside a drawn box.
    let stderr = child.stderr.take().context("no stderr from the tunnel helper")?;
    let (tx, rx) = mpsc::channel::<String>();

    std::thread::spawn(move || {
        let mut sent = false;
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if !sent {
                if let Some(url) = find_tunnel_url(&line) {
                    sent = tx.send(url).is_ok();
                    continue;
                }
            }
            // Keep draining after the address arrives. A full pipe blocks the
            // child, and the tunnel would stall a few minutes in for no visible
            // reason.
            tracing::debug!(target: "cloudflared", "{line}");
        }
    });

    match rx.recv_timeout(READY_TIMEOUT) {
        Ok(url) => Ok((child, url)),
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            bail!("the tunnel helper did not report an address within {READY_TIMEOUT:?}")
        }
    }
}

/// Pull a `https://….trycloudflare.com` address out of a line of log noise.
///
/// A plain scan rather than a regex: it is one shape, it never changes, and the
/// line it arrives on is wrapped in box-drawing characters.
pub fn find_tunnel_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let rest = &line[start..];
    let end = rest
        .find(|c: char| c.is_whitespace() || c == '|' || c == '"')
        .unwrap_or(rest.len());
    let url = rest[..end].trim_end_matches(['/', '.', ',']);
    if url.ends_with(".trycloudflare.com") {
        Some(url.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_address_in_the_banner_cloudflared_actually_prints() {
        let line = "2024-01-01T00:00:00Z INF |  https://neat-forest-pause-quiet.trycloudflare.com   |";
        assert_eq!(
            find_tunnel_url(line).as_deref(),
            Some("https://neat-forest-pause-quiet.trycloudflare.com")
        );
    }

    #[test]
    fn finds_it_when_it_is_the_whole_line() {
        assert_eq!(
            find_tunnel_url("https://abc-def.trycloudflare.com").as_deref(),
            Some("https://abc-def.trycloudflare.com")
        );
    }

    #[test]
    fn ignores_every_other_url_cloudflared_logs() {
        // It logs its own docs and metrics endpoints on the way up; picking one
        // of those would hand out a link to Cloudflare's website.
        for line in [
            "INF Cannot determine default origin certificate path",
            "INF https://developers.cloudflare.com/cloudflare-one/",
            "INF Starting metrics server on 127.0.0.1:20241/metrics",
            "INF Registered tunnel connection connIndex=0",
        ] {
            assert_eq!(find_tunnel_url(line), None, "{line}");
        }
    }

    #[test]
    fn strips_trailing_punctuation_and_box_edges() {
        assert_eq!(
            find_tunnel_url("|  https://x-y-z.trycloudflare.com/  |").as_deref(),
            Some("https://x-y-z.trycloudflare.com")
        );
    }

    #[test]
    fn a_fresh_tunnel_is_off_and_has_no_address() {
        let tunnel = Tunnel::default();
        assert_eq!(tunnel.status().state, "off");
        assert!(tunnel.url().is_none());
    }

    #[test]
    fn stopping_a_tunnel_that_never_started_is_harmless() {
        let tunnel = Tunnel::default();
        tunnel.stop();
        assert_eq!(tunnel.status(), TunnelStatus::default());
    }

    #[test]
    fn a_failure_is_reported_rather_than_swallowed() {
        let tunnel = Tunnel::default();
        tunnel.set(TunnelStatus::of("failed", "no network"));
        let status = tunnel.status();
        assert_eq!(status.state, "failed");
        assert_eq!(status.message, "no network");
        assert!(status.url.is_none());
    }

    #[test]
    fn the_cache_sits_under_the_apps_own_data_directory() {
        let path = cache_path().expect("a data directory");
        assert!(path.ends_with("cloudflared.exe"));
        assert!(path.to_string_lossy().contains("screen-stuff"));
    }
}
