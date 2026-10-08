use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager};

use crate::{AppRuntime, AppState, license, settings::SettingsStore, toast};

const KEY_NOTICE_STATE: &str = "notification_state";

const NOTICE_TRIAL_ENDING_SOON: &str = "trial_ending_soon";
const NOTICE_TRIAL_EXPIRED: &str = "trial_expired";
const NOTICE_LICENSE_INACTIVE: &str = "license_inactive";

const ENDING_SOON_DAYS: i64 = 2;
const QUIET_PERIOD_DAYS: i64 = 1;
const LIFETIME_TOAST_BUDGET: u32 = 3;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct NoticeRecord {
    #[serde(default)]
    shown_count: u32,
    #[serde(default)]
    last_shown_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct NoticeState {
    #[serde(default)]
    notices: BTreeMap<String, NoticeRecord>,
}

impl NoticeState {
    fn load(store: &SettingsStore) -> Self {
        store
            .read_app_value(KEY_NOTICE_STATE, NoticeState::default())
            .unwrap_or_else(|err| {
                tracing::warn!("Failed to read notice state, starting empty: {err}");
                NoticeState::default()
            })
    }

    fn save(&self, store: &SettingsStore) {
        if let Err(err) = store.write_app_value(KEY_NOTICE_STATE, self) {
            tracing::error!("Failed to persist notice state: {err}");
        }
    }

    fn has_shown(&self, id: &str) -> bool {
        self.notices.get(id).is_some_and(|r| r.shown_count > 0)
    }

    fn total_shown(&self) -> u32 {
        self.notices.values().map(|r| r.shown_count).sum()
    }

    fn last_shown_any(&self) -> Option<DateTime<Utc>> {
        self.notices
            .values()
            .filter_map(|r| r.last_shown_at.as_deref())
            .filter_map(parse_timestamp)
            .max()
    }

    fn mark_shown(&mut self, id: &str, now: DateTime<Utc>) {
        let record = self.notices.entry(id.to_string()).or_default();
        record.shown_count += 1;
        record.last_shown_at = Some(now.to_rfc3339());
    }

    fn clear(&mut self, id: &str) -> bool {
        self.notices.remove(id).is_some()
    }
}

pub(crate) fn parse_timestamp(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|ts| ts.with_timezone(&Utc))
}

pub fn last_notice_shown_at(store: &SettingsStore) -> Option<DateTime<Utc>> {
    NoticeState::load(store).last_shown_any()
}

// Refresh license analytics even when another toast suppresses the notice.
pub fn evaluate_after_use(app: &AppHandle<AppRuntime>, show_notice: bool) {
    if license::developer_license_bypass_active() {
        return;
    }

    let state = app.state::<AppState>();
    let store = state.settings_store.clone();

    let license_state = match license::get_license_state(&store) {
        Ok(state) => state,
        Err(err) => {
            tracing::warn!("Skipping trial notices, license state unavailable: {err}");
            return;
        }
    };
    crate::note_license_state(app, &state, &license_state);
    if !show_notice {
        return;
    }

    let now = Utc::now();
    let mut state = NoticeState::load(&store);

    if license_state.status == license::LicenseStatus::Active {
        if state.clear(NOTICE_LICENSE_INACTIVE) {
            state.save(&store);
        }
        return;
    }

    let Some(notice) = due_notice(&license_state, &state, now) else {
        return;
    };

    if !budget_allows(&state, &license_state, now) {
        return;
    }

    let (message, action_label) = notice_copy(app, notice, license_state.trial_days_remaining);
    toast::emit_toast(
        app,
        toast::Payload {
            toast_type: "info".to_string(),
            message,
            auto_dismiss: Some(true),
            duration: Some(9000),
            action: Some("open_account_page".to_string()),
            action_label: Some(action_label),
            ..Default::default()
        },
    );

    state.mark_shown(notice, now);
    state.save(&store);
}

fn due_notice(
    license_state: &license::LicenseState,
    state: &NoticeState,
    now: DateTime<Utc>,
) -> Option<&'static str> {
    if !license_state.trial_active {
        let notice = if license_state.display_key.is_some() {
            if !license_lapsed(license_state, now) {
                return None;
            }
            NOTICE_LICENSE_INACTIVE
        } else {
            NOTICE_TRIAL_EXPIRED
        };
        if !state.has_shown(notice) {
            return Some(notice);
        }
    }

    if license_state.trial_active
        && license_state.trial_days_remaining <= ENDING_SOON_DAYS
        && !state.has_shown(NOTICE_TRIAL_ENDING_SOON)
    {
        return Some(NOTICE_TRIAL_ENDING_SOON);
    }

    None
}

fn license_lapsed(license_state: &license::LicenseState, now: DateTime<Utc>) -> bool {
    if license_state.status == license::LicenseStatus::Invalid {
        return true;
    }

    license_state
        .expires_at
        .as_deref()
        .and_then(parse_timestamp)
        .is_some_and(|expires_at| expires_at <= now)
}

fn budget_allows(
    state: &NoticeState,
    license_state: &license::LicenseState,
    now: DateTime<Utc>,
) -> bool {
    if state.total_shown() >= LIFETIME_TOAST_BUDGET {
        return false;
    }

    if let Some(started_at) = parse_timestamp(&license_state.trial_started_at)
        && now < started_at + Duration::days(QUIET_PERIOD_DAYS)
    {
        return false;
    }

    if let Some(last) = state.last_shown_any()
        && now < last + Duration::days(1)
    {
        return false;
    }

    true
}

fn notice_copy(app: &AppHandle<AppRuntime>, notice: &str, days_remaining: i64) -> (String, String) {
    let see_options = || toast::native(app, "native.toast.see_options");
    match notice {
        NOTICE_LICENSE_INACTIVE => (
            toast::native(app, "native.toast.license_inactive"),
            toast::native(app, "native.toast.manage_license"),
        ),
        NOTICE_TRIAL_EXPIRED => (
            toast::native(app, "native.toast.trial_expired"),
            see_options(),
        ),
        _ if days_remaining <= 1 => (
            toast::native(app, "native.toast.trial_last_day"),
            see_options(),
        ),
        _ => (
            toast::native_format(
                app,
                "native.toast.trial_days_left",
                &[("days", &days_remaining.to_string())],
            ),
            see_options(),
        ),
    }
}
