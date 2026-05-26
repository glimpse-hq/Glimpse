fn main() {
    // Forward PostHog env vars from the workspace .env into compile-time env vars.
    // This lets analytics.rs use env!("POSTHOG_API_KEY") / env!("POSTHOG_HOST").
    let allowed_glimpse = [
        "GLIMPSE_FORCE_LICENSE_GATE",
        "GLIMPSE_POLAR_API_BASE",
        "GLIMPSE_POLAR_BENEFIT_COMMERCIAL",
        "GLIMPSE_POLAR_BENEFIT_CONTRIBUTOR",
        "GLIMPSE_POLAR_BENEFIT_FOUNDER",
        "GLIMPSE_POLAR_BENEFIT_PERSONAL",
        "GLIMPSE_POLAR_ORGANIZATION_ID",
    ];
    let workspace_env = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env");
    if let Ok(contents) = std::fs::read_to_string(&workspace_env) {
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim();
                if key == "POSTHOG_API_KEY"
                    || key == "POSTHOG_HOST"
                    || allowed_glimpse.contains(&key)
                {
                    println!("cargo:rustc-env={key}={value}");
                }
            }
        }
    }
    println!("cargo:rerun-if-changed=../.env");

    tauri_build::build()
}
