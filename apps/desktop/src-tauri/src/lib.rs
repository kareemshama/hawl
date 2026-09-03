mod hijri;
mod prices;
mod store;

use store::{StoreState, StoreStatus};
use tauri::Manager;

// --- Store -----------------------------------------------------------------

#[tauri::command]
fn store_status(state: tauri::State<'_, StoreState>) -> StoreStatus {
    state.status()
}

#[tauri::command]
fn store_create(passphrase: String, profile: serde_json::Value, state: tauri::State<'_, StoreState>) -> Result<(), String> {
    store::create(&state, &passphrase, &profile)
}

#[tauri::command]
fn store_unlock(passphrase: String, state: tauri::State<'_, StoreState>) -> Result<serde_json::Value, String> {
    store::unlock(&state, &passphrase)
}

#[tauri::command]
fn store_save(profile: serde_json::Value, state: tauri::State<'_, StoreState>) -> Result<(), String> {
    store::save(&state, &profile)
}

#[tauri::command]
fn store_lock(state: tauri::State<'_, StoreState>) {
    state.lock();
}

#[tauri::command]
fn store_change_passphrase(current: String, next: String, state: tauri::State<'_, StoreState>) -> Result<(), String> {
    store::change_passphrase(&state, &current, &next)
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
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app data directory unavailable");
            app.manage(StoreState::new(&data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store_status,
            store_create,
            store_unlock,
            store_save,
            store_lock,
            store_change_passphrase,
            fetch_prices,
            hijri_from_gregorian,
            hijri_to_gregorian,
            hijri_next_occurrence,
            hijri_previous_occurrence,
            hijri_month_names,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
