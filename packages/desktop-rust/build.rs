use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=../desktop/src/platforms/kick/badges.ts");

    let source_path = PathBuf::from("../desktop/src/platforms/kick/badges.ts");
    let source = fs::read_to_string(&source_path).expect("should read kick badges.ts");
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR should exist"));

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
            fs::write(out_dir.join(&file_name), &svg).expect("should write generated badge svg");
            generated.push_str(&format!(
                "        \"{badge_type}\" => Some(concat!(env!(\"OUT_DIR\"), \"/{file_name}\")),\n"
            ));
        }
    }

    generated.push_str("        _ => None,\n    }\n}\n");
    fs::write(out_dir.join("kick_badges_generated.rs"), generated)
        .expect("should write generated kick badges file");
}

fn extract_badge_svg(source: &str, badge_type: &str) -> Option<String> {
    let marker = format!("{badge_type}: `");
    let start = source.find(&marker)? + marker.len();
    let rest = &source[start..];
    let end = rest.find('`')?;
    Some(rest[..end].to_string())
}
