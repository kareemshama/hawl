//! Profile store: one plain JSON file, `hawl.json`, in the app data directory.
//!
//! The profile is opaque JSON. The TypeScript side owns its schema, so the Rust side never has to
//! change when a field is added. Writes go to a temp file that is renamed into place, so a crash
//! never leaves a half-written store.

use serde::Serialize;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

pub struct StoreState {
    pub path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreStatus {
    pub exists: bool,
    pub path: String,
}

impl StoreState {
    pub fn new(data_dir: &Path) -> Self {
        Self { path: data_dir.join("hawl.json") }
    }

    pub fn status(&self) -> StoreStatus {
        StoreStatus {
            exists: self.path.exists(),
            path: self.path.display().to_string(),
        }
    }
}

/// Read the profile. `None` when no store has been written yet.
pub fn load(state: &StoreState) -> Result<Option<serde_json::Value>, String> {
    let bytes = match fs::read(&state.path) {
        Ok(b) => b,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Cannot read store: {e}")),
    };
    let profile = serde_json::from_slice(&bytes).map_err(|e| format!("Store file is not valid JSON: {e}"))?;
    Ok(Some(profile))
}

/// Write the profile atomically.
pub fn save(state: &StoreState, profile: &serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(profile).map_err(|e| format!("Cannot serialize profile: {e}"))?;
    if let Some(parent) = state.path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create data directory: {e}"))?;
    }
    let tmp = state.path.with_extension("json.tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("Cannot write store: {e}"))?;
    fs::rename(&tmp, &state.path).map_err(|e| format!("Cannot replace store: {e}"))?;
    Ok(())
}

/// Remove the store file. Succeeds when there is nothing to remove.
pub fn delete(state: &StoreState) -> Result<(), String> {
    match fs::remove_file(&state.path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Cannot delete store: {e}")),
    }
}
