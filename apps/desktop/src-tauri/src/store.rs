//! Encrypted profile store.
//!
//! One file, `hawl.store`, in the app data directory:
//!   magic "HAWL1" | 16-byte Argon2id salt | 24-byte XChaCha20 nonce | ciphertext (JSON + Poly1305 tag)
//!
//! The profile itself is opaque JSON. The TypeScript side owns its schema, so the Rust side never
//! has to change when a field is added. The derived key lives in memory only while unlocked.

use argon2::Argon2;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAGIC: &[u8; 5] = b"HAWL1";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const KEY_LEN: usize = 32;

pub struct StoreState {
    pub path: PathBuf,
    pub key: Mutex<Option<[u8; KEY_LEN]>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreStatus {
    pub exists: bool,
    pub unlocked: bool,
    pub path: String,
}

impl StoreState {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join("hawl.store"),
            key: Mutex::new(None),
        }
    }

    pub fn status(&self) -> StoreStatus {
        StoreStatus {
            exists: self.path.exists(),
            unlocked: self.key.lock().map(|k| k.is_some()).unwrap_or(false),
            path: self.path.display().to_string(),
        }
    }

    pub fn lock(&self) {
        if let Ok(mut k) = self.key.lock() {
            *k = None;
        }
    }
}

fn derive_key(passphrase: &str, salt: &[u8]) -> Result<[u8; KEY_LEN], String> {
    let mut key = [0u8; KEY_LEN];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Key derivation failed: {e}"))?;
    Ok(key)
}

fn random_bytes<const N: usize>() -> Result<[u8; N], String> {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).map_err(|e| format!("Random generator unavailable: {e}"))?;
    Ok(buf)
}

fn write_encrypted(path: &Path, key: &[u8; KEY_LEN], salt: &[u8; SALT_LEN], plaintext: &[u8]) -> Result<(), String> {
    let nonce_bytes: [u8; NONCE_LEN] = random_bytes()?;
    let cipher = XChaCha20Poly1305::new(key.into());
    let nonce: &XNonce = (&nonce_bytes).into();
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {e}"))?;

    let mut out = Vec::with_capacity(MAGIC.len() + SALT_LEN + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create data directory: {e}"))?;
    }
    // Write to a temp file and rename so a crash never leaves a half-written store.
    let tmp = path.with_extension("store.tmp");
    fs::write(&tmp, &out).map_err(|e| format!("Cannot write store: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("Cannot replace store: {e}"))?;
    Ok(())
}

struct Parsed<'a> {
    salt: &'a [u8],
    nonce: &'a [u8],
    ciphertext: &'a [u8],
}

fn parse(bytes: &[u8]) -> Result<Parsed<'_>, String> {
    if bytes.len() < MAGIC.len() + SALT_LEN + NONCE_LEN + 16 || &bytes[..MAGIC.len()] != MAGIC {
        return Err("Store file is not a Hawl store or is corrupted.".into());
    }
    let salt_start = MAGIC.len();
    let nonce_start = salt_start + SALT_LEN;
    let ct_start = nonce_start + NONCE_LEN;
    Ok(Parsed {
        salt: &bytes[salt_start..nonce_start],
        nonce: &bytes[nonce_start..ct_start],
        ciphertext: &bytes[ct_start..],
    })
}

/// Create a new store. Refuses to overwrite an existing one.
pub fn create(state: &StoreState, passphrase: &str, profile: &serde_json::Value) -> Result<(), String> {
    if state.path.exists() {
        return Err("A store already exists. Unlock it instead.".into());
    }
    if passphrase.len() < 8 {
        return Err("Passphrase must be at least 8 characters.".into());
    }
    let salt: [u8; SALT_LEN] = random_bytes()?;
    let key = derive_key(passphrase, &salt)?;
    let plaintext = serde_json::to_vec(profile).map_err(|e| format!("Cannot serialize profile: {e}"))?;
    write_encrypted(&state.path, &key, &salt, &plaintext)?;
    *state.key.lock().map_err(|_| "Lock poisoned")? = Some(key);
    Ok(())
}

/// Unlock with a passphrase and return the decrypted profile.
pub fn unlock(state: &StoreState, passphrase: &str) -> Result<serde_json::Value, String> {
    let bytes = fs::read(&state.path).map_err(|e| format!("Cannot read store: {e}"))?;
    let parsed = parse(&bytes)?;
    let key = derive_key(passphrase, parsed.salt)?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let nonce = XNonce::try_from(parsed.nonce).map_err(|_| "Store nonce has the wrong length.".to_string())?;
    let plaintext = cipher
        .decrypt(&nonce, parsed.ciphertext)
        .map_err(|_| "Wrong passphrase, or the store is corrupted.".to_string())?;
    let profile: serde_json::Value =
        serde_json::from_slice(&plaintext).map_err(|e| format!("Store contents are not valid JSON: {e}"))?;
    *state.key.lock().map_err(|_| "Lock poisoned")? = Some(key);
    Ok(profile)
}

/// Save the profile with the key from the current unlocked session. Re-uses the on-disk salt
/// so the same passphrase keeps working; a fresh nonce is drawn every time.
pub fn save(state: &StoreState, profile: &serde_json::Value) -> Result<(), String> {
    let key = state
        .key
        .lock()
        .map_err(|_| "Lock poisoned")?
        .ok_or_else(|| "Store is locked.".to_string())?;
    let bytes = fs::read(&state.path).map_err(|e| format!("Cannot read store: {e}"))?;
    let parsed = parse(&bytes)?;
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(parsed.salt);
    let plaintext = serde_json::to_vec(profile).map_err(|e| format!("Cannot serialize profile: {e}"))?;
    write_encrypted(&state.path, &key, &salt, &plaintext)
}

/// Re-encrypt under a new passphrase. Requires the store to be unlocked.
pub fn change_passphrase(state: &StoreState, current: &str, next: &str) -> Result<(), String> {
    let profile = unlock(state, current)?;
    if next.len() < 8 {
        return Err("Passphrase must be at least 8 characters.".into());
    }
    let salt: [u8; SALT_LEN] = random_bytes()?;
    let key = derive_key(next, &salt)?;
    let plaintext = serde_json::to_vec(&profile).map_err(|e| format!("Cannot serialize profile: {e}"))?;
    write_encrypted(&state.path, &key, &salt, &plaintext)?;
    *state.key.lock().map_err(|_| "Lock poisoned")? = Some(key);
    Ok(())
}
