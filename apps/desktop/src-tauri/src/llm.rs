//! Local AI for statements the heuristic parser cannot read.
//!
//! Same approach as Thaw: llama.cpp's `llama-server` and a small instruct model (Qwen2.5 3B,
//! Q4_K_M GGUF) are downloaded once into the app data directory, the server is spawned on demand
//! on localhost, and each statement page is sent to its OpenAI-compatible endpoint with a JSON
//! schema so the answer is always a well-formed table of rows. Nothing leaves the computer except
//! the one-time download.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

pub struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub file: &'static str,
    pub url: &'static str,
}

/// Models the app knows how to fetch. The 3B one runs anywhere; the 7B one is far more reliable
/// on dense pages but wants a graphics card.
pub const MODELS: &[ModelSpec] = &[
    ModelSpec {
        id: "3b",
        label: "Qwen2.5 3B Instruct, about 2 GB, runs on any computer",
        file: "qwen2.5-3b-instruct-q4_k_m.gguf",
        url: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
    },
    ModelSpec {
        id: "7b",
        label: "Qwen2.5 7B Instruct, about 4.7 GB, best with a graphics card",
        file: "qwen2.5-7b-instruct-q4_k_m.gguf",
        url: "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
    },
];
pub const LLAMA_SERVER_PORT: u16 = 39282;
const USER_AGENT: &str = "hawl/0.4";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelChoice {
    pub id: String,
    pub label: String,
    pub ready: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub engine_ready: bool,
    pub model_ready: bool,
    pub model: String,
    pub model_label: String,
    pub model_choices: Vec<ModelChoice>,
    pub gpu_detected: bool,
    pub cuda_build: bool,
    pub using_gpu: bool,
    pub running: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub stage: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: f64,
}

/// One transaction row as the model reports it.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiRow {
    pub date: String,
    pub description: String,
    pub amount: f64,
    #[serde(default)]
    pub balance: Option<f64>,
    /// The heading the row was printed under, as printed. The front end derives the sign from it.
    #[serde(default)]
    pub section: String,
}

/// What the model found on one page.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiPage {
    #[serde(default)]
    pub rows: Vec<AiRow>,
    /// The answer hit the output limit and was cut; the rows are what could be salvaged.
    #[serde(default)]
    pub truncated: bool,
    #[serde(default)]
    pub period_start: Option<String>,
    #[serde(default)]
    pub period_end: Option<String>,
    #[serde(default)]
    pub opening_balance: Option<f64>,
    #[serde(default)]
    pub closing_balance: Option<f64>,
}

pub struct LlmState {
    pub server_process: Mutex<Option<Child>>,
    pub force_cpu: Mutex<bool>,
}

impl LlmState {
    pub fn new() -> Self {
        Self { server_process: Mutex::new(None), force_cpu: Mutex::new(false) }
    }
}

pub fn data_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("app data directory unavailable")
}

fn model_file(data_dir: &Path, spec: &ModelSpec) -> PathBuf {
    data_dir.join("models").join(spec.file)
}

fn choice_file(data_dir: &Path) -> PathBuf {
    data_dir.join("ai.json")
}

/// The model in use: the saved choice, else 7B when an NVIDIA card is present, else 3B.
pub fn selected_model(data_dir: &Path) -> &'static ModelSpec {
    let saved = std::fs::read_to_string(choice_file(data_dir))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["model"].as_str().map(str::to_string));
    let id = saved.unwrap_or_else(|| if has_nvidia_gpu() { "7b".into() } else { "3b".into() });
    MODELS.iter().find(|m| m.id == id).unwrap_or(&MODELS[0])
}

pub fn set_model(data_dir: &Path, id: &str) -> Result<(), String> {
    let spec = MODELS.iter().find(|m| m.id == id).ok_or_else(|| format!("Unknown model {id}"))?;
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    std::fs::write(choice_file(data_dir), serde_json::json!({ "model": spec.id }).to_string()).map_err(|e| format!("Cannot save the model choice: {e}"))
}

fn model_path(data_dir: &Path) -> PathBuf {
    model_file(data_dir, selected_model(data_dir))
}

fn server_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("bin")
}

fn server_path(data_dir: &Path) -> PathBuf {
    let name = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };
    server_dir(data_dir).join(name)
}

