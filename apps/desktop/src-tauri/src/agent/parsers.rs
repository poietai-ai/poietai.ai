use serde::Serialize;

// ── Validate ──

#[derive(Debug, Clone, Serialize)]
pub struct ValidateResult {
    pub verified: usize,
    pub critical: usize,
    pub advisory: usize,
}

pub fn parse_validate_result(text: &str) -> ValidateResult {
    let mut verified = 0;
    let mut critical = 0;
    let mut advisory = 0;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("VERIFIED |") {
            verified += 1;
        } else if trimmed.starts_with("MISMATCH |") {
            let parts: Vec<&str> = trimmed.split('|').map(|p| p.trim()).collect();
            if parts.len() >= 3 && parts.last().map(|p| p.to_uppercase()) == Some("CRITICAL".into()) {
                critical += 1;
            } else {
                advisory += 1;
            }
        }
    }

    ValidateResult { verified, critical, advisory }
}

// ── QA ──

#[derive(Debug, Clone, Serialize)]
pub struct QaResult {
    pub critical: usize,
    pub warnings: usize,
    pub advisory: usize,
}

pub fn parse_qa_result(text: &str) -> QaResult {
    let mut critical = 0;
    let mut warnings = 0;
    let mut advisory = 0;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("CRITICAL |") {
            critical += 1;
        } else if trimmed.starts_with("WARNING |") {
            warnings += 1;
        } else if trimmed.starts_with("ADVISORY |") {
            advisory += 1;
        }
    }

    QaResult { critical, warnings, advisory }
}

// ── Security ──

#[derive(Debug, Clone, Serialize)]
pub struct SecurityResult {
    pub critical: usize,
    pub warnings: usize,
}

pub fn parse_security_result(text: &str) -> SecurityResult {
    let mut critical = 0;
    let mut warnings = 0;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("CRITICAL |") {
            critical += 1;
        } else if trimmed.starts_with("WARNING |") {
            warnings += 1;
        }
    }

    SecurityResult { critical, warnings }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_counts_verified_and_critical() {
        let text = "VERIFIED | widget renders | src/widget.tsx:10\nMISMATCH | missing null check | src/api.rs | CRITICAL\nMISMATCH | style differs | ADVISORY";
        let r = parse_validate_result(text);
        assert_eq!(r.verified, 1);
        assert_eq!(r.critical, 1);
        assert_eq!(r.advisory, 1);
    }

    #[test]
    fn qa_counts_all_severities() {
        let text = "CRITICAL | unused import | src/lib.rs:5\nWARNING | long function | src/main.rs\nADVISORY | consider renaming";
        let r = parse_qa_result(text);
        assert_eq!(r.critical, 1);
        assert_eq!(r.warnings, 1);
        assert_eq!(r.advisory, 1);
    }

    #[test]
    fn security_counts_critical_and_warnings() {
        let text = "CRITICAL | SQL Injection | raw query | src/db.rs:42\nWARNING | missing rate limit | src/api.rs";
        let r = parse_security_result(text);
        assert_eq!(r.critical, 1);
        assert_eq!(r.warnings, 1);
    }

    #[test]
    fn empty_input_returns_zeros() {
        assert_eq!(parse_validate_result("").verified, 0);
        assert_eq!(parse_qa_result("").critical, 0);
        assert_eq!(parse_security_result("").critical, 0);
    }
}
