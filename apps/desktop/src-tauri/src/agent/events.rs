use serde::Deserialize;

/// Every event that can come from the Claude Code JSONL stream.
///
/// Claude Code --output-format stream-json emits one JSON object per line.
/// Each object has a "type" field we use to pick the right variant.
///
/// In Go terms: this is an interface{} with a type switch, but the compiler
/// enforces exhaustiveness at compile time.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// A thinking block — the agent's internal reasoning.
    /// Maps to canvas node type: ThoughtNode (indigo)
    Thinking {
        thinking: String,
    },

    /// A text message — the agent narrating what it's doing.
    /// Routed to ticket chat AND becomes a canvas node (neutral gray).
    Text {
        text: String,
    },

    /// Tool use start — which tool and with what input.
    /// We inspect `tool_name` to decide canvas node type.
    ToolUse {
        id: String,
        tool_name: String,
        tool_input: serde_json::Value,
    },

    /// Tool result — what the tool returned.
    /// Paired with ToolUse by `tool_use_id`.
    ToolResult {
        tool_use_id: String,
        content: serde_json::Value,
        is_error: Option<bool>,
    },

    /// The agent completed its run.
    Result {
        result: Option<String>,
        session_id: Option<String>,
    },
}

/// Parses a single JSONL line into an AgentEvent.
/// Returns None (not an error) for lines we don't recognize —
/// the stream has some bookkeeping lines we can safely ignore.
pub fn parse_event(line: &str) -> Option<AgentEvent> {
    serde_json::from_str(line).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_thinking_event() {
        let line = r#"{"type":"thinking","thinking":"I need to check the billing service first"}"#;
        let event = parse_event(line).expect("should parse");
        assert!(matches!(event, AgentEvent::Thinking { .. }));
        if let AgentEvent::Thinking { thinking } = event {
            assert!(thinking.contains("billing service"));
        }
    }

    #[test]
    fn parses_text_event() {
        let line = r#"{"type":"text","text":"Looking at the billing handler now."}"#;
        let event = parse_event(line).expect("should parse");
        assert!(matches!(event, AgentEvent::Text { .. }));
    }

    #[test]
    fn parses_tool_use_event() {
        let line = r#"{"type":"tool_use","id":"tu_123","tool_name":"Read","tool_input":{"file_path":"src/billing.go"}}"#;
        let event = parse_event(line).expect("should parse");
        assert!(matches!(event, AgentEvent::ToolUse { .. }));
        if let AgentEvent::ToolUse { tool_name, .. } = event {
            assert_eq!(tool_name, "Read");
        }
    }

    #[test]
    fn returns_none_for_unknown_type() {
        let line = r#"{"type":"some_unknown_bookkeeping_event","data":{}}"#;
        assert!(parse_event(line).is_none());
    }

    #[test]
    fn returns_none_for_malformed_json() {
        let line = "not json at all";
        assert!(parse_event(line).is_none());
    }
}