fn has_nvidia_gpu() -> bool {
    let mut cmd = Command::new("nvidia-smi");
    cmd.stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.status().map(|s| s.success()).unwrap_or(false)
}

fn has_cuda_build(data_dir: &Path) -> bool {
    server_dir(data_dir).join(".cuda").exists()
}

fn is_running(state: &LlmState) -> bool {
    match state.server_process.lock() {
        Ok(mut guard) => match guard.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        },
        Err(_) => false,
    }
}

pub fn status(data_dir: &Path, state: &LlmState) -> AiStatus {
    let cuda_build = has_cuda_build(data_dir);
    let force_cpu = state.force_cpu.lock().map(|v| *v).unwrap_or(false);
    let spec = selected_model(data_dir);
    AiStatus {
        engine_ready: server_path(data_dir).exists(),
        model_ready: model_file(data_dir, spec).exists(),
        model: spec.id.to_string(),
        model_label: spec.label.to_string(),
        model_choices: MODELS
            .iter()
            .map(|m| ModelChoice { id: m.id.to_string(), label: m.label.to_string(), ready: model_file(data_dir, m).exists() })
            .collect(),
        gpu_detected: has_nvidia_gpu(),
        cuda_build,
        using_gpu: cuda_build && !force_cpu,
        running: is_running(state),
    }
}

async fn download_to_file(url: &str, dest: &Path, app: &AppHandle, stage: &str) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
    }
    let tmp = dest.with_extension("part");
    let client = reqwest::Client::builder().user_agent(USER_AGENT).build().map_err(|e| e.to_string())?;
    let response = client.get(url).send().await.map_err(|e| format!("Download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Download of {stage} returned HTTP {}", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut last_percent = -1.0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download interrupted: {e}"))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let percent = if total > 0 { downloaded as f64 / total as f64 * 100.0 } else { 0.0 };
        if percent - last_percent >= 0.5 || total == 0 {
            last_percent = percent;
            let _ = app.emit("ai-download-progress", DownloadProgress { stage: stage.to_string(), downloaded, total, percent });
        }
    }
    drop(file);
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    Ok(())
}

fn extract_zip_binaries(zip_path: &Path, bin_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let server_exe = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let wanted = name.ends_with(server_exe) || name.ends_with(".dll") || name.ends_with(".so") || name.ends_with(".dylib") || name.ends_with(".metal");
        if !wanted {
            continue;
        }
        let file_name = Path::new(&name).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        if file_name.is_empty() {
            continue;
        }
        let dest = bin_dir.join(&file_name);
        let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
        }
    }
    let _ = std::fs::remove_file(zip_path);
    Ok(())
}

fn asset_name(a: &serde_json::Value) -> String {
    a["name"].as_str().unwrap_or("").to_lowercase()
}

