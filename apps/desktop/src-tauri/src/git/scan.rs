use std::path::Path;
use std::process::Command;
use serde::Serialize;

#[derive(Serialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FolderScanResult {
    SingleRepo {
        name: String,
        repo_root: String,
        remote_url: Option<String>,
        provider: Option<String>,
    },
    MultiRepo {
        repos: Vec<RepoInfo>,
        suggested_name: String,
    },
    NoRepo,
}

#[derive(Serialize, Debug)]
pub struct RepoInfo {
    pub name: String,
    pub repo_root: String,
    pub remote_url: Option<String>,
    pub provider: Option<String>,
}

pub fn detect_provider(remote_url: &str) -> Option<&'static str> {
    if remote_url.contains("github.com") { Some("github") }
    else if remote_url.contains("gitlab.com") { Some("gitlab") }
    else if remote_url.contains("bitbucket.org") { Some("bitbucket") }
    else if remote_url.contains("dev.azure.com") || remote_url.contains("visualstudio.com") { Some("azure") }
    else { None }
}

pub fn get_remote_url(path: &Path) -> Option<String> {
    Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(path)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn scan_folder(path: &Path) -> FolderScanResult {
    // Case 1: path itself is a git repo
    if path.join(".git").exists() {
        let name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let remote_url = get_remote_url(path);
        let provider = remote_url.as_deref()
            .and_then(detect_provider)
            .map(String::from);
        return FolderScanResult::SingleRepo {
            name,
            repo_root: path.to_string_lossy().to_string(),
            remote_url,
            provider,
        };
    }

    // Case 2: scan one level deep for git repos
    let mut repos: Vec<RepoInfo> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        let mut sorted: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        sorted.sort_by_key(|e| e.file_name());
        for entry in sorted {
            let sub = entry.path();
            if sub.is_dir() && sub.join(".git").exists() {
                let name = entry.file_name().to_string_lossy().to_string();
                let remote_url = get_remote_url(&sub);
                let provider = remote_url.as_deref()
                    .and_then(detect_provider)
                    .map(String::from);
                repos.push(RepoInfo {
                    name,
                    repo_root: sub.to_string_lossy().to_string(),
                    remote_url,
                    provider,
                });
            }
        }
    }

    if repos.is_empty() {
        FolderScanResult::NoRepo
    } else {
        let suggested_name = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        FolderScanResult::MultiRepo { repos, suggested_name }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_github_https() {
        assert_eq!(detect_provider("https://github.com/user/repo"), Some("github"));
    }

    #[test]
    fn detects_github_ssh() {
        assert_eq!(detect_provider("git@github.com:user/repo.git"), Some("github"));
    }

    #[test]
    fn detects_gitlab() {
        assert_eq!(detect_provider("https://gitlab.com/user/repo"), Some("gitlab"));
    }

    #[test]
    fn detects_bitbucket() {
        assert_eq!(detect_provider("https://bitbucket.org/user/repo"), Some("bitbucket"));
    }

    #[test]
    fn detects_azure() {
        assert_eq!(detect_provider("https://dev.azure.com/org/project/_git/repo"), Some("azure"));
    }

    #[test]
    fn returns_none_for_unknown_host() {
        assert_eq!(detect_provider("https://custom-git.company.com/repo"), None);
    }
}
