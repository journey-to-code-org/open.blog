//! Read-only draft of a Git history. Generated labels are still author-reviewed.

use crate::git::Git;
use std::collections::HashMap;
use std::path::Path;

const LIMIT: usize = 30;
pub const USAGE: &str = "usage: openblog diagram git [--repo <path>] --from <ref> --to <ref>";

fn resolve(git: &Git, value: &str) -> Result<String, String> {
    if value.is_empty() || value.starts_with('-') {
        return Err("Git refs must be nonempty and cannot start with '-'".into());
    }
    let revision = format!("{value}^{{commit}}");
    git.run(&["rev-parse", "--verify", "--end-of-options", &revision])
        .map(|id| id.trim().to_owned())
        .map_err(|error| format!("cannot resolve Git ref `{value}`: {error}"))
}

fn label(value: &str, max: usize) -> String {
    let redacted = value
        .split_whitespace()
        .map(|word| {
            if word.contains('@')
                || word
                    .as_bytes()
                    .split(|c| !c.is_ascii_hexdigit())
                    .any(|part| part.len() >= 40)
            {
                "[redacted]"
            } else {
                word
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    let clean: String = redacted
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.') {
                c
            } else {
                ' '
            }
        })
        .collect();
    let words = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let shortened: String = words.chars().take(max).collect();
    if words.chars().count() > max {
        format!("{shortened}...")
    } else {
        shortened
    }
}

pub fn draft(repo: &Path, from: &str, to: &str) -> Result<String, String> {
    let git = Git::new(repo);
    let from = resolve(&git, from)?;
    let to = resolve(&git, to)?;
    let range = format!("{from}..{to}");
    let raw = git
        .run(&[
            "--no-pager",
            "log",
            "--topo-order",
            "--reverse",
            "--max-count=31",
            "--format=%H%x1f%P%x1f%s%x1f%D",
            &range,
            "--",
        ])
        .map_err(|error| format!("cannot read Git history: {error}"))?;
    let records = raw.lines().collect::<Vec<_>>();
    if records.is_empty() {
        return Err("the selected Git range contains no commits".into());
    }
    let summarized = records.len() > LIMIT;
    let records = if summarized {
        &records[records.len() - LIMIT..]
    } else {
        &records[..]
    };
    let mut output = String::from(
        "Review branch names, tags and commit subjects before sharing this draft; they may contain sensitive information. Author metadata is omitted, and email addresses and full hashes in labels are redacted on a best-effort basis. Add an accTitle and accDescr before publishing.\n\n```mermaid\n\
gitGraph\n  commit id: \"Starting point\"\n",
    );
    if summarized {
        output.push_str("  commit id: \"Earlier history omitted\"\n");
    }
    let mut branches = HashMap::new();
    let mut review = Vec::new();
    for (index, record) in records.iter().enumerate() {
        let fields = record.splitn(4, '\u{1f}').collect::<Vec<_>>();
        if fields.len() != 4 {
            return Err("Git returned an unexpected history record".into());
        }
        let name = format!("change{}", index + 1);
        let parents = fields[1].split_whitespace().collect::<Vec<_>>();
        if parents
            .first()
            .is_some_and(|id| *id != from && !branches.contains_key(*id))
        {
            review.push(format!(
                "Change {} has a first parent outside the displayed history.",
                index + 1
            ));
        }
        let parent = parents
            .first()
            .and_then(|id| branches.get(*id))
            .map_or("main", String::as_str);
        output.push_str(&format!("  checkout {parent}\n  branch {name}\n"));
        let subject = label(fields[2], 64);
        let commit_label = format!("{} {}", index + 1, subject);
        let tag = fields[3]
            .split(", ")
            .find_map(|decoration| decoration.strip_prefix("tag: "))
            .map(|tag| label(tag, 64))
            .filter(|tag| !tag.is_empty())
            .map_or_else(String::new, |tag| format!(" tag: \"{tag}\""));
        if let Some(other) = parents.get(1).and_then(|id| branches.get(*id)) {
            output.push_str(&format!("  merge {other} id: \"{commit_label}\"{tag}\n"));
            if parents.len() > 2 {
                review.push(format!(
                    "Change {} has {} parents; only its first two are represented.",
                    index + 1,
                    parents.len()
                ));
            }
        } else {
            output.push_str(&format!("  commit id: \"{commit_label}\"{tag}\n"));
            if parents.len() > 1 {
                review.push(format!(
                    "Change {} merges history outside the displayed range.",
                    index + 1
                ));
            }
        }
        let decorations = label(fields[3], 200);
        if !decorations.is_empty() {
            review.push(format!("Change {} refs: {decorations}", index + 1));
        }
        branches.insert(fields[0].to_owned(), name);
    }
    output.push_str("```\n");
    if summarized {
        review.push(format!(
            "The range exceeds {LIMIT} commits; only the newest {LIMIT} are shown."
        ));
    }
    if !review.is_empty() {
        output.push_str("\nReview notes:\n");
        for line in review {
            output.push_str(&format!("- {line}\n"));
        }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_do_not_break_the_fence_or_quoted_mermaid_ids() {
        assert_eq!(label("hello \"x\" ``` <b>\nsecond", 64), "hello x b second");
        assert_eq!(label("long value", 4), "long...");
        assert_eq!(
            label(
                "me@example.test 0123456789012345678901234567890123456789",
                64
            ),
            "redacted redacted"
        );
    }

    #[test]
    fn bad_repository_and_refs_are_reported() {
        assert!(draft(Path::new("."), "--help", "HEAD")
            .unwrap_err()
            .contains("cannot start"));
        assert!(draft(Path::new("."), "not-a-real-ref", "HEAD")
            .unwrap_err()
            .contains("cannot resolve"));
    }
}
