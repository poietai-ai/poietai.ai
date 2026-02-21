/// Everything needed to build a system prompt for an agent run.
pub struct ContextInput<'a> {
    pub role: &'a str,
    pub personality: &'a str,
    pub project_name: &'a str,
    pub project_stack: &'a str,
    /// The project's CLAUDE.md equivalent — coding patterns, architecture, etc.
    pub project_context: &'a str,
    pub ticket_number: u32,
    pub ticket_title: &'a str,
    pub ticket_description: &'a str,
    pub ticket_acceptance_criteria: &'a [String],
    pub agent_id: &'a str,
}

/// Personality descriptions injected into the system prompt.
fn personality_description(personality: &str) -> &'static str {
    match personality {
        "pragmatic" => {
            "You favor proven patterns and shipping quickly. \
                        When you hit ambiguity, ask one targeted question rather than assuming — \
                        a precise question gets you unblocked faster than proceeding on a wrong assumption."
        }
        "perfectionist" => {
            "You catch edge cases and push for clean abstractions. \
                            Flag technical debt you notice even if not in scope. \
                            Ask clarifying questions when you see multiple valid approaches."
        }
        "ambitious" => {
            "You look for opportunities to improve things beyond the immediate ticket. \
                        Propose bold refactors when they would help. \
                        Communicate ideas actively before implementing them."
        }
        "conservative" => {
            "You question scope creep and ask 'do users actually need this?' \
                           Prefer smaller, safer changes over sweeping ones. \
                           Flag complexity risks before starting."
        }
        "devils-advocate" => {
            "You challenge assumptions and find holes in the plan. \
                              Surface edge cases and unhandled states proactively. \
                              Push back constructively when you think something is wrong."
        }
        _ => "You are a skilled, collaborative software engineer.",
    }
}

/// Role descriptions for the system prompt.
fn role_description(role: &str) -> &'static str {
    match role {
        "backend-engineer" => {
            "You own the server-side code: APIs, database queries, \
                               business logic, background jobs. Do not modify frontend code \
                               unless explicitly asked."
        }
        "frontend-engineer" => {
            "You own the client-side code: React components, styling, \
                                browser state, API integration. Do not modify backend logic \
                                unless explicitly asked."
        }
        "fullstack-engineer" => {
            "You work across the full stack. Make pragmatic decisions \
                                 about where logic lives and own changes end-to-end."
        }
        "staff-engineer" => {
            "You think about system-level concerns: abstractions, patterns, \
                             tech debt, architecture decisions. Review other agents' work \
                             critically and surface systemic issues."
        }
        "qa" => {
            "You write tests, find edge cases, and validate that implementations \
                 match acceptance criteria. You are thorough and skeptical."
        }
        _ => "You are a skilled software engineer working on this project.",
    }
}

