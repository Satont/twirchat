use super::callback::{AuthCallback, error_page};
use crate::runtime::AUTH_CALLBACK_BASE;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};
use url::Url;

const CALLBACK_BUFFER_BYTES: usize = 8192;
const CALLBACK_ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(25);
const DEFAULT_CALLBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const DEFAULT_CALLBACK_READ_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) struct PendingOAuthCallback {
    pub(crate) callback: AuthCallback,
    pub(crate) stream: TcpStream,
}

pub(crate) fn wait_for_oauth_callback(
    platform_name: &'static str,
    expected_state: &str,
) -> Result<PendingOAuthCallback, String> {
    wait_for_oauth_callback_on_port(
        platform_name,
        expected_state,
        crate::runtime::DEFAULT_AUTH_SERVER_PORT,
        DEFAULT_CALLBACK_TIMEOUT,
        DEFAULT_CALLBACK_READ_TIMEOUT,
    )
}

pub(crate) fn write_callback_page(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
) -> Result<(), String> {
    let response = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status_reason(status),
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|error| error.to_string())
}

fn wait_for_oauth_callback_on_port(
    platform_name: &'static str,
    expected_state: &str,
    port: u16,
    accept_timeout: Duration,
    read_timeout: Duration,
) -> Result<PendingOAuthCallback, String> {
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let deadline = Instant::now() + accept_timeout;

    loop {
        match listener.accept() {
            Ok((stream, address)) => {
                println!(
                    "[{}/auth] accepted callback connection from {address}",
                    platform_name.to_lowercase()
                );
                stream
                    .set_read_timeout(Some(read_timeout))
                    .map_err(|error| error.to_string())?;
                return read_callback_request(platform_name, expected_state, stream);
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(format!(
                        "{platform_name} OAuth callback timed out after {} seconds",
                        accept_timeout.as_secs()
                    ));
                }
                thread::sleep(CALLBACK_ACCEPT_POLL_INTERVAL);
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn read_callback_request(
    platform_name: &'static str,
    expected_state: &str,
    mut stream: TcpStream,
) -> Result<PendingOAuthCallback, String> {
    let mut buffer = [0_u8; CALLBACK_BUFFER_BYTES];
    let read = stream.read(&mut buffer).map_err(|error| {
        if matches!(
            error.kind(),
            io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
        ) {
            format!("{platform_name} OAuth callback read timed out")
        } else {
            error.to_string()
        }
    })?;
    if read == 0 {
        return Err(String::from("Invalid callback request"));
    }

    let request = String::from_utf8_lossy(&buffer[..read]);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| String::from("Invalid callback request"))?;
    let url =
        Url::parse(&format!("{AUTH_CALLBACK_BASE}{path}")).map_err(|error| error.to_string())?;
    let callback = AuthCallback::from_url(&url).map_err(|error| error.to_string())?;
    println!(
        "[{}/auth] callback parsed: code_present={}, state_present={}",
        platform_name.to_lowercase(),
        !callback.code.is_empty(),
        !callback.state.is_empty()
    );
    if callback.state != expected_state {
        let page = error_page("OAuth state mismatch");
        write_callback_page(&mut stream, page.status, page.content_type, &page.body)?;
        return Err(format!("{platform_name} OAuth state mismatch"));
    }

    Ok(PendingOAuthCallback { callback, stream })
}

fn status_reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        500 => "Internal Server Error",
        _ => "OK",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_accept_times_out_without_browser_connection()
    -> Result<(), Box<dyn std::error::Error>> {
        let result = wait_for_oauth_callback_on_port(
            "Twitch",
            "state-1",
            0,
            Duration::from_millis(1),
            Duration::from_millis(1),
        );

        assert!(matches!(result, Err(message) if message.contains("timed out")));
        Ok(())
    }

    #[test]
    fn callback_read_times_out_for_stalled_client() -> Result<(), Box<dyn std::error::Error>> {
        let probe = TcpListener::bind(("127.0.0.1", 0))?;
        let port = probe.local_addr()?.port();
        drop(probe);
        let join = thread::spawn(move || {
            wait_for_oauth_callback_on_port(
                "Kick",
                "state-1",
                port,
                Duration::from_secs(1),
                Duration::from_millis(20),
            )
        });

        let connect_deadline = Instant::now() + Duration::from_secs(1);
        let _client = loop {
            match TcpStream::connect(("127.0.0.1", port)) {
                Ok(stream) => break stream,
                Err(error) if Instant::now() < connect_deadline => {
                    let _ = error;
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => return Err(error.into()),
            }
        };
        let result = join.join().map_err(|_| "callback thread panicked")?;

        assert!(matches!(result, Err(message) if message.contains("read timed out")));
        Ok(())
    }
}
