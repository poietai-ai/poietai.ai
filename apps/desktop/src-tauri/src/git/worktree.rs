use std::path::{Path, PathBuf};
use std::process::Command;
use anyhow::{Context, Result};

/// Configuration for a new worktree.
pub struct WorktreeConfig {
    /// The root of the main git repo.
    pub repo_root: PathBuf,
    /// The ticket ID — used to name the worktree directory and branch.
    pub ticket_id: String,
    /// Human-readable slug for the branch name, e.g. "fix-billing-nil-guard".
    pub ticket_slug: String,
    /// Agent display name for git commits.
    pub agent_name: String,
    /// Agent email for git commits.
    pub agent_email: String,
}

/// A created worktree, ready for agent use.
#[derive(Debug, Clone)]
pub struct Worktree {
    pub path: PathBuf,
    pub branch: String,
    pub ticket_id: String,
}

impl Worktree {
    /// The branch name for this ticket.
    /// Format: feat/<ticket-slug>
    pub fn branch_for(slug: &str) -> String {
        format!("feat/{}", slug)
    }

    /// The worktree directory path.
    /// Format: <repo_root>/.worktrees/<ticket-id>
    pub fn path_for(repo_root: &Path, ticket_id: &str) -> PathBuf {
        repo_root.join(".worktrees").join(ticket_id)
    }
}

/// Create a new git worktree for a ticket.
///
/// Equivalent to: git worktree add .worktrees/<ticket-id> -b feat/<slug>
pub fn create(config: &WorktreeConfig) -> Result<Worktree> {
    let branch = Worktree::branch_for(&config.ticket_slug);
    let path = Worktree::path_for(&config.repo_root, &config.ticket_id);

    let output = Command::new("git")
        .arg("worktree").arg("add").arg(&path).arg("-b").arg(&branch)
        .current_dir(&config.repo_root)
        .output()
        .context("failed to run git worktree add")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git worktree add failed: {}", stderr);
    }

    Ok(Worktree {
        path,
        branch,
        ticket_id: config.ticket_id.clone(),
    })
}

/// Remove a worktree after the ticket is done.
///
/// Equivalent to: git worktree remove <path> --force
pub fn remove(repo_root: &Path, worktree_path: &Path) -> Result<()> {
    let output = Command::new("git")
        .arg("worktree").arg("remove").arg(worktree_path).arg("--force")
        .current_dir(repo_root)
        .output()
        .context("failed to run git worktree remove")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git worktree remove failed: {}", stderr);
    }

    Ok(())
}

/// Build the environment variables to inject into the agent process.
/// Sets git author identity so commits show the agent's name.
pub fn agent_env(config: &WorktreeConfig, gh_token: &str) -> Vec<(String, String)> {
    vec![
        ("GIT_AUTHOR_NAME".to_string(), config.agent_name.clone()),
        ("GIT_AUTHOR_EMAIL".to_string(), config.agent_email.clone()),
        ("GIT_COMMITTER_NAME".to_string(), config.agent_name.clone()),
        ("GIT_COMMITTER_EMAIL".to_string(), config.agent_email.clone()),
        ("GH_TOKEN".to_string(), gh_token.to_string()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branch_name_format() {
        let branch = Worktree::branch_for("fix-billing-nil-guard");
        assert_eq!(branch, "feat/fix-billing-nil-guard");
    }

    #[test]
    fn worktree_path_format() {
        let root = PathBuf::from("/home/user/myrepo");
        let path = Worktree::path_for(&root, "ticket-42");
        assert_eq!(path, PathBuf::from("/home/user/myrepo/.worktrees/ticket-42"));
    }

    #[test]
    fn agent_env_sets_git_identity() {
        let config = WorktreeConfig {
            repo_root: PathBuf::from("/tmp/repo"),
            ticket_id: "t-1".to_string(),
            ticket_slug: "fix-thing".to_string(),
            agent_name: "Staff Engineer".to_string(),
            agent_email: "staff-engineer@poietai.ai".to_string(),
        };
        let env = agent_env(&config, "gh_token_abc");

        let git_author: Vec<_> = env.iter()
            .filter(|(k, _)| k == "GIT_AUTHOR_NAME")
            .collect();
        assert_eq!(git_author.len(), 1);
        assert_eq!(git_author[0].1, "Staff Engineer");

        let gh_tok: Vec<_> = env.iter()
            .filter(|(k, _)| k == "GH_TOKEN")
            .collect();
        assert_eq!(gh_tok[0].1, "gh_token_abc");
    }
}
