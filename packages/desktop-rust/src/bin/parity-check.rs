use std::env;
use std::path::Path;
use std::process::ExitCode;
use twirchat::parity::ParityMatrix;

fn main() -> ExitCode {
    let Some(path) = env::args().nth(1) else {
        eprintln!("usage: parity-check <matrix.json>");
        return ExitCode::FAILURE;
    };

    match ParityMatrix::from_path(Path::new(&path)).and_then(|matrix| {
        matrix
            .validate()
            .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })
    }) {
        Ok(summary) => {
            println!("parity matrix ok");
            println!(
                "counts: components={}, stores={}, rpc={}, overlay={}, settings={}, hotkeys={}, platform_capabilities={}, modals_popovers={}, failure_states={}",
                summary
                    .counts
                    .get(&twirchat::parity::SummaryBucket::Components)
                    .copied()
                    .unwrap_or_default(),
                summary
                    .counts
                    .get(&twirchat::parity::SummaryBucket::Stores)
                    .copied()
                    .unwrap_or_default(),
                summary
                    .counts
                    .get(&twirchat::parity::SummaryBucket::Rpc)
                    .copied()
                    .unwrap_or_default(),
                summary
                    .counts
                    .get(&twirchat::parity::SummaryBucket::Overlay)
                    .copied()
                    .unwrap_or_default(),
                summary
                    .counts
                    .get(&twirchat::parity::SummaryBucket::Settings)
                    .copied()
                    .unwrap_or_default(),
                summary
                    .counts
                    .get(&twirchat::parity::SummaryBucket::Hotkeys)
                    .copied()
                    .unwrap_or_default(),
                summary
                    .counts
                    .get(&twirchat::parity::SummaryBucket::PlatformCapabilities)
                    .copied()
                    .unwrap_or_default(),
                summary
                    .counts
                    .get(&twirchat::parity::SummaryBucket::ModalPopover)
                    .copied()
                    .unwrap_or_default(),
                summary
                    .counts
                    .get(&twirchat::parity::SummaryBucket::FailureStates)
                    .copied()
                    .unwrap_or_default(),
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
