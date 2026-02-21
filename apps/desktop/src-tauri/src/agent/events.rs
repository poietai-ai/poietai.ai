use serde::{Deserialize, Serialize};

/// The semantic events we surface to the React canvas.
/// These are extracted from the nested stream-json wire format.
#[derive(Debug, Clone, Serialize)]
pub enum AgentEvent {
    /// Agent internal reasoning (extended thinking).
    Thinking { thinking: String },
    /// Agent narrating what it's doing.
    Text { text: String },
    /// Agent calling a tool.
    ToolUse {
        id: String,
        tool_name: String,
        tool_input: serde_json::Value,
    },
    /// Tool result returned to the agent.
    ToolResult {
        tool_use_id: String,
        content: serde_json::Value,
        is_error: Option<bool>,
    },
    /// The agent run completed.
    Result {
        result: Option<String>,
        session_id: Option<String>,
    },
}

// ── Wire format types (deserialization only) ─────────────────────────────────
//
// claude --output-format stream-json --verbose emits lines shaped like:
//
//   {"type":"assistant","message":{"content":[{"type":"thinking","thinking":"..."}],...}}
//   {"type":"assistant","message":{"content":[{"type":"tool_use","id":"...","name":"Read","input":{}}]}}
//   {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"...","content":"..."}]}}
//   {"type":"result","result":"...","session_id":"..."}
//
// We unwrap the nesting and emit flat AgentEvents.

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum StreamLine {
    Assistant { message: AssistantMessage },
    User { message: UserMessage },
    Result {
        result: Option<String>,
        session_id: Option<String>,
    },
    #[serde(other)]
    Ignored,
}

#[derive(Deserialize)]
struct AssistantMessage {
    content: Vec<AssistantBlock>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AssistantBlock {
    Thinking { thinking: String },
    Text { text: String },
    ToolUse {
        id: String,
        /// The wire format uses "name", we expose it as "tool_name".
        name: String,
        input: serde_json::Value,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Deserialize)]
struct UserMessage {
    content: Vec<UserBlock>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum UserBlock {
    ToolResult {
        tool_use_id: String,
        content: serde_json::Value,
        #[serde(default)]
        is_error: Option<bool>,
    },
    #[serde(other)]
    Unknown,
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Parse a single JSONL line into zero or more AgentEvents.
/// Returns an empty vec for lines we don't recognise (system events, rate
/// limits, etc.) — the caller should simply skip those lines.
pub fn parse_events(line: &str) -> Vec<AgentEvent> {
    let stream_line: StreamLine = match serde_json::from_str(line) {
        Ok(l) => l,
        Err(_) => return vec![],
    };

    match stream_line {
        StreamLine::Assistant { message } => message
            .content
            .into_iter()
            .filter_map(|block| match block {
                AssistantBlock::Thinking { thinking } => Some(AgentEvent::Thinking { thinking }),
                AssistantBlock::Text { text } => Some(AgentEvent::Text { text }),
                AssistantBlock::ToolUse { id, name, input } => Some(AgentEvent::ToolUse {
                    id,
                    tool_name: name,
                    tool_input: input,
                }),
                AssistantBlock::Unknown => None,
            })
            .collect(),

        StreamLine::User { message } => message
            .content
            .into_iter()
            .filter_map(|block| match block {
                UserBlock::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                } => Some(AgentEvent::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                }),
                UserBlock::Unknown => None,
            })
            .collect(),

        StreamLine::Result { result, session_id } => {
            vec![AgentEvent::Result { result, session_id }]
        }

        StreamLine::Ignored => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_thinking_from_assistant_message() {
        let line = r#"{"type":"assistant","message":{"model":"claude-sonnet-4-6","id":"msg_1","type":"message","role":"assistant","content":[{"type":"thinking","thinking":"I need to check the billing service first"}]}}"#;
        let events = parse_events(line);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], AgentEvent::Thinking { .. }));
        if let AgentEvent::Thinking { ref thinking } = events[0] {
            assert!(thinking.contains("billing service"));
        }
    }

    #[test]
    fn parses_text_from_assistant_message() {
        let line = r#"{"type":"assistant","message":{"model":"claude-sonnet-4-6","id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"Looking at the billing handler now."}]}}"#;
        let events = parse_events(line);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], AgentEvent::Text { .. }));
    }

    #[test]
    fn parses_tool_use_from_assistant_message() {
        let line = r#"{"type":"assistant","message":{"model":"claude-sonnet-4-6","id":"msg_1","type":"message","role":"assistant","content":[{"type":"tool_use","id":"tu_123","name":"Read","input":{"file_path":"src/billing.go"}}]}}"#;
        let events = parse_events(line);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], AgentEvent::ToolUse { .. }));
        if let AgentEvent::ToolUse { ref tool_name, ref id, .. } = events[0] {
            assert_eq!(tool_name, "Read");
            assert_eq!(id, "tu_123");
        }
    }

    #[test]
    fn parses_tool_result_from_user_message() {
        let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_123","content":"file contents here"}]}}"#;
        let events = parse_events(line);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], AgentEvent::ToolResult { .. }));
        if let AgentEvent::ToolResult { ref tool_use_id, .. } = events[0] {
            assert_eq!(tool_use_id, "tu_123");
        }
    }

    #[test]
    fn parses_result_event() {
        let line = r#"{"type":"result","result":"Done. PR opened at #42.","session_id":"sess_abc"}"#;
        let events = parse_events(line);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], AgentEvent::Result { .. }));
        if let AgentEvent::Result { ref session_id, .. } = events[0] {
            assert_eq!(session_id.as_deref(), Some("sess_abc"));
        }
    }

    #[test]
    fn ignores_system_events() {
        let line = r#"{"type":"system","subtype":"init","session_id":"abc","tools":[]}"#;
        assert!(parse_events(line).is_empty());
    }

    #[test]
    fn ignores_rate_limit_events() {
        let line = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}"#;
        assert!(parse_events(line).is_empty());
    }

    #[test]
    fn ignores_malformed_json() {
        assert!(parse_events("not json at all").is_empty());
    }
}
