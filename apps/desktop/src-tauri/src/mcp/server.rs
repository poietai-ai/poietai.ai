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
    pub(crate) pending_ticket_queries:
        Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
}

impl McpState {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            pending_questions: Arc::new(Mutex::new(HashMap::new())),
            pending_ticket_queries: Arc::new(Mutex::new(HashMap::new())),
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

    /// Deliver ticket data to a waiting list_tickets call.
    pub async fn answer_tickets(&self, request_id: &str, data: String) -> Result<(), String> {
        let tx = {
            let mut pending = self.pending_ticket_queries.lock().await;
            pending.remove(request_id)
        };
        match tx {
            Some(sender) => sender
                .send(data)
                .map_err(|_| "ticket query is no longer waiting".to_string()),
            None => Err(format!("no pending ticket query for '{}'", request_id)),
        }
    }
}

// ── Axum internal state ───────────────────────────────────────────────────────

type SseSender = mpsc::Sender<Result<Event, Infallible>>;

#[derive(Clone)]
struct ServerState {
    sessions: Arc<Mutex<HashMap<String, SseSender>>>,
    pending_questions: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    pending_ticket_queries: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
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
    pending_ticket_queries: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    app: tauri::AppHandle,
) {
    let state = ServerState {
        sessions: Arc::new(Mutex::new(HashMap::new())),
        pending_questions,
        pending_ticket_queries,
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

    // After endpoint, notify the client that tools may have changed since last session.
    // This causes resumed sessions to re-fetch tools/list and discover new tools.
    let tx_notify = tx.clone();
    tokio::spawn(async move {
        // Small delay so the client finishes its initialize handshake first
        tokio::time::sleep(Duration::from_millis(500)).await;
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/tools/list_changed"
        });
        let _ = tx_notify
            .send(Ok(Event::default()
                .event("message")
                .data(serde_json::to_string(&notification).unwrap_or_default())))
            .await;
    });

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
                "tools": [
                    {
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
                    },
                    {
                        "name": "status_update",
                        "description": "Send a non-blocking status update to your team lead. Use to share progress: what you're doing, what you found, milestones reached.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "message": {
                                    "type": "string",
                                    "description": "A brief status message, like a Slack update"
                                },
                                "agent_id": {
                                    "type": "string",
                                    "description": "Your agent ID, exactly as given in your system prompt"
                                }
                            },
                            "required": ["message", "agent_id"]
                        }
                    },
                    {
                        "name": "present_choices",
                        "description": "Present the user with 2-4 labeled options. Use when you see multiple valid approaches and want the user to pick.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "question": {
                                    "type": "string",
                                    "description": "The question or decision to present"
                                },
                                "choices": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "label": { "type": "string", "description": "Short label for this option" },
                                            "description": { "type": "string", "description": "Why this option and its trade-offs" }
                                        },
                                        "required": ["label", "description"]
                                    },
                                    "minItems": 2,
                                    "maxItems": 4
                                },
                                "agent_id": {
                                    "type": "string",
                                    "description": "Your agent ID"
                                }
                            },
                            "required": ["question", "choices", "agent_id"]
                        }
                    },
                    {
                        "name": "confirm_action",
                        "description": "Request approval before a major or irreversible action. Shows the user what you're about to do and waits for Approve/Reject.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "action": {
                                    "type": "string",
                                    "description": "What you're about to do, e.g. 'Create PR #42' or 'Refactor auth module'"
                                },
                                "details": {
                                    "type": "string",
                                    "description": "Details/preview of the action"
                                },
                                "agent_id": {
                                    "type": "string",
                                    "description": "Your agent ID"
                                }
                            },
                            "required": ["action", "agent_id"]
                        }
                    },
                    {
                        "name": "list_tickets",
                        "description": "Query the live ticket board. Returns all tickets with their number, title, status, phase, and assignees. Use when asked about tickets or to get current board state.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "agent_id": {
                                    "type": "string",
                                    "description": "Your agent ID"
                                },
                                "status_filter": {
                                    "type": "string",
                                    "description": "Optional: filter by status (backlog, refined, assigned, in_progress, in_review, shipped, blocked)"
                                }
                            },
                            "required": ["agent_id"]
                        }
                    },
                    {
                        "name": "get_ticket_details",
                        "description": "Get full details for a specific ticket by number. Returns description, acceptance criteria, status, active phase, all phase artifacts (brief, design, plan, etc.), and assignees. Use when the user asks about a specific ticket.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "ticket_number": {
                                    "type": "integer",
                                    "description": "The ticket number (e.g. 1 for #1)"
                                },
                                "agent_id": {
                                    "type": "string",
                                    "description": "Your agent ID"
                                }
                            },
                            "required": ["ticket_number", "agent_id"]
                        }
                    },
                    {
                        "name": "update_ticket",
                        "description": "Update fields on an existing ticket. You can change title, description, acceptance criteria, tags, complexity, or status.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "ticket_number": {
                                    "type": "integer",
                                    "description": "The ticket number to update"
                                },
                                "agent_id": {
                                    "type": "string",
                                    "description": "Your agent ID"
                                },
                                "title": { "type": "string", "description": "New title" },
                                "description": { "type": "string", "description": "New description" },
                                "acceptance_criteria": {
                                    "type": "array",
                                    "items": { "type": "string" },
                                    "description": "New acceptance criteria list"
                                },
                                "tags": {
                                    "type": "array",
                                    "items": { "type": "string" },
                                    "description": "New tags list"
                                },
                                "complexity": { "type": "integer", "description": "Complexity 1-10" },
                                "status": { "type": "string", "description": "New status (backlog, refined, assigned, in_progress, in_review, shipped, blocked)" }
                            },
                            "required": ["ticket_number", "agent_id"]
                        }
                    },
                    {
                        "name": "create_ticket",
                        "description": "Create a new ticket on the board.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "title": {
                                    "type": "string",
                                    "description": "Ticket title"
                                },
                                "agent_id": {
                                    "type": "string",
                                    "description": "Your agent ID"
                                },
                                "description": { "type": "string", "description": "Ticket description" },
                                "complexity": { "type": "integer", "description": "Complexity 1-10 (default 3)" },
                                "acceptance_criteria": {
                                    "type": "array",
                                    "items": { "type": "string" },
                                    "description": "Acceptance criteria list"
                                }
                            },
                            "required": ["title", "agent_id"]
                        }
                    },
                    {
                        "name": "complete_phase",
                        "description": "Signal that the current phase is complete, optionally attaching an artifact. Advances the ticket to its next phase.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "ticket_number": {
                                    "type": "integer",
                                    "description": "The ticket number"
                                },
                                "agent_id": {
                                    "type": "string",
                                    "description": "Your agent ID"
                                },
                                "artifact": {
                                    "type": "string",
                                    "description": "Optional artifact content (e.g. design doc, plan, etc.)"
                                }
                            },
                            "required": ["ticket_number", "agent_id"]
                        }
                    },
                    {
                        "name": "claim_ticket",
                        "description": "Claim and start working on a ticket. Assigns you to the ticket and kicks off the full development workflow with worktree, phases, etc.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "ticket_number": {
                                    "type": "integer",
                                    "description": "The ticket number to claim"
                                },
                                "agent_id": {
                                    "type": "string",
                                    "description": "Your agent ID"
                                }
                            },
                            "required": ["ticket_number", "agent_id"]
                        }
                    },
                    {
                        "name": "relay_answer",
                        "description": "Relay the user's answer back to your coding session that is waiting for input. Call this after the user answers a question from your coding work.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "agent_id": {
                                    "type": "string",
                                    "description": "Your agent ID"
                                },
                                "answer": {
                                    "type": "string",
                                    "description": "The user's answer to relay back"
                                }
                            },
                            "required": ["agent_id", "answer"]
                        }
                    }
                ]
            }
        })),

        "tools/call" => {
            let params = body.get("params")?;
            let tool_name = params["name"].as_str()?;
            let args = params.get("arguments").cloned().unwrap_or(json!({}));

            match tool_name {
                "ask_human" => {
                    let question = args.get("question")
                        .and_then(|v| v.as_str())?
                        .to_string();
                    let agent_id = args.get("agent_id")
                        .and_then(|v| v.as_str())?
                        .to_string();

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

                "status_update" => {
                    let message = args.get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let agent_id = args.get("agent_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    // Non-blocking: emit event and return immediately
                    let _ = state.app.emit("agent-status", json!({
                        "agent_id": agent_id,
                        "message": message,
                    }));

                    Some(json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [{ "type": "text", "text": "Status update delivered." }],
                            "isError": false
                        }
                    }))
                }

                "present_choices" => {
                    let question = args.get("question")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let choices = args.get("choices")
                        .cloned()
                        .unwrap_or(json!([]));
                    let agent_id = args.get("agent_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let (tx, rx) = oneshot::channel::<String>();
                    {
                        let mut pending = state.pending_questions.lock().await;
                        pending.insert(agent_id.clone(), tx);
                    }

                    let _ = state.app.emit("agent-choices", json!({
                        "agent_id": agent_id,
                        "question": question,
                        "choices": choices,
                    }));

                    match tokio::time::timeout(Duration::from_secs(600), rx).await {
                        Ok(Ok(reply)) => Some(json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "content": [{ "type": "text", "text": format!("User chose: {}", reply) }],
                                "isError": false
                            }
                        })),
                        Ok(Err(_)) => Some(json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "content": [{ "type": "text", "text": "Error: connection lost" }],
                                "isError": true
                            }
                        })),
                        Err(_) => Some(json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "content": [{ "type": "text", "text": "Timed out waiting for user choice" }],
                                "isError": true
                            }
                        })),
                    }
                }

                "confirm_action" => {
                    let action = args.get("action")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let details = args.get("details")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let agent_id = args.get("agent_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let (tx, rx) = oneshot::channel::<String>();
                    {
                        let mut pending = state.pending_questions.lock().await;
                        pending.insert(agent_id.clone(), tx);
                    }

                    let _ = state.app.emit("agent-confirm", json!({
                        "agent_id": agent_id,
                        "action": action,
                        "details": details,
                    }));

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
                            "result": {
                                "content": [{ "type": "text", "text": "Error: connection lost" }],
                                "isError": true
                            }
                        })),
                        Err(_) => Some(json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "content": [{ "type": "text", "text": "Timed out waiting for confirmation" }],
                                "isError": true
                            }
                        })),
                    }
                }

                "list_tickets" | "get_ticket_details"
                | "update_ticket" | "create_ticket" | "complete_phase"
                | "claim_ticket" => {
                    let agent_id = args.get("agent_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let request_id = uuid::Uuid::new_v4().to_string();
                    let (tx, rx) = oneshot::channel::<String>();
                    state
                        .pending_ticket_queries
                        .lock()
                        .await
                        .insert(request_id.clone(), tx);

                    match tool_name {
                        "get_ticket_details" => {
                            let ticket_number = args.get("ticket_number")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0);

                            let _ = state.app.emit("agent-get-ticket-details", json!({
                                "request_id": request_id,
                                "agent_id": agent_id,
                                "ticket_number": ticket_number,
                            }));
                        }
                        "update_ticket" => {
                            let _ = state.app.emit("agent-update-ticket", json!({
                                "request_id": request_id,
                                "agent_id": agent_id,
                                "ticket_number": args.get("ticket_number").and_then(|v| v.as_i64()).unwrap_or(0),
                                "title": args.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                                "description": args.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                                "acceptance_criteria": args.get("acceptance_criteria").cloned().unwrap_or(json!([])),
                                "tags": args.get("tags").cloned().unwrap_or(json!([])),
                                "complexity": args.get("complexity").and_then(|v| v.as_i64()).unwrap_or(0),
                                "status": args.get("status").and_then(|v| v.as_str()).unwrap_or(""),
                            }));
                        }
                        "create_ticket" => {
                            let _ = state.app.emit("agent-create-ticket", json!({
                                "request_id": request_id,
                                "agent_id": agent_id,
                                "title": args.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled"),
                                "description": args.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                                "complexity": args.get("complexity").and_then(|v| v.as_i64()).unwrap_or(3),
                                "acceptance_criteria": args.get("acceptance_criteria").cloned().unwrap_or(json!([])),
                            }));
                        }
                        "complete_phase" => {
                            let _ = state.app.emit("agent-complete-phase", json!({
                                "request_id": request_id,
                                "agent_id": agent_id,
                                "ticket_number": args.get("ticket_number").and_then(|v| v.as_i64()).unwrap_or(0),
                                "artifact": args.get("artifact").and_then(|v| v.as_str()).unwrap_or(""),
                            }));
                        }
                        "claim_ticket" => {
                            let ticket_number = args.get("ticket_number")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0);

                            let _ = state.app.emit("agent-claim-ticket", json!({
                                "request_id": request_id,
                                "agent_id": agent_id,
                                "ticket_number": ticket_number,
                            }));
                        }
                        // "list_tickets"
                        _ => {
                            let status_filter = args.get("status_filter")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();

                            let _ = state.app.emit("agent-list-tickets", json!({
                                "request_id": request_id,
                                "agent_id": agent_id,
                                "status_filter": status_filter,
                            }));
                        }
                    }

                    // Short timeout — frontend auto-responds instantly
                    match tokio::time::timeout(Duration::from_secs(5), rx).await {
                        Ok(Ok(data)) => Some(json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "content": [{ "type": "text", "text": data }],
                                "isError": false
                            }
                        })),
                        Ok(Err(_)) => Some(json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "content": [{ "type": "text", "text": "Error: ticket query channel closed" }],
                                "isError": true
                            }
                        })),
                        Err(_) => Some(json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "content": [{ "type": "text", "text": "Timed out querying ticket board" }],
                                "isError": true
                            }
                        })),
                    }
                }

                "relay_answer" => {
                    let agent_id = args.get("agent_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let answer = args.get("answer")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let tx = {
                        let mut pending = state.pending_questions.lock().await;
                        pending.remove(&agent_id)
                    };

                    let result_text = match tx {
                        Some(sender) => {
                            let _ = sender.send(answer);
                            "Answer relayed to your coding session."
                        }
                        None => "No pending question found — it may have timed out or already been answered."
                    };

                    Some(json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [{ "type": "text", "text": result_text }],
                            "isError": false
                        }
                    }))
                }

                _ => Some(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": "Unknown tool" }
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
                "tools": [
                    {
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
                    },
                    {
                        "name": "status_update",
                        "description": "Send a non-blocking status update to your team lead.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "message": { "type": "string" },
                                "agent_id": { "type": "string" }
                            },
                            "required": ["message", "agent_id"]
                        }
                    },
                    {
                        "name": "present_choices",
                        "description": "Present the user with 2-4 labeled options.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "question": { "type": "string" },
                                "choices": { "type": "array" },
                                "agent_id": { "type": "string" }
                            },
                            "required": ["question", "choices", "agent_id"]
                        }
                    },
                    {
                        "name": "confirm_action",
                        "description": "Request approval before a major or irreversible action.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "action": { "type": "string" },
                                "details": { "type": "string" },
                                "agent_id": { "type": "string" }
                            },
                            "required": ["action", "agent_id"]
                        }
                    },
                    {
                        "name": "list_tickets",
                        "description": "Query the live ticket board.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "agent_id": { "type": "string" },
                                "status_filter": { "type": "string" }
                            },
                            "required": ["agent_id"]
                        }
                    },
                    {
                        "name": "get_ticket_details",
                        "description": "Get full details for a specific ticket by number.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "ticket_number": { "type": "integer" },
                                "agent_id": { "type": "string" }
                            },
                            "required": ["ticket_number", "agent_id"]
                        }
                    },
                    {
                        "name": "update_ticket",
                        "description": "Update fields on an existing ticket.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "ticket_number": { "type": "integer" },
                                "agent_id": { "type": "string" },
                                "title": { "type": "string" },
                                "description": { "type": "string" },
                                "acceptance_criteria": { "type": "array" },
                                "tags": { "type": "array" },
                                "complexity": { "type": "integer" },
                                "status": { "type": "string" }
                            },
                            "required": ["ticket_number", "agent_id"]
                        }
                    },
                    {
                        "name": "create_ticket",
                        "description": "Create a new ticket on the board.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string" },
                                "agent_id": { "type": "string" },
                                "description": { "type": "string" },
                                "complexity": { "type": "integer" },
                                "acceptance_criteria": { "type": "array" }
                            },
                            "required": ["title", "agent_id"]
                        }
                    },
                    {
                        "name": "complete_phase",
                        "description": "Signal phase completion.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "ticket_number": { "type": "integer" },
                                "agent_id": { "type": "string" },
                                "artifact": { "type": "string" }
                            },
                            "required": ["ticket_number", "agent_id"]
                        }
                    },
                    {
                        "name": "claim_ticket",
                        "description": "Claim and start working on a ticket.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "ticket_number": { "type": "integer" },
                                "agent_id": { "type": "string" }
                            },
                            "required": ["ticket_number", "agent_id"]
                        }
                    },
                    {
                        "name": "relay_answer",
                        "description": "Relay the user's answer back to your coding session.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "agent_id": { "type": "string" },
                                "answer": { "type": "string" }
                            },
                            "required": ["agent_id", "answer"]
                        }
                    }
                ]
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
        assert_eq!(tools.len(), 11);
        assert_eq!(tools[0]["name"], "ask_human");
    }

    #[test]
    fn tools_list_contains_status_update() {
        let resp = tools_list_response(json!(2));
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools[1]["name"], "status_update");
        let required = tools[1]["inputSchema"]["required"]
            .as_array()
            .unwrap();
        let required_strs: Vec<&str> =
            required.iter().filter_map(|v| v.as_str()).collect();
        assert!(required_strs.contains(&"message"));
        assert!(required_strs.contains(&"agent_id"));
    }

    #[test]
    fn tools_list_contains_present_choices() {
        let resp = tools_list_response(json!(2));
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools[2]["name"], "present_choices");
        let required = tools[2]["inputSchema"]["required"]
            .as_array()
            .unwrap();
        let required_strs: Vec<&str> =
            required.iter().filter_map(|v| v.as_str()).collect();
        assert!(required_strs.contains(&"question"));
        assert!(required_strs.contains(&"choices"));
        assert!(required_strs.contains(&"agent_id"));
    }

    #[test]
    fn tools_list_contains_confirm_action() {
        let resp = tools_list_response(json!(2));
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools[3]["name"], "confirm_action");
        let required = tools[3]["inputSchema"]["required"]
            .as_array()
            .unwrap();
        let required_strs: Vec<&str> =
            required.iter().filter_map(|v| v.as_str()).collect();
        assert!(required_strs.contains(&"action"));
        assert!(required_strs.contains(&"agent_id"));
        assert!(!required_strs.contains(&"details"));
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

    #[test]
    fn tools_list_contains_list_tickets() {
        let resp = tools_list_response(json!(2));
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools[4]["name"], "list_tickets");
        let required = tools[4]["inputSchema"]["required"]
            .as_array()
            .unwrap();
        let required_strs: Vec<&str> =
            required.iter().filter_map(|v| v.as_str()).collect();
        assert!(required_strs.contains(&"agent_id"));
        assert!(!required_strs.contains(&"status_filter"));
    }

    #[tokio::test]
    async fn mcp_state_answer_tickets_delivers() {
        use tokio::sync::oneshot;
        let state = super::McpState::new(9999);
        let (tx, rx) = oneshot::channel::<String>();
        state
            .pending_ticket_queries
            .lock()
            .await
            .insert("req-1".to_string(), tx);
        let result = state
            .answer_tickets("req-1", "#1: Fix bug [in_progress]".to_string())
            .await;
        assert!(result.is_ok());
        let received = rx.await.unwrap();
        assert_eq!(received, "#1: Fix bug [in_progress]");
    }

    #[test]
    fn tools_list_contains_update_ticket() {
        let resp = tools_list_response(json!(2));
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools[6]["name"], "update_ticket");
        let required = tools[6]["inputSchema"]["required"]
            .as_array()
            .unwrap();
        let required_strs: Vec<&str> =
            required.iter().filter_map(|v| v.as_str()).collect();
        assert!(required_strs.contains(&"ticket_number"));
        assert!(required_strs.contains(&"agent_id"));
        assert!(!required_strs.contains(&"title"));
    }

    #[test]
    fn tools_list_contains_create_ticket() {
        let resp = tools_list_response(json!(2));
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools[7]["name"], "create_ticket");
        let required = tools[7]["inputSchema"]["required"]
            .as_array()
            .unwrap();
        let required_strs: Vec<&str> =
            required.iter().filter_map(|v| v.as_str()).collect();
        assert!(required_strs.contains(&"title"));
        assert!(required_strs.contains(&"agent_id"));
    }

    #[test]
    fn tools_list_contains_complete_phase() {
        let resp = tools_list_response(json!(2));
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools[8]["name"], "complete_phase");
        let required = tools[8]["inputSchema"]["required"]
            .as_array()
            .unwrap();
        let required_strs: Vec<&str> =
            required.iter().filter_map(|v| v.as_str()).collect();
        assert!(required_strs.contains(&"ticket_number"));
        assert!(required_strs.contains(&"agent_id"));
        assert!(!required_strs.contains(&"artifact"));
    }

    #[test]
    fn tools_list_contains_claim_ticket() {
        let resp = tools_list_response(json!(2));
        let tools = resp["result"]["tools"].as_array().unwrap();
        assert_eq!(tools[9]["name"], "claim_ticket");
        let required = tools[9]["inputSchema"]["required"]
            .as_array()
            .unwrap();
        let required_strs: Vec<&str> =
            required.iter().filter_map(|v| v.as_str()).collect();
        assert!(required_strs.contains(&"ticket_number"));
        assert!(required_strs.contains(&"agent_id"));
    }

    #[tokio::test]
    async fn mcp_state_answer_tickets_err_when_none() {
        let state = super::McpState::new(9999);
        let result = state
            .answer_tickets("nonexistent", "data".to_string())
            .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no pending ticket query"));
    }
}