/// Build the full system prompt string for a single agent run.
pub fn build(input: &ContextInput) -> String {
    let acceptance_criteria = if input.ticket_acceptance_criteria.is_empty() {
        "No explicit criteria — use good judgment.".to_string()
    } else {
        input
            .ticket_acceptance_criteria
            .iter()
            .map(|c| format!("- {}", c))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        "## Your Role\n\
        You are a {role} on the {project} engineering team.\n\
        {role_desc}\n\n\
        ## Your Working Style\n\
        {personality_desc}\n\n\
        ## Project Context\n\
        Project: {project}\n\
        Stack: {stack}\n\n\
        {project_context}\n\n\
        ## Current Ticket\n\
        Ticket #{ticket_num}: {ticket_title}\n\n\
        {ticket_description}\n\n\
        Acceptance criteria:\n\
        {acceptance_criteria}\n\n\
        ## When to Ask vs. Proceed\n\
        You are working asynchronously. ALWAYS ask rather than assume when you encounter:\n\
        - Requirements with multiple valid interpretations\n\
        - A design decision with meaningfully different tradeoffs (e.g. two library choices)\n\
        - Unclear scope — something that might belong in a separate ticket\n\
        - A risk or dependency the requester may not be aware of\n\
        - Anything where a wrong assumption could waste significant effort\n\n\
        Do NOT use the `AskUserQuestion` tool — it is disabled in headless mode and will always error.\n\
        Do NOT invoke skills (brainstorming, writing-plans, debugging, etc.) — skills are for interactive sessions, not automated agents.\n\n\
        To ask: output your question(s) as your final message and stop. Do not continue past a question.\n\
        The user will reply and your session will be resumed with their answer.\n\n\
        ## MCP Tools\n\
        You have an `ask_human` tool available via the poietai MCP server.\n\
        Use it when you need clarification that would meaningfully change your approach.\n\
        Always call it with agent_id=\"{agent_id}\" exactly.\n\n\
        ## Working Instructions\n\
        - Commit your changes with clear messages as you work\n\
        - When ready to create a PR, use: gh pr create --title \"...\" --body \"...\"\n\
        - Follow existing patterns from the project context above",
        role = input.role,
        project = input.project_name,
        role_desc = role_description(input.role),
        personality_desc = personality_description(input.personality),
        stack = input.project_stack,
        project_context = input.project_context,
        ticket_num = input.ticket_number,
        ticket_title = input.ticket_title,
        ticket_description = input.ticket_description,
        acceptance_criteria = acceptance_criteria,
        agent_id = input.agent_id,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // Static criteria so the slice has 'static lifetime and can be returned
    // from a helper or used in struct-update expressions.
    static SAMPLE_CRITERIA: &[String] = &[];

    // We can't use &[String::new()] at const/static level for non-empty slices,
    // so we build the input directly in each test that needs criteria, using a
    // locally-owned Vec that we borrow for the duration of the call.

    fn build_prompt_with_criteria(criteria: &[String]) -> String {
        let input = ContextInput {
            role: "backend-engineer",
            personality: "pragmatic",
            project_name: "RRP API",
            project_stack: "Go 1.23, PostgreSQL, pgx",
            project_context: "Key patterns: use apperr.New for errors. Database via pgx pool.",
            ticket_number: 87,
            ticket_title: "Fix nil guard in billing service",
            ticket_description: "The subscription pointer is not guarded before deduction.",
            ticket_acceptance_criteria: criteria,
            agent_id: "test-agent-123",
        };
        build(&input)
    }

    fn default_criteria() -> Vec<String> {
        vec![
            "Subscription is guarded before token deduction".to_string(),
            "Existing tests pass".to_string(),
        ]
    }

    #[test]
    fn builds_prompt_with_role_description() {
        let prompt = build_prompt_with_criteria(&default_criteria());
        assert!(prompt.contains("backend-engineer"));
        assert!(prompt.contains("server-side code"));
    }

    #[test]
    fn includes_ticket_number_and_title() {
        let prompt = build_prompt_with_criteria(&default_criteria());
        assert!(prompt.contains("Ticket #87"));
        assert!(prompt.contains("Fix nil guard in billing service"));
    }

    #[test]
    fn includes_acceptance_criteria() {
        let prompt = build_prompt_with_criteria(&default_criteria());
        assert!(prompt.contains("Subscription is guarded"));
        assert!(prompt.contains("Existing tests pass"));
    }

    #[test]
    fn includes_project_context() {
        let prompt = build_prompt_with_criteria(&default_criteria());
        assert!(prompt.contains("apperr.New"));
    }

    #[test]
    fn personality_affects_working_style() {
        let prompt = build_prompt_with_criteria(&default_criteria());
        assert!(prompt.contains("proven patterns")); // pragmatic description
    }

    #[test]
    fn empty_acceptance_criteria_shows_fallback() {
        let prompt = build_prompt_with_criteria(SAMPLE_CRITERIA);
        assert!(prompt.contains("No explicit criteria"));
    }

    #[test]
    fn unknown_personality_uses_default() {
        let criteria = default_criteria();
        let input = ContextInput {
            role: "backend-engineer",
            personality: "totally-unknown",
            project_name: "RRP API",
            project_stack: "Go 1.23, PostgreSQL, pgx",
            project_context: "Key patterns: use apperr.New for errors. Database via pgx pool.",
            ticket_number: 87,
            ticket_title: "Fix nil guard in billing service",
            ticket_description: "The subscription pointer is not guarded before deduction.",
            ticket_acceptance_criteria: &criteria,
            agent_id: "test-agent-123",
        };
        let prompt = build(&input);
        assert!(prompt.contains("skilled, collaborative"));
    }

    #[test]
    fn includes_agent_id_in_mcp_section() {
        let prompt = build_prompt_with_criteria(&default_criteria());
        assert!(prompt.contains("test-agent-123"));
        assert!(prompt.contains("ask_human"));
    }

    #[test]
    fn includes_skill_suppression() {
        let prompt = build_prompt_with_criteria(&default_criteria());
        assert!(prompt.contains("AskUserQuestion"));
        assert!(prompt.contains("automated agent"));
    }
}