/// Is this the plain CPU build for the machine we are on? Asset names look like
/// `llama-b10816-bin-win-cpu-x64.zip`, `llama-b10816-bin-macos-arm64.tar.gz`,
/// `llama-b10816-bin-ubuntu-x64.zip`.
fn is_cpu_asset(n: &str) -> bool {
    if !n.starts_with("llama-") || n.contains("arm64") && !cfg!(target_os = "macos") {
        return false;
    }
    if cfg!(target_os = "windows") {
        n.contains("win") && n.contains("x64") && (n.contains("cpu") || n.contains("avx2")) && n.ends_with(".zip")
    } else if cfg!(target_os = "macos") {
        n.contains("macos") && n.contains(if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" })
    } else {
        (n.contains("linux") || n.contains("ubuntu")) && n.contains("x64") && n.ends_with(".zip")
    }
}

/// Windows CUDA build, e.g. `llama-b10816-bin-win-cuda-12.4-x64.zip`. The 12.x line is preferred
/// because it runs on older drivers; a 13.x build is used only when no 12.x one exists.
fn cuda_version(n: &str) -> Option<(u32, u32)> {
    if !n.starts_with("llama-") || !n.contains("win") || !n.contains("cuda") || !n.contains("x64") || n.contains("arm64") || !n.ends_with(".zip") {
        return None;
    }
    let v = n.split("cuda-").nth(1)?.split('-').next()?;
    let mut it = v.split('.');
    let major = it.next()?.parse().ok()?;
    let minor = it.next().and_then(|m| m.parse().ok()).unwrap_or(0);
    Some((major, minor))
}

/// Unpack the engine binary and its libraries from a zip or a tar.gz into `bin_dir`.
fn extract_archive(path: &Path, bin_dir: &Path) -> Result<(), String> {
    if path.extension().map(|e| e == "zip").unwrap_or(false) {
        return extract_zip_binaries(path, bin_dir);
    }
    // tar.gz (macOS releases): the system tar handles it; then flatten what we need.
    let tmp = bin_dir.join("unpack");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let ok = Command::new("tar").arg("-xzf").arg(path).arg("-C").arg(&tmp).status().map(|s| s.success()).unwrap_or(false);
    if !ok {
        return Err("Could not unpack the AI engine archive".into());
    }
    fn walk(dir: &Path, bin_dir: &Path) -> Result<(), String> {
        for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
            let p = entry.map_err(|e| e.to_string())?.path();
            if p.is_dir() {
                walk(&p, bin_dir)?;
                continue;
            }
            let name = p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
            if name == "llama-server" || name.ends_with(".dylib") || name.ends_with(".so") || name.ends_with(".metal") {
                std::fs::copy(&p, bin_dir.join(&name)).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
    walk(&tmp, bin_dir)?;
    let _ = std::fs::remove_dir_all(&tmp);
    let _ = std::fs::remove_file(path);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(bin_dir.join("llama-server"), std::fs::Permissions::from_mode(0o755));
    }
    Ok(())
}

pub async fn download_engine(data_dir: &Path, app: &AppHandle) -> Result<(), String> {
    let use_cuda = has_nvidia_gpu() && cfg!(target_os = "windows");
    let client = reqwest::Client::builder().user_agent(USER_AGENT).build().map_err(|e| e.to_string())?;
    // llama.cpp publishes its binaries as prereleases named after the build number; the release
    // marked "latest" can be a version tag with no binaries at all. Take the newest release that
    // actually carries a build for this machine.
    let releases: serde_json::Value = client
        .get("https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=15")
        .send()
        .await
        .map_err(|e| format!("Cannot reach GitHub for the AI engine: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Unexpected release listing: {e}"))?;
    let empty = Vec::new();
    let assets = releases
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .filter_map(|r| r["assets"].as_array())
        .find(|assets| assets.iter().any(|a| is_cpu_asset(&asset_name(a))))
        .ok_or("No llama.cpp build for this platform in the recent releases")?;
    let bin_dir = server_dir(data_dir);
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;

    let cuda = if use_cuda {
        let mut builds: Vec<(&serde_json::Value, (u32, u32))> = assets.iter().filter_map(|a| cuda_version(&asset_name(a)).map(|v| (a, v))).collect();
        // Newest 12.x first, then anything newer.
        builds.sort_by_key(|(_, (major, minor))| (if *major == 12 { 0 } else { 1 }, std::cmp::Reverse((*major, *minor))));
        builds.first().map(|(a, v)| (*a, *v))
    } else {
        None
    };

    if let Some((asset, (major, minor))) = cuda {
        let url = asset["browser_download_url"].as_str().ok_or("No download URL for the CUDA build")?;
        let zip_path = bin_dir.join("llama-server.zip");
        download_to_file(url, &zip_path, app, "AI engine (GPU build)").await?;
        extract_zip_binaries(&zip_path, &bin_dir)?;
        let tag = format!("cuda-{major}.{minor}");
        if let Some(cudart) = assets.iter().find(|a| {
            let n = asset_name(a);
            n.starts_with("cudart") && n.contains("win") && n.contains(&tag) && n.contains("x64") && !n.contains("arm64") && n.ends_with(".zip")
        }) {
            if let Some(url) = cudart["browser_download_url"].as_str() {
                let zip_path = bin_dir.join("cudart.zip");
                download_to_file(url, &zip_path, app, "CUDA runtime").await?;
                extract_zip_binaries(&zip_path, &bin_dir)?;
            }
        }
        let _ = std::fs::File::create(bin_dir.join(".cuda"));
    } else {
        let cpu = assets.iter().find(|a| is_cpu_asset(&asset_name(a))).ok_or("No llama.cpp build for this platform")?;
        let name = asset_name(cpu);
        let url = cpu["browser_download_url"].as_str().ok_or("No download URL for the CPU build")?;
        let archive = bin_dir.join(if name.ends_with(".zip") { "llama-server.zip" } else { "llama-server.tar.gz" });
        download_to_file(url, &archive, app, "AI engine").await?;
        extract_archive(&archive, &bin_dir)?;
    }

    if !server_path(data_dir).exists() {
        return Err("llama-server was not in the downloaded archive".into());
    }
    Ok(())
}

pub async fn download_model(data_dir: &Path, app: &AppHandle) -> Result<(), String> {
    let spec = selected_model(data_dir);
    download_to_file(spec.url, &model_file(data_dir, spec), app, "AI model").await
}

pub fn start_server(data_dir: &Path, state: &LlmState) -> Result<(), String> {
    let mut guard = state.server_process.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        if matches!(child.try_wait(), Ok(None)) {
            return Ok(());
        }
    }
    let server = server_path(data_dir);
    let model = model_path(data_dir);
    if !server.exists() || !model.exists() {
        return Err("The local AI is not set up yet. Open Settings and choose Set up local AI.".into());
    }
    let force_cpu = state.force_cpu.lock().map(|v| *v).unwrap_or(false);
    let gpu_layers = if has_cuda_build(data_dir) && !force_cpu { "99" } else { "0" };

    let mut cmd = Command::new(&server);
    cmd.current_dir(server_dir(data_dir))
        .arg("-m")
        .arg(&model)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(LLAMA_SERVER_PORT.to_string())
        .arg("-ngl")
        .arg(gpu_layers)
        .arg("--ctx-size")
        .arg("32768")
        .arg("--parallel")
        .arg("1")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let child = cmd.spawn().map_err(|e| format!("Cannot start the AI engine: {e}"))?;
    *guard = Some(child);
    Ok(())
}

pub async fn wait_for_server(state: &LlmState) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(std::time::Duration::from_secs(1))
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("http://127.0.0.1:{LLAMA_SERVER_PORT}/health");
    for _ in 0..180 {
        if !is_running(state) {
            return Err("The AI engine stopped right after starting. Another program may be using its port, or the graphics build could not load; in Settings, untick \"Use the graphics card\" and try again.".into());
        }
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                return Ok(());
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    Err("The AI engine did not start in time. The model loads on first use; try again in a moment.".into())
}

pub fn stop_server(state: &LlmState) {
    if let Ok(mut guard) = state.server_process.lock() {
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
    }
}

pub fn set_force_cpu(state: &LlmState, force: bool) {
    if let Ok(mut guard) = state.force_cpu.lock() {
        *guard = force;
    }
}

fn page_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "periodStart": { "type": ["string", "null"] },
            "periodEnd": { "type": ["string", "null"] },
            "openingBalance": { "type": ["number", "null"] },
            "closingBalance": { "type": ["number", "null"] },
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "date": { "type": "string" },
                        "description": { "type": "string" },
                        "amount": { "type": "number" },
                        "balance": { "type": ["number", "null"] },
                        "section": { "type": "string" }
                    },
                    "required": ["date", "description", "amount", "balance", "section"]
                }
            }
        },
        "required": ["periodStart", "periodEnd", "openingBalance", "closingBalance", "rows"]
    })
}

