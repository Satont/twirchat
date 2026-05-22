use std::env;
use std::process::ExitCode;
use twirchat_desktop_rust::runtime::{
    UpdateCheckMode, UpdateCheckRequest, UpdateRuntime, UpdateState, VelopackRuntimeStatus,
};

fn main() -> ExitCode {
    match parse_args(env::args().skip(1)) {
        Ok(request) => run_check(request),
        Err(error) => {
            eprintln!("{error}");
            eprintln!("usage: update-check [--mode packaged|unpackaged] [--feed <url-or-path>]");
            ExitCode::FAILURE
        }
    }
}

fn run_check(request: UpdateCheckRequest) -> ExitCode {
    let mut runtime = UpdateRuntime::new(UpdateState::default());
    let report = runtime.check_for_updates(&request);

    match serde_json::to_string_pretty(&report) {
        Ok(json) => println!("{json}"),
        Err(error) => {
            eprintln!("failed to serialize update report: {error}");
            return ExitCode::FAILURE;
        }
    }

    match report.runtime_status {
        VelopackRuntimeStatus::Error => ExitCode::from(2),
        _ => ExitCode::SUCCESS,
    }
}

fn parse_args(args: impl IntoIterator<Item = String>) -> Result<UpdateCheckRequest, String> {
    let mut mode = UpdateCheckMode::Packaged;
    let mut feed = None;
    let mut args = args.into_iter();

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--mode" => {
                let value = args
                    .next()
                    .ok_or_else(|| "--mode requires packaged or unpackaged".to_string())?;
                mode = match value.as_str() {
                    "packaged" => UpdateCheckMode::Packaged,
                    "unpackaged" => UpdateCheckMode::Unpackaged,
                    _ => return Err(format!("unknown update-check mode: {value}")),
                };
            }
            "--feed" => {
                feed = Some(
                    args.next()
                        .ok_or_else(|| "--feed requires a URL or path".to_string())?,
                );
            }
            "--help" | "-h" => {
                return Err("update-check checks the Velopack runtime safely".to_string());
            }
            _ => return Err(format!("unknown update-check argument: {arg}")),
        }
    }

    Ok(UpdateCheckRequest { mode, feed })
}
