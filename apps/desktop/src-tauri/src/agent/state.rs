use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use serde::Serialize;

/// The statuses an agent can be in.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Idle,
    Working,
    WaitingForUser,
    Reviewing,
    Blocked,
}

/// Everything we know about a running (or idle) agent.
#[derive(Debug, Clone, Serialize)]
pub struct AgentState {
    pub id: String,
    pub name: String,
    pub role: String,
    pub personality: String,
    pub status: AgentStatus,
    /// The ticket this agent is currently working on, if any.
    pub current_ticket_id: Option<String>,
    /// The Claude Code session ID, used for --resume.
    pub session_id: Option<String>,
    /// Path to the git worktree, if one is active.
    pub worktree_path: Option<String>,
    /// The open PR number, if one exists.
    pub pr_number: Option<u32>,
}

/// The shared state store.
///
/// Arc = "Atomically Reference Counted" — a smart pointer you can clone cheaply
/// and share across threads. The data is freed when the last clone is dropped.
///
/// Mutex = mutual exclusion lock. In Rust, the data lives *inside* the Mutex,
/// not outside it. You can't forget to lock before accessing.
pub type StateStore = Arc<Mutex<HashMap<String, AgentState>>>;

/// Create a new empty state store.
pub fn new_store() -> StateStore {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Insert or update an agent in the store.
pub fn upsert_agent(store: &StateStore, agent: AgentState) {
    let mut map = store.lock().unwrap();
    map.insert(agent.id.clone(), agent);
}

/// Get a snapshot of an agent's state.
pub fn get_agent(store: &StateStore, id: &str) -> Option<AgentState> {
    let map = store.lock().unwrap();
    map.get(id).cloned()
}

/// Get all agents as a Vec (for sending to the frontend).
pub fn all_agents(store: &StateStore) -> Vec<AgentState> {
    let map = store.lock().unwrap();
    map.values().cloned().collect()
}

/// Persist the Claude Code session ID on an agent after a successful run.
/// No-op if the agent ID is not found.
pub fn save_session_id(store: &StateStore, id: &str, session_id: &str) {
    let mut map = store.lock().unwrap();
    if let Some(agent) = map.get_mut(id) {
        agent.session_id = Some(session_id.to_string());
    }
}

/// Update just the status of an agent.
/// Returns true if the agent was found and updated, false if the ID was not in the store.
pub fn set_status(store: &StateStore, id: &str, status: AgentStatus) -> bool {
    let mut map = store.lock().unwrap();
    if let Some(agent) = map.get_mut(id) {
        agent.status = status;
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_agent(id: &str, status: AgentStatus) -> AgentState {
        AgentState {
            id: id.to_string(),
            name: "Test Agent".to_string(),
            role: "backend-engineer".to_string(),
            personality: "pragmatic".to_string(),
            status,
            current_ticket_id: None,
            session_id: None,
            worktree_path: None,
            pr_number: None,
        }
    }

    #[test]
    fn insert_and_retrieve_agent() {
        let store = new_store();
        let agent = make_agent("agent-1", AgentStatus::Idle);
        upsert_agent(&store, agent);

        let retrieved = get_agent(&store, "agent-1").expect("agent should exist");
        assert_eq!(retrieved.id, "agent-1");
        assert_eq!(retrieved.status, AgentStatus::Idle);
    }

    #[test]
    fn update_agent_status() {
        let store = new_store();
        upsert_agent(&store, make_agent("agent-2", AgentStatus::Idle));
        set_status(&store, "agent-2", AgentStatus::Working);

        let agent = get_agent(&store, "agent-2").unwrap();
        assert_eq!(agent.status, AgentStatus::Working);
    }

    #[test]
    fn all_agents_returns_all() {
        let store = new_store();
        upsert_agent(&store, make_agent("a1", AgentStatus::Idle));
        upsert_agent(&store, make_agent("a2", AgentStatus::Working));

        let all = all_agents(&store);
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn missing_agent_returns_none() {
        let store = new_store();
        assert!(get_agent(&store, "nonexistent").is_none());
    }

    #[test]
    fn save_and_retrieve_session_id() {
        let store = new_store();
        upsert_agent(&store, make_agent("agent-5", AgentStatus::Idle));
        save_session_id(&store, "agent-5", "session-abc");

        let agent = get_agent(&store, "agent-5").unwrap();
        assert_eq!(agent.session_id, Some("session-abc".to_string()));
    }

    #[test]
    fn save_session_id_no_op_for_missing_agent() {
        let store = new_store();
        // Should not panic — just silently does nothing
        save_session_id(&store, "nonexistent", "session-xyz");
        assert!(get_agent(&store, "nonexistent").is_none());
    }
}
