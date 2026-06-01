use std::env;
use std::fs;
use std::path::Path;
use std::path::PathBuf;

fn main() {
    if let Err(error) = run() {
        eprintln!("cargo:warning=build script failed: {error}");
        panic!("build script failed");
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let source_path = manifest_dir
        .parent()
        .and_then(Path::parent)
        .map(|root| root.join("packages/desktop/src/platforms/kick/badges.ts"))
        .ok_or("could not resolve workspace root for kick badges path")?;

    println!("cargo:rerun-if-changed={}", source_path.display());
    println!("cargo:rerun-if-changed=.env");
    println!("cargo:rerun-if-changed=.env.example");
    println!("cargo:rerun-if-env-changed=CHATRIX_BACKEND_URL");
    println!("cargo:rerun-if-env-changed=CHATRIX_BACKEND_WS_URL");
    println!("cargo:rerun-if-env-changed=NODE_ENV");
    println!("cargo:rerun-if-env-changed=AUTH_SERVER_PORT");
    println!("cargo:rerun-if-env-changed=OVERLAY_SERVER_PORT");
    println!("cargo:rerun-if-env-changed=TWIRCHAT_REQUIRE_BUILD_ENV");

    let source = fs::read_to_string(&source_path).map_err(|error| {
        format!(
            "failed to read kick badges source at {}: {error}",
            source_path.display()
        )
    })?;
    let out_dir = PathBuf::from(
        env::var("OUT_DIR").map_err(|_| "OUT_DIR is not set by cargo for build script")?,
    );

    write_build_runtime_config(&out_dir)
        .map_err(|error| format!("failed to write build runtime config: {error}"))?;

    let badge_types = [
        "broadcaster",
        "moderator",
        "subscriber",
        "verified",
        "founder",
        "vip",
    ];

    let mut generated = String::from(
        "pub fn generated_kick_badge_path(badge_type: &str) -> Option<&'static str> {\n    match badge_type {\n",
    );

    for badge_type in badge_types {
        if let Some(svg) = extract_badge_svg(&source, badge_type) {
            let file_name = format!("kick_badge_{badge_type}.svg");
            fs::write(out_dir.join(&file_name), &svg).map_err(|error| {
                format!("failed to write generated badge svg {file_name}: {error}")
            })?;
            generated.push_str(&format!(
                "        \"{badge_type}\" => Some(concat!(env!(\"OUT_DIR\"), \"/{file_name}\")),\n"
            ));
        }
    }

    generated.push_str("        _ => None,\n    }\n}\n");
    fs::write(out_dir.join("kick_badges_generated.rs"), generated)
        .map_err(|error| format!("failed to write generated kick badges file: {error}"))?;
    Ok(())
}

fn write_build_runtime_config(out_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let dotenv = load_dotenv(Path::new(".env"))?;
    let require_build_env = read_env_flag(&dotenv, "TWIRCHAT_REQUIRE_BUILD_ENV");

    let backend_url = read_env_or_dotenv(
        &dotenv,
        "CHATRIX_BACKEND_URL",
        "http://127.0.0.1:3000",
        require_build_env,
    )?;
    let backend_ws_url = read_env_or_dotenv(
        &dotenv,
        "CHATRIX_BACKEND_WS_URL",
        "ws://127.0.0.1:3000/ws",
        require_build_env,
    )?;
    let node_env = read_env_or_dotenv(&dotenv, "NODE_ENV", "production", false)?;
    let auth_server_port = read_port(&dotenv, "AUTH_SERVER_PORT", 45_821)?;
    let overlay_server_port = read_port(&dotenv, "OVERLAY_SERVER_PORT", 45_823)?;

    let auth_callback_base = format!("http://localhost:{auth_server_port}");
    let twitch_redirect_uri = format!("{auth_callback_base}/auth/twitch/callback");
    let youtube_redirect_uri = format!("{auth_callback_base}/auth/youtube/callback");
    let kick_redirect_uri = format!("{auth_callback_base}/auth/kick/callback");

    let generated = format!(
        concat!(
            "pub const DEFAULT_BACKEND_URL: &str = \"{}\";\n",
            "pub const DEFAULT_BACKEND_WS_URL: &str = \"{}\";\n",
            "pub const DEFAULT_NODE_ENV: &str = \"{}\";\n",
            "pub const DEFAULT_AUTH_SERVER_PORT: u16 = {};\n",
            "pub const DEFAULT_OVERLAY_SERVER_PORT: u16 = {};\n",
            "pub const AUTH_CALLBACK_BASE: &str = \"{}\";\n",
            "pub const TWITCH_REDIRECT_URI: &str = \"{}\";\n",
            "pub const YOUTUBE_REDIRECT_URI: &str = \"{}\";\n",
            "pub const KICK_REDIRECT_URI: &str = \"{}\";\n"
        ),
        escape_rust_string(&backend_url),
        escape_rust_string(&backend_ws_url),
        escape_rust_string(&node_env),
        auth_server_port,
        overlay_server_port,
        escape_rust_string(&auth_callback_base),
        escape_rust_string(&twitch_redirect_uri),
        escape_rust_string(&youtube_redirect_uri),
        escape_rust_string(&kick_redirect_uri),
    );

    fs::write(out_dir.join("build_runtime_config.rs"), generated)?;
    Ok(())
}

fn load_dotenv(path: &Path) -> Result<Vec<(String, String)>, Box<dyn std::error::Error>> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(path)?;
    let mut values = Vec::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };

        values.push((key.trim().to_string(), normalize_env_value(value.trim())));
    }

    Ok(values)
}

fn read_env_or_dotenv(
    dotenv: &[(String, String)],
    key: &str,
    default: &str,
    required: bool,
) -> Result<String, Box<dyn std::error::Error>> {
    let value = env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            dotenv
                .iter()
                .find(|(candidate, _)| candidate == key)
                .map(|(_, value)| value.clone())
                .filter(|value| !value.trim().is_empty())
        });

    match value {
        Some(value) => Ok(value),
        None if required => Err(format!("missing required build-time config: {key}").into()),
        None => Ok(default.to_string()),
    }
}

fn read_port(
    dotenv: &[(String, String)],
    key: &str,
    default: u16,
) -> Result<u16, Box<dyn std::error::Error>> {
    let value = read_env_or_dotenv(dotenv, key, &default.to_string(), false)?;
    let port = value.parse::<u16>()?;
    Ok(port)
}

fn read_env_flag(dotenv: &[(String, String)], key: &str) -> bool {
    matches!(
        read_env_or_dotenv(dotenv, key, "0", false)
            .unwrap_or_else(|_| "0".to_string())
            .as_str(),
        "1" | "true" | "TRUE"
    )
}

fn normalize_env_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let first = trimmed.chars().next().unwrap_or_default();
        let last = trimmed.chars().last().unwrap_or_default();
        if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }

    trimmed.to_string()
}

fn escape_rust_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn extract_badge_svg(source: &str, badge_type: &str) -> Option<String> {
    let marker = format!("{badge_type}: `");
    let start = source.find(&marker)? + marker.len();
    let rest = &source[start..];
    let end = rest.find('`')?;
    Some(rest[..end].to_string())
}
