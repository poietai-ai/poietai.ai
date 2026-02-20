use std::process::Command;
use std::time::Duration;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::time::interval;

/// A single PR review from GitHub.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PrReview {
    pub author: String,
    pub body: String,
    pub state: String, // "APPROVED", "CHANGES_REQUESTED", "COMMENTED"
    pub submitted_at: String,
}

/// Payload emitted to React when a new CI review arrives.
#[derive(Debug, Clone, Serialize)]
pub struct ReviewPayload {
    pub agent_id: String,
    pub ticket_id: String,
    pub pr_number: u32,
    pub review: PrReview,
}

/// Raw shape of `gh pr view --json reviews` output.
#[derive(Deserialize)]
struct GhPrViewOutput {
    reviews: Vec<PrReview>,
}

/// Fetch current reviews for a PR using the `gh` CLI.
pub fn fetch_reviews(repo: &str, pr_number: u32) -> Result<Vec<PrReview>> {
    let output = Command::new("gh")
        .args(["pr", "view", &pr_number.to_string(),
               "--repo", repo,
               "--json", "reviews"])
        .output()
        .context("failed to run gh pr view")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gh pr view failed: {}", stderr);
    }

    let parsed: GhPrViewOutput = serde_json::from_slice(&output.stdout)
        .context("failed to parse gh pr view output")?;

    Ok(parsed.reviews)
}

/// Poll a PR for new CI reviews, emitting a Tauri event when one arrives.
///
/// Runs in a background tokio task. Stops when the PR is approved or after
/// max_polls attempts.
pub async fn poll_pr(
    app: AppHandle,
    repo: String,
    pr_number: u32,
    agent_id: String,
    ticket_id: String,
    poll_interval_secs: u64,
) {
    let mut ticker = interval(Duration::from_secs(poll_interval_secs));
    let mut seen_count = 0usize;
    let max_polls = 120; // 60 minutes at 30s intervals

    for _ in 0..max_polls {
        ticker.tick().await;

        let reviews = match fetch_reviews(&repo, pr_number) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("poller: error fetching reviews for PR #{}: {}", pr_number, e);
                continue;
            }
        };

        // Only emit events for reviews we haven't seen yet
        if reviews.len() > seen_count {
            for review in reviews.iter().skip(seen_count) {
                let payload = ReviewPayload {
                    agent_id: agent_id.clone(),
                    ticket_id: ticket_id.clone(),
                    pr_number,
                    review: review.clone(),
                };
                let _ = app.emit("pr-review", &payload);

                // Approved — no need to keep polling
                if review.state == "APPROVED" {
                    return;
                }
            }
            seen_count = reviews.len();
        }
    }

    eprintln!("poller: max polls ({}) reached for PR #{}", max_polls, pr_number);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pr_review_deserializes() {
        let json = r#"{"author":"ci-claude[bot]","body":"LGTM — clean implementation.","state":"APPROVED","submitted_at":"2026-02-20T10:00:00Z"}"#;
        let review: PrReview = serde_json::from_str(json).unwrap();
        assert_eq!(review.state, "APPROVED");
        assert_eq!(review.author, "ci-claude[bot]");
    }

    #[test]
    fn gh_pr_view_parses_reviews_array() {
        let json = r#"{"reviews":[{"author":"ci-claude[bot]","body":"LGTM","state":"APPROVED","submitted_at":"2026-02-20T10:00:00Z"}]}"#;
        let parsed: GhPrViewOutput = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.reviews.len(), 1);
        assert_eq!(parsed.reviews[0].state, "APPROVED");
    }

    #[test]
    fn gh_pr_view_parses_empty_reviews() {
        let json = r#"{"reviews":[]}"#;
        let parsed: GhPrViewOutput = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.reviews.len(), 0);
    }
}
