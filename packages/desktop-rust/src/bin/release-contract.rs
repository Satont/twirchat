use std::env;
use std::path::Path;
use std::process::ExitCode;
use twirchat::runtime::{
    PackagingTarget, VelopackPlanInput, plan_velopack_commands, render_velopack_simulation,
    validate_velopack_release_tag, verify_packaging_artifact,
};

const DEFAULT_REPOSITORY_URL: &str = "https://github.com/Satont/twirchat";

fn main() -> ExitCode {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let Some(first) = args.first() else {
        print_usage();
        return ExitCode::FAILURE;
    };

    match first.as_str() {
        "velopack-plan" => run_velopack_plan(&args[1..]),
        "verify-artifact" => run_verify_artifact(&args[1..]),
        tag => print_release_contract(tag, &args[1..]),
    }
}

fn print_usage() {
    eprintln!("usage: release-contract <stable-tag>");
    eprintln!(
        "       release-contract velopack-plan <stable-tag> [--repo-url <url>] [--artifact-root <dir>] [--first-release] [--existing-asset <name>] [--existing-assets <csv>]"
    );
    eprintln!(
        "       release-contract verify-artifact <path> --target <linux-x64|win-x64|macos-universal>"
    );
}

fn print_release_contract(tag: &str, trailing_args: &[String]) -> ExitCode {
    if !trailing_args.is_empty() {
        eprintln!(
            "release-contract <stable-tag> accepts exactly one argument; unexpected extra args: {}",
            trailing_args.join(" ")
        );
        return ExitCode::FAILURE;
    }

    match validate_velopack_release_tag(tag) {
        Ok(release) => match serde_json::to_string_pretty(&release) {
            Ok(json) => {
                println!("{json}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("failed to serialize release contract: {error}");
                ExitCode::FAILURE
            }
        },
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn run_verify_artifact(args: &[String]) -> ExitCode {
    let Some(path) = args.first() else {
        eprintln!(
            "usage: release-contract verify-artifact <path> --target <linux-x64|win-x64|macos-universal>"
        );
        return ExitCode::FAILURE;
    };

    let mut target = None;
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--target" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--target requires a value");
                    return ExitCode::FAILURE;
                };
                let Some(parsed) = PackagingTarget::from_cli_value(value) else {
                    eprintln!(
                        "invalid --target value '{value}'; expected one of linux-x64, win-x64, macos-universal"
                    );
                    return ExitCode::FAILURE;
                };
                target = Some(parsed);
                index += 2;
            }
            unknown => {
                eprintln!("unknown option for verify-artifact: {unknown}");
                return ExitCode::FAILURE;
            }
        }
    }

    let Some(target) = target else {
        eprintln!("verify-artifact requires --target <linux-x64|win-x64|macos-universal>");
        return ExitCode::FAILURE;
    };

    match verify_packaging_artifact(Path::new(path), target) {
        Ok(report) => match serde_json::to_string_pretty(&report) {
            Ok(json) => {
                println!("{json}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("failed to serialize packaging verification report: {error}");
                ExitCode::FAILURE
            }
        },
        Err(error) => {
            if let Some(report) = error.report()
                && let Ok(json) = serde_json::to_string_pretty(report)
            {
                eprintln!("{json}");
            }
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn run_velopack_plan(args: &[String]) -> ExitCode {
    let Some(tag) = args.first() else {
        print_usage();
        return ExitCode::FAILURE;
    };

    let mut repository_url = DEFAULT_REPOSITORY_URL.to_string();
    let mut artifact_root = "artifacts".to_string();
    let mut first_release = false;
    let mut existing_assets = Vec::new();
    let mut index = 1;

    while index < args.len() {
        match args[index].as_str() {
            "--repo-url" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--repo-url requires a value");
                    return ExitCode::FAILURE;
                };
                repository_url = value.clone();
                index += 2;
            }
            "--artifact-root" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--artifact-root requires a value");
                    return ExitCode::FAILURE;
                };
                artifact_root = value.clone();
                index += 2;
            }
            "--first-release" => {
                first_release = true;
                index += 1;
            }
            "--existing-asset" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--existing-asset requires a value");
                    return ExitCode::FAILURE;
                };
                existing_assets.push(value.clone());
                index += 2;
            }
            "--existing-assets" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--existing-assets requires a comma-separated value");
                    return ExitCode::FAILURE;
                };
                existing_assets.extend(
                    value
                        .split(',')
                        .map(str::trim)
                        .filter(|asset| !asset.is_empty())
                        .map(str::to_string),
                );
                index += 2;
            }
            unknown => {
                eprintln!("unknown option: {unknown}");
                return ExitCode::FAILURE;
            }
        }
    }

    let existing_asset_refs = existing_assets
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    let input = VelopackPlanInput {
        tag,
        repository_url: &repository_url,
        artifact_root: Path::new(&artifact_root),
        first_release,
        existing_assets: &existing_asset_refs,
    };

    match plan_velopack_commands(input) {
        Ok(plan) => {
            println!("{}", render_velopack_simulation(&plan));
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
