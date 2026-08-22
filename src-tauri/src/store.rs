//! Board persistence.
//!
//! Boards are plain JSON on disk under the app data directory. The frontend owns
//! the document schema; Rust owns identity, naming, timestamps and atomic writes,
//! so a crash mid-save can never leave a half-written board behind.

use anyhow::{anyhow, Context as _, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BoardKind {
    /// A real board, tied to a call or a client.
    Board,
    /// A starting layout that spawns new boards.
    Template,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardMeta {
    pub id: String,
    pub name: String,
    pub kind: BoardKind,
    pub updated_at: u64,
    pub created_at: u64,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardRecord {
    #[serde(flatten)]
    pub meta: BoardMeta,
    /// Opaque to Rust: tiles, ink, scenes, frame — whatever the board window saves.
    pub doc: serde_json::Value,
}

pub struct Store {
    root: PathBuf,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Board ids end up in file names, so they get the paranoid treatment.
fn safe_id(id: &str) -> Result<&str> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(id)
    } else {
        Err(anyhow!("unsafe board id: {id:?}"))
    }
}

/// The directory everything of ours lives in: boards, settings, the tunnel helper.
///
/// The app was called Screen Drop before it was called Screen Stuff, and a
/// rename that silently abandons your saved boards is not a rename, it is data
/// loss with a new logo.
pub fn app_data_dir() -> Result<PathBuf> {
    let base = dirs::data_dir().ok_or_else(|| anyhow!("no application data directory"))?;
    let current = base.join(DATA_DIR_NAME);
    std::fs::create_dir_all(&current)
        .with_context(|| format!("could not create {}", current.display()))?;
    adopt_previous_data(&base.join(PREVIOUS_DATA_DIR_NAME), &current);
    Ok(current)
}

const DATA_DIR_NAME: &str = "screen-stuff";
const PREVIOUS_DATA_DIR_NAME: &str = "screen-drop";

/// Move anything from the old directory that the new one does not already have.
///
/// Entry by entry rather than renaming the whole directory, because the new one
/// may already exist and be nearly empty — created by a first launch that got as
/// far as writing one settings file. Renaming would fail there and the boards
/// would be stranded. Never overwrites: whatever is under the current name is
/// newer by definition, and a migration that clobbers live data is worse than
/// one that does nothing.
fn adopt_previous_data(previous: &Path, current: &Path) {
    if !previous.is_dir() || previous == current {
        return;
    }
    let entries = match std::fs::read_dir(previous) {
        Ok(entries) => entries,
        Err(err) => {
            tracing::warn!("could not read {}: {err}", previous.display());
            return;
        }
    };
    for entry in entries.flatten() {
        let target = current.join(entry.file_name());
        if target.exists() {
            continue;
        }
        match std::fs::rename(entry.path(), &target) {
            Ok(()) => tracing::info!("kept {} from the previous name", target.display()),
            // Not fatal. A missing board beats refusing to start, and the
            // original is still sitting where it was.
            Err(err) => tracing::warn!("could not move {}: {err}", entry.path().display()),
        }
    }
}


impl Store {
    pub fn new(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        std::fs::create_dir_all(root.join("boards"))
            .with_context(|| format!("could not create {}", root.display()))?;
        Ok(Self { root })
    }

    /// `%APPDATA%\screen-stuff` on Windows.
    pub fn default_location() -> Result<Self> {
        Self::new(app_data_dir()?)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn board_path(&self, id: &str) -> Result<PathBuf> {
        Ok(self.root.join("boards").join(format!("{}.json", safe_id(id)?)))
    }

    pub fn save(&self, mut record: BoardRecord) -> Result<BoardMeta> {
        safe_id(&record.meta.id)?;
        let path = self.board_path(&record.meta.id)?;
        if record.meta.created_at == 0 {
            record.meta.created_at = now_secs();
        }
        record.meta.updated_at = now_secs();

        let json = serde_json::to_vec_pretty(&record).context("could not serialise the board")?;
        write_atomic(&path, &json)?;
        Ok(record.meta)
    }

    pub fn load(&self, id: &str) -> Result<BoardRecord> {
        let path = self.board_path(id)?;
        let bytes = std::fs::read(&path)
            .with_context(|| format!("no board saved as {id}"))?;
        serde_json::from_slice(&bytes).with_context(|| format!("board {id} is not readable"))
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let path = self.board_path(id)?;
        if path.exists() {
            std::fs::remove_file(&path).with_context(|| format!("could not delete board {id}"))?;
        }
        Ok(())
    }

    /// Metadata for every saved board, newest first. Skips anything unreadable
    /// rather than failing the whole list.
    pub fn list(&self) -> Result<Vec<BoardMeta>> {
        let dir = self.root.join("boards");
        let mut out = Vec::new();
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return Ok(out);
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            match std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<BoardMeta>(&b).ok())
            {
                Some(meta) => out.push(meta),
                None => tracing::warn!("skipping unreadable board file {}", path.display()),
            }
        }
        out.sort_by_key(|board| std::cmp::Reverse(board.updated_at));
        Ok(out)
    }

    pub fn read_settings(&self) -> serde_json::Value {
        std::fs::read(self.root.join("settings.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    }

    pub fn write_settings(&self, value: &serde_json::Value) -> Result<()> {
        let json = serde_json::to_vec_pretty(value).context("could not serialise settings")?;
        write_atomic(&self.root.join("settings.json"), &json)
    }
}

/// Write to a sibling temp file, then rename. Rename is atomic on NTFS, so a
/// reader never sees a partial board.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)
        .with_context(|| format!("could not write {}", tmp.display()))?;
    std::fs::rename(&tmp, path)
        .with_context(|| format!("could not replace {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {

    #[test]
    fn data_from_the_previous_name_is_adopted() {
        let temp = tempfile::tempdir().expect("temp dir");
        let previous = temp.path().join("screen-drop");
        let current = temp.path().join("screen-stuff");
        std::fs::create_dir_all(previous.join("boards")).unwrap();
        std::fs::write(previous.join("boards").join("a.json"), b"{}").unwrap();
        std::fs::write(previous.join("settings.json"), b"{\"look\":\"graphite-dark\"}").unwrap();
        std::fs::create_dir_all(&current).unwrap();

        adopt_previous_data(&previous, &current);

        assert!(current.join("boards").join("a.json").is_file(), "the boards came across");
        assert!(current.join("settings.json").is_file(), "so did the settings");
    }

    #[test]
    fn migration_never_overwrites_what_is_already_there() {
        let temp = tempfile::tempdir().expect("temp dir");
        let previous = temp.path().join("screen-drop");
        let current = temp.path().join("screen-stuff");
        std::fs::create_dir_all(&previous).unwrap();
        std::fs::create_dir_all(&current).unwrap();
        std::fs::write(previous.join("settings.json"), b"old").unwrap();
        std::fs::write(current.join("settings.json"), b"new").unwrap();

        adopt_previous_data(&previous, &current);

        // Whatever is under the current name is newer by definition.
        assert_eq!(std::fs::read(current.join("settings.json")).unwrap(), b"new");
    }

    #[test]
    fn a_partly_created_new_directory_still_gets_the_old_boards() {
        // The case a whole-directory rename cannot handle: the new directory
        // already exists because something wrote one file into it.
        let temp = tempfile::tempdir().expect("temp dir");
        let previous = temp.path().join("screen-drop");
        let current = temp.path().join("screen-stuff");
        std::fs::create_dir_all(previous.join("boards")).unwrap();
        std::fs::write(previous.join("boards").join("pitch.json"), b"{}").unwrap();
        std::fs::create_dir_all(&current).unwrap();
        std::fs::write(current.join("settings.json"), b"{}").unwrap();

        adopt_previous_data(&previous, &current);

        assert!(current.join("boards").join("pitch.json").is_file());
    }

    #[test]
    fn nothing_to_adopt_is_not_an_error() {
        let temp = tempfile::tempdir().expect("temp dir");
        let current = temp.path().join("screen-stuff");
        std::fs::create_dir_all(&current).unwrap();
        adopt_previous_data(&temp.path().join("never-existed"), &current);
        assert!(current.is_dir());
    }

    use super::*;

    fn record(id: &str, name: &str, kind: BoardKind) -> BoardRecord {
        BoardRecord {
            meta: BoardMeta {
                id: id.into(),
                name: name.into(),
                kind,
                updated_at: 0,
                created_at: 0,
                note: String::new(),
            },
            doc: serde_json::json!({ "tiles": [] }),
        }
    }

    #[test]
    fn saves_and_loads_a_board() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path()).unwrap();

        let meta = store.save(record("disco-call", "Discovery call", BoardKind::Board)).unwrap();
        assert!(meta.created_at > 0, "created_at is stamped on first save");
        assert!(meta.updated_at > 0);

        let loaded = store.load("disco-call").unwrap();
        assert_eq!(loaded.meta.name, "Discovery call");
        assert_eq!(loaded.doc["tiles"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn created_at_survives_a_resave() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path()).unwrap();
        let first = store.save(record("b1", "One", BoardKind::Board)).unwrap();

        let mut again = store.load("b1").unwrap();
        again.meta.name = "One, renamed".into();
        let second = store.save(again).unwrap();

        assert_eq!(first.created_at, second.created_at, "creation time is not rewritten");
        assert_eq!(store.load("b1").unwrap().meta.name, "One, renamed");
    }

    #[test]
    fn lists_newest_first_and_includes_templates() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path()).unwrap();
        let mut older = record("old", "Older", BoardKind::Board);
        older.meta.updated_at = 1;
        store.save(older).unwrap();
        store.save(record("tmpl", "Strata training", BoardKind::Template)).unwrap();

        let list = store.list().unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].updated_at >= list[1].updated_at);
        assert!(list.iter().any(|m| m.kind == BoardKind::Template));
    }

    #[test]
    fn unreadable_files_are_skipped_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path()).unwrap();
        store.save(record("good", "Good", BoardKind::Board)).unwrap();
        std::fs::write(dir.path().join("boards").join("broken.json"), b"{ not json").unwrap();

        let list = store.list().unwrap();
        assert_eq!(list.len(), 1, "the good board still lists");
        assert_eq!(list[0].id, "good");
    }

    #[test]
    fn rejects_ids_that_would_escape_the_boards_directory() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path()).unwrap();
        for bad in ["../secrets", "a/b", "with space", "", "c:\\windows"] {
            assert!(store.load(bad).is_err(), "{bad:?} must be refused");
            assert!(store.save(record(bad, "x", BoardKind::Board)).is_err(), "{bad:?} must be refused");
        }
    }

    #[test]
    fn delete_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path()).unwrap();
        store.save(record("gone", "Gone", BoardKind::Board)).unwrap();
        store.delete("gone").unwrap();
        store.delete("gone").unwrap(); // deleting twice is fine
        assert!(store.load("gone").is_err());
    }

    #[test]
    fn settings_round_trip_and_default_to_empty() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path()).unwrap();
        assert_eq!(store.read_settings(), serde_json::json!({}));
        store.write_settings(&serde_json::json!({ "quality": 88 })).unwrap();
        assert_eq!(store.read_settings()["quality"], 88);
    }

    #[test]
    fn atomic_write_leaves_no_temp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path()).unwrap();
        store.save(record("x", "X", BoardKind::Board)).unwrap();
        let leftovers: Vec<_> = std::fs::read_dir(dir.path().join("boards"))
            .unwrap()
            .flatten()
            .filter(|e| e.path().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }
}
