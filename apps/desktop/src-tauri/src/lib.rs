mod hijri;
mod llm;
mod prices;
mod store;

use llm::{AiPage, AiStatus, LlmState};
use store::{StoreState, StoreStatus};
use tauri::Manager;

// --- Store -----------------------------------------------------------------

#[tauri::command]
fn store_status(state: tauri::State<'_, StoreState>) -> StoreStatus {
    state.status()
}

#[tauri::command]
fn store_load(state: tauri::State<'_, StoreState>) -> Result<Option<serde_json::Value>, String> {
    store::load(&state)
}

#[tauri::command]
fn store_save(profile: serde_json::Value, state: tauri::State<'_, StoreState>) -> Result<(), String> {
    store::save(&state, &profile)
}

#[tauri::command]
fn store_delete(state: tauri::State<'_, StoreState>) -> Result<(), String> {
    store::delete(&state)
}

// --- Local AI --------------------------------------------------------------

#[tauri::command]
fn ai_status(app: tauri::AppHandle, state: tauri::State<'_, LlmState>) -> AiStatus {
    llm::status(&llm::data_dir(&app), &state)
}

/// Download whatever is missing: the engine, the model, or both.
#[tauri::command]
async fn ai_setup(app: tauri::AppHandle, state: tauri::State<'_, LlmState>) -> Result<AiStatus, String> {
    let dir = llm::data_dir(&app);
    let before = llm::status(&dir, &state);
    if !before.engine_ready {
        llm::download_engine(&dir, &app).await?;
    }
    if !before.model_ready {
        llm::download_model(&dir, &app).await?;
    }
    Ok(llm::status(&dir, &state))
}

#[tauri::command]
async fn ai_extract_page(
    text: String,
    period_start: Option<String>,
    period_end: Option<String>,
    previous_section: Option<String>,
    currency: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, LlmState>,
) -> Result<AiPage, String> {
    llm::start_server(&llm::data_dir(&app), &state)?;
    llm::wait_for_server(&state).await?;
    llm::extract_page(&text, period_start.as_deref(), period_end.as_deref(), previous_section.as_deref(), &currency).await
}

/// Switch models. The chosen model is downloaded by `ai_setup` if it is not there yet.
#[tauri::command]
fn ai_set_model(id: String, app: tauri::AppHandle, state: tauri::State<'_, LlmState>) -> Result<AiStatus, String> {
    let dir = llm::data_dir(&app);
    llm::set_model(&dir, &id)?;
    llm::stop_server(&state);
    Ok(llm::status(&dir, &state))
}

#[tauri::command]
fn ai_set_gpu(enabled: bool, state: tauri::State<'_, LlmState>) {
    llm::set_force_cpu(&state, !enabled);
    // The next extraction restarts the engine with the new setting.
    llm::stop_server(&state);
}

// --- Prices ----------------------------------------------------------------

#[tauri::command]
async fn fetch_prices(currency: String) -> Result<prices::MetalPrices, String> {
    prices::fetch(&currency).await
}

// --- Hijri -----------------------------------------------------------------

#[tauri::command]
fn hijri_from_gregorian(date: String, adjust: i32) -> Result<hijri::HijriDate, String> {
    hijri::from_gregorian(&date, adjust)
}

#[tauri::command]
fn hijri_to_gregorian(year: i32, month: u8, day: u8, adjust: i32) -> Result<hijri::HijriDate, String> {
    hijri::to_gregorian(year, month, day, adjust)
}

#[tauri::command]
fn hijri_next_occurrence(month: u8, day: u8, from: String, adjust: i32) -> Result<hijri::HijriDate, String> {
    hijri::next_occurrence(month, day, &from, adjust)
}

#[tauri::command]
fn hijri_previous_occurrence(month: u8, day: u8, from: String, adjust: i32) -> Result<hijri::HijriDate, String> {
    hijri::previous_occurrence(month, day, &from, adjust)
}

#[tauri::command]
fn hijri_month_names() -> Vec<&'static str> {
    hijri::MONTH_NAMES.to_vec()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app data directory unavailable");
            app.manage(StoreState::new(&data_dir));
            app.manage(LlmState::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store_status,
            store_load,
            store_save,
            store_delete,
            ai_status,
            ai_setup,
            ai_extract_page,
            ai_set_gpu,
            ai_set_model,
            fetch_prices,
            hijri_from_gregorian,
            hijri_to_gregorian,
            hijri_next_occurrence,
            hijri_previous_occurrence,
            hijri_month_names,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            llm::stop_server(&handle.state::<LlmState>());
        }
    });
}
