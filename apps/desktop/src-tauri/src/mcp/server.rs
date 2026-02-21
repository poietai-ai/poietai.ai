// apps/desktop/src-tauri/src/mcp/server.rs

use std::{collections::HashMap, convert::Infallible, sync::Arc, time::Duration};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Emitter;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_stream::wrappers::ReceiverStream;

// ── Public types ─────────────────────────────────────────────────────────────

/// State held in AppState — provides `answer()` for the answer_agent command.
pub struct McpState {
    pub port: u16,
    pub(crate) pending_questions:
        Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
}

impl McpState {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            pending_questions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Deliver a reply to a waiting ask_human call.
    /// Returns Err if no question is pending for this agent_id.
    pub async fn answer(&self, agent_id: &str, reply: String) -> Result<(), String> {
        let tx = {
            let mut pending = self.pending_questions.lock().await;
            pending.remove(agent_id)
        };
        match tx {
            Some(sender) => sender
                .send(reply)
                .map_err(|_| "agent is no longer waiting".to_string()),
            None => Err(format!("no pending question for agent '{}'", agent_id)),
        }
    }
}

// ── Axum internal state ───────────────────────────────────────────────────────

type SseSender = mpsc::Sender<Result<Event, Infallible>>;

#[derive(Clone)]
struct ServerState {
    sessions: Arc<Mutex<HashMap<String, SseSender>>>,
    pending_questions: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    app: tauri::AppHandle,
}

#[derive(Deserialize)]
struct SessionQuery {
    #[serde(rename = "sessionId")]
    session_id: String,
}

// ── Entry point ───────────────────────────────────────────────────────────────

/// Serve the MCP HTTP/SSE server on the given std listener.
/// Call via tauri::async_runtime::spawn().
pub async fn serve(
    listener: std::net::TcpListener,
    pending_questions: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    app: tauri::AppHandle,
) {
    let state = ServerState {
        sessions: Arc::new(Mutex::new(HashMap::new())),
        pending_questions,
        app,
    };

    let router = Router::new()
        .route("/sse", get(sse_handler))
        .route("/message", post(message_handler))
        .with_state(state);

    let tokio_listener = tokio::net::TcpListener::from_std(listener)
        .expect("MCP: failed to convert listener");

    axum::serve(tokio_listener, router)
        .await
        .expect("MCP server crashed");
}

// ── SSE handler ───────────────────────────────────────────────────────────────

async fn sse_handler(
    State(state): State<ServerState>,
) -> Sse<ReceiverStream<Result<Event, Infallible>>> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(32);

    state.sessions.lock().await.insert(session_id.clone(), tx.clone());

    // Tell the client where to POST messages
    let _ = tx
        .send(Ok(Event::default()
            .event("endpoint")
            .data(format!("/message?sessionId={}", session_id))))
        .await;

    Sse::new(ReceiverStream::new(rx))
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

// ── Message handler ───────────────────────────────────────────────────────────

async fn message_handler(
    Query(SessionQuery { session_id }): Query<SessionQuery>,
    State(state): State<ServerState>,
    Json(body): Json<Value>,
) -> StatusCode {
    // Respond 202 immediately; send the JSON-RPC response over SSE async.
    tokio::spawn(async move {
        if let Some(resp) = handle_jsonrpc(&state, body).await {
            let data = serde_json::to_string(&resp).unwrap_or_default();
            let sessions = state.sessions.lock().await;
            if let Some(tx) = sessions.get(&session_id) {
                let _ = tx
                    .send(Ok(Event::default().event("message").data(data)))
                    .await;
            }
        }
    });

    StatusCode::ACCEPTED
}

// ── JSON-RPC dispatcher ───────────────────────────────────────────────────────

async fn handle_jsonrpc(state: &ServerState, body: Value) -> Option<Value> {
    let id = body.get("id").cloned();
    let method = body["method"].as_str()?;

    match method {
        "initialize" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "poietai", "version": "1.0.0" }
            }
        })),

        // Client signals ready — no response needed
        "notifications/initialized" => None,

        "tools/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "tools": [{
                    "name": "ask_human",
                    "description": "Ask the human a question and wait for their reply. Use when you need clarification that would meaningfully change your approach.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "question": {
                                "type": "string",
                                "description": "The question to ask"
                            },
                            "agent_id": {
                                "type": "string",
                                "description": "Your agent ID, exactly as given in your system prompt"
                            }
                        },
                        "required": ["question", "agent_id"]
                    }
                }]
            }
        })),

        "tools/call" => {
            let params = body.get("params")?;
            if params["name"].as_str()? != "ask_human" {
                return Some(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": "Unknown tool" }
                }));
            }

            let question = params["arguments"]["question"].as_str()?.to_string();
            let agent_id = params["arguments"]["agent_id"].as_str()?.to_string();

            let (tx, rx) = oneshot::channel::<String>();
            state
                .pending_questions
                .lock()
                .await
                .insert(agent_id.clone(), tx);

            let _ = state.app.emit(
                "agent-question",
                json!({ "agent_id": agent_id, "question": question }),
            );

            // Block until reply arrives or timeout (10 minutes)
            match tokio::time::timeout(Duration::from_secs(600), rx).await {
                Ok(Ok(reply)) => Some(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "content": [{ "type": "text", "text": reply }],
                        "isError": false
                    }
                })),
                Ok(Err(_)) => Some(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32001, "message": "Reply channel closed (app may have been closed)" }
                })),
                Err(_) => Some(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32002, "message": "Timed out waiting for human reply (10 minutes)" }
                })),
            }
        }

        _ => None,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use serde_json::json;

    fn initialize_response(id: serde_json::Value) -> serde_json::Value {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "poietai", "version": "1.0.0" }
            }
        })
    }

    fn tools_list_response(id: serde_json::Value) -> serde_json::Value {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "tools": [{
                    "name": "ask_human",
                    "description": "Ask the human a question and wait for their reply.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "question": { "type": "string" },
                            "agent_id": { "type": "string" }
                        },
                        "required": ["question", "agent_id"]
                    }
                }]
            }
        })
    }

    #[test]
    fn initialize_has_correct_protocol_version() {
        let resp = initialize_response(json!(1));
        assert_eq!(resp["result"]["protocolVersion"], "2024-11-05");
    }

    #[test]
    fn initialize_includes_tools_capability() {
        let resp = initialize_response(json!(1));
        assert!(resp["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn tools_list_contains_ask_human() {
        let resp = tools_list_response(json!(2));
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "ask_human");
    }

    #[test]
    fn ask_human_schema_requires_question_and_agent_id() {
        let resp = tools_list_response(json!(2));
        let required = resp["result"]["tools"][0]["inputSchema"]["required"]
            .as_array()
            .unwrap();
        let required_strs: Vec<&str> =
            required.iter().filter_map(|v| v.as_str()).collect();
        assert!(required_strs.contains(&"question"));
        assert!(required_strs.contains(&"agent_id"));
    }

    #[tokio::test]
    async fn mcp_state_answer_returns_err_when_no_pending() {
        let state = super::McpState::new(9999);
        let result = state.answer("nonexistent", "hello".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no pending question"));
    }

    #[tokio::test]
    async fn mcp_state_answer_delivers_reply() {
        use tokio::sync::oneshot;
        let state = super::McpState::new(9999);
        let (tx, rx) = oneshot::channel::<String>();
        state
            .pending_questions
            .lock()
            .await
            .insert("agent-1".to_string(), tx);
        let result = state.answer("agent-1", "use approach A".to_string()).await;
        assert!(result.is_ok());
        let received = rx.await.unwrap();
        assert_eq!(received, "use approach A");
    }
}