/// A reply cut off by the output limit: keep the rows that were complete and close the JSON.
fn salvage(cleaned: &str) -> Option<AiPage> {
    let rows_at = cleaned.find("\"rows\"")?;
    let open = rows_at + cleaned[rows_at..].find('[')?;
    let body = &cleaned[open + 1..];
    let mut candidate = String::from(&cleaned[..open + 1]);
    if let Some(last) = body.rfind('}') {
        candidate.push_str(&body[..=last]);
    }
    candidate.push_str("]}");
    let mut page: AiPage = serde_json::from_str(&candidate).ok()?;
    page.truncated = true;
    Some(page)
}

/// Ask the model for every transaction in one chunk of statement text (a page or part of one).
pub async fn extract_page(text: &str, period_start: Option<&str>, period_end: Option<&str>, previous_section: Option<&str>, currency: &str) -> Result<AiPage, String> {
    // The front end sends bounded chunks; this is only a guard for the context window.
    let text: String = text.chars().take(20000).collect();
    let period_hint = match (period_start, period_end) {
        (Some(s), Some(e)) => format!("The statement period is {s} to {e}. Dates printed without a year fall inside that period."),
        (Some(s), None) => format!("The statement period starts {s}. Dates printed without a year fall in or after that."),
        _ => "If the page states the statement period, report it; dates printed without a year fall inside that period.".to_string(),
    };
    let section_hint = match previous_section.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => format!(" The previous page ended under the heading \"{s}\"; rows at the top of this page that come before any new heading continue that section, so give them that section."),
        None => String::new(),
    };
    let prompt = format!(
        r#"You read bank and card statements. Below is the text of one page, or part of a page, of a statement in {currency}. List every transaction in it.

Rules:
- One entry per transaction, in the order printed. Keep the description as printed, trimmed. Never merge or skip rows, even when descriptions repeat.
- "date" is the transaction or posting date as YYYY-MM-DD. {period_hint}
- "amount" is negative for money leaving the account (withdrawals, purchases, payments made, checks, fees, "subtractions", "debits") and positive for money arriving (deposits, credits, refunds, interest earned, "additions"). Statements often group rows under headings such as "Deposits and other additions" or "Withdrawals and other subtractions"; the heading decides the sign for every row under it, even when the printed number has no sign.
- "section" is the heading the row is listed under, copied as printed (for example "Deposits and other additions", "Withdrawals and other subtractions", "Checks", "Service fees", "Payments and credits", "Purchases"), or "" when the page has no such headings.{section_hint}
- "balance" is the running balance printed on that same row, only when the page has a balance column. Never calculate one; when the row shows no balance, use null.
- Every section counts: rows under "Checks" (date, check number, amount) and under "Service fees" are transactions too, one entry each, with the check number or fee name as the description.
- Skip headings, column titles, subtotals, "Total ..." lines, summary boxes, interest-rate tables, and daily-balance tables that list only dates and balances with no description.
- "openingBalance" and "closingBalance" are the beginning and ending balances of the whole statement if this page states them, otherwise null. "periodStart" and "periodEnd" are the statement period as YYYY-MM-DD if stated here, otherwise null.
- If the page has no transactions, return an empty "rows" list.

Return only JSON matching the schema.

Page text:
---
{text}
---"#
    );

    let client = reqwest::Client::builder().no_proxy().timeout(std::time::Duration::from_secs(900)).build().map_err(|e| e.to_string())?;
    let quick = reqwest::Client::builder().no_proxy().timeout(std::time::Duration::from_secs(2)).build().map_err(|e| e.to_string())?;
    let health = format!("http://127.0.0.1:{LLAMA_SERVER_PORT}/health");
    for _ in 0..60 {
        if let Ok(resp) = quick.get(&health).send().await {
            if let Ok(h) = resp.json::<serde_json::Value>().await {
                let s = h["status"].as_str().unwrap_or("");
                if s == "ok" || s == "no slot available" {
                    break;
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    let body = serde_json::json!({
        "model": "local",
        "messages": [{ "role": "user", "content": prompt }],
        "temperature": 0.0,
        "max_tokens": 12000,
        "response_format": { "type": "json_schema", "json_schema": { "name": "statement_page", "schema": page_schema() } }
    });
    let url = format!("http://127.0.0.1:{LLAMA_SERVER_PORT}/v1/chat/completions");
    let raw = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("The AI engine did not answer: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Cannot read the AI answer: {e}"))?;
    let response: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("Unexpected AI reply: {e}"))?;
    if let Some(err) = response.get("error") {
        return Err(format!("AI engine error: {err}"));
    }
    let content = response["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "The AI returned nothing for this page.".to_string())?;
    let cut_off = response["choices"][0]["finish_reason"].as_str() == Some("length");
    let cleaned = content.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    match serde_json::from_str::<AiPage>(cleaned) {
        Ok(mut page) => {
            page.truncated |= cut_off;
            Ok(page)
        }
        Err(_) if cut_off => salvage(cleaned).ok_or_else(|| "The AI's answer for this page was cut off before any row was complete. Try again; if it keeps happening, the page is unusually dense.".to_string()),
        Err(e) => Err(format!("The AI answer was not valid JSON: {e}")),
    }
}
