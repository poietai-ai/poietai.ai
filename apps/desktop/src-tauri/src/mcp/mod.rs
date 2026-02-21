mod server;
pub use server::{serve, McpState};

use std::net::TcpListener;

/// Bind an OS-assigned localhost port synchronously.
/// Call this in Tauri's setup() before the async runtime has full control.
pub fn bind() -> TcpListener {
    TcpListener::bind("127.0.0.1:0").expect("MCP: failed to bind port")
}

pub fn bound_port(listener: &TcpListener) -> u16 {
    listener.local_addr().expect("MCP: no local addr").port()
}
