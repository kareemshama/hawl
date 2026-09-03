//! Live gold and silver spot prices with a fallback chain (SPEC.md section 6).
//!
//! Every source returns USD. If the profile currency is not USD, one FX call converts.
//! The result names its source so the audit trail can show where the number came from (R1.4).

use serde::{Deserialize, Serialize};
use std::time::Duration;

const TROY_OUNCE_GRAMS: f64 = 31.103_476_8;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MetalPrices {
    pub currency: String,
    pub gold_per_gram: f64,
    pub silver_per_gram: f64,
    pub as_of: String,
    pub source: String,
}

struct UsdPerOunce {
    gold: f64,
    silver: f64,
    as_of: String,
    source: &'static str,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("Hawl/0.1 (+https://github.com)")
        .build()
        .map_err(|e| format!("HTTP client: {e}"))
}

#[derive(Deserialize)]
struct GoldApiResponse {
    price: f64,
    #[serde(rename = "updatedAt")]
    updated_at: Option<String>,
}

async fn gold_api(client: &reqwest::Client) -> Result<UsdPerOunce, String> {
    async fn one(client: &reqwest::Client, symbol: &str) -> Result<GoldApiResponse, String> {
        client
            .get(format!("https://api.gold-api.com/price/{symbol}"))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json::<GoldApiResponse>()
            .await
            .map_err(|e| e.to_string())
    }
    let gold = one(client, "XAU").await?;
    let silver = one(client, "XAG").await?;
    Ok(UsdPerOunce {
        gold: gold.price,
        silver: silver.price,
        as_of: gold.updated_at.unwrap_or_else(today_iso),
        source: "gold-api.com",
    })
}

#[derive(Deserialize)]
struct SwissquoteQuote {
    #[serde(rename = "spreadProfilePrices")]
    spread_profile_prices: Vec<SwissquoteSpread>,
}

#[derive(Deserialize)]
struct SwissquoteSpread {
    bid: f64,
    ask: f64,
}

async fn swissquote(client: &reqwest::Client) -> Result<UsdPerOunce, String> {
    async fn one(client: &reqwest::Client, symbol: &str) -> Result<f64, String> {
        let quotes: Vec<SwissquoteQuote> = client
            .get(format!("https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/{symbol}/USD"))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let spread = quotes
            .first()
            .and_then(|q| q.spread_profile_prices.first())
            .ok_or_else(|| "Swissquote returned no quotes".to_string())?;
        Ok((spread.bid + spread.ask) / 2.0)
    }
    Ok(UsdPerOunce {
        gold: one(client, "XAU").await?,
        silver: one(client, "XAG").await?,
        as_of: today_iso(),
        source: "swissquote.com public feed",
    })
}

#[derive(Deserialize)]
struct FrankfurterResponse {
    rates: std::collections::HashMap<String, f64>,
    date: String,
}

async fn usd_to(client: &reqwest::Client, currency: &str) -> Result<(f64, String), String> {
    if currency.eq_ignore_ascii_case("USD") {
        return Ok((1.0, String::new()));
    }
    let resp: FrankfurterResponse = client
        .get(format!("https://api.frankfurter.dev/v1/latest?base=USD&symbols={currency}"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("FX lookup for {currency} failed: {e}"))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let rate = resp
        .rates
        .get(&currency.to_ascii_uppercase())
        .copied()
        .ok_or_else(|| format!("No FX rate for {currency}"))?;
    Ok((rate, format!(", USD->{currency} via frankfurter.dev ({})", resp.date)))
}

pub async fn fetch(currency: &str) -> Result<MetalPrices, String> {
    let client = client()?;
    let mut errors = Vec::new();

    let usd = match gold_api(&client).await {
        Ok(p) => Some(p),
        Err(e) => {
            errors.push(format!("gold-api.com: {e}"));
            match swissquote(&client).await {
                Ok(p) => Some(p),
                Err(e) => {
                    errors.push(format!("swissquote: {e}"));
                    None
                }
            }
        }
    };
    let usd = usd.ok_or_else(|| format!("All price sources failed. {}", errors.join(" | ")))?;

    let (fx, fx_note) = usd_to(&client, currency).await?;
    let round = |v: f64| (v * 10_000.0).round() / 10_000.0;
    Ok(MetalPrices {
        currency: currency.to_ascii_uppercase(),
        gold_per_gram: round(usd.gold / TROY_OUNCE_GRAMS * fx),
        silver_per_gram: round(usd.silver / TROY_OUNCE_GRAMS * fx),
        as_of: usd.as_of.chars().take(10).collect(),
        source: format!("{}{}", usd.source, fx_note),
    })
}

fn today_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, m, d) = crate::hijri::civil_from_days(secs.div_euclid(86_400));
    format!("{y:04}-{m:02}-{d:02}")
}
