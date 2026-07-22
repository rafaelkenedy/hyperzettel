use sha2::{Digest, Sha256};

use crate::knowledge::domain::RELATION_CONFIG;

const EMBEDDING_PREFIX: &str = "task: sentence similarity | query:";
const IGNORED_BLOCKS: [&str; 4] = ["script", "style", "svg", "canvas"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedNoteText {
    pub value: String,
    pub content_hash: String,
}

pub fn prepare_note_text(title: &str, content: &str, tags: &[String]) -> PreparedNoteText {
    let normalized_title = normalize_semantic_text(title);
    let normalized_content = normalize_semantic_text(content);
    let normalized_tags = normalize_tags(tags);

    let mut sections = vec![EMBEDDING_PREFIX.to_owned()];
    if !normalized_title.is_empty() {
        sections.push(format!("Título: {normalized_title}"));
    }
    if !normalized_content.is_empty() {
        sections.push(normalized_content.clone());
    }
    if !normalized_tags.is_empty() {
        sections.push(format!("Tags: {}", normalized_tags.join(", ")));
    }
    let value = sections.join("\n\n");

    let mut hasher = Sha256::new();
    for component in [
        RELATION_CONFIG.pipeline_version,
        RELATION_CONFIG.model_id,
        RELATION_CONFIG.model_variant,
        &RELATION_CONFIG.persisted_dimensions.to_string(),
        EMBEDDING_PREFIX,
        &normalized_title,
        &normalized_content,
        &normalized_tags.join("\u{1f}"),
    ] {
        hasher.update(component.as_bytes());
        hasher.update([0]);
    }

    PreparedNoteText {
        value,
        content_hash: hex::encode(hasher.finalize()),
    }
}

pub fn normalize_semantic_text(value: &str) -> String {
    let without_ignored = remove_ignored_blocks(value);
    let without_tags = strip_tags(&without_ignored);
    let decoded = decode_entities(&without_tags);
    let without_technical_tokens = decoded
        .lines()
        .map(|line| {
            line.split_whitespace()
                .filter(|token| !is_internal_uuid(token) && !is_technical_date(token))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n");
    collapse_whitespace(&without_technical_tokens)
}

fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut result = tags
        .iter()
        .map(|tag| normalize_semantic_text(tag))
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>();
    result.sort_by_key(|tag| tag.to_lowercase());
    result.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    result
}

fn remove_ignored_blocks(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    let mut result = value.to_owned();
    for tag in IGNORED_BLOCKS {
        let mut search_from = 0;
        loop {
            let lowered = result.to_ascii_lowercase();
            let Some(relative_start) = lowered[search_from..].find(&format!("<{tag}")) else {
                break;
            };
            let start = search_from + relative_start;
            let Some(relative_end) = lowered[start..].find(&format!("</{tag}>")) else {
                result.truncate(start);
                break;
            };
            let end = start + relative_end + tag.len() + 3;
            result.replace_range(start..end, " ");
            search_from = start + 1;
        }
    }
    result
}

fn strip_tags(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '<' {
            output.push(character);
            continue;
        }
        let mut tag = String::new();
        for next in characters.by_ref() {
            if next == '>' {
                break;
            }
            tag.push(next);
        }
        let name = tag
            .trim()
            .trim_start_matches('/')
            .split_ascii_whitespace()
            .next()
            .unwrap_or_default()
            .trim_end_matches('/')
            .to_ascii_lowercase();
        if matches!(
            name.as_str(),
            "br" | "p"
                | "div"
                | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "li"
                | "blockquote"
                | "pre"
        ) {
            output.push('\n');
        } else {
            output.push(' ');
        }
    }
    output
}

fn decode_entities(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut remaining = value;
    while let Some(start) = remaining.find('&') {
        output.push_str(&remaining[..start]);
        let candidate = &remaining[start + 1..];
        let Some(end) = candidate.find(';') else {
            output.push_str(&remaining[start..]);
            return output;
        };
        let entity = &candidate[..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "apos" | "#39" => Some('\''),
            "gt" => Some('>'),
            "lt" => Some('<'),
            "nbsp" => Some(' '),
            "quot" => Some('"'),
            _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                u32::from_str_radix(&entity[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
            }
            _ if entity.starts_with('#') => {
                entity[1..].parse::<u32>().ok().and_then(char::from_u32)
            }
            _ => None,
        };
        if let Some(character) = decoded {
            output.push(character);
        } else {
            output.push('&');
            output.push_str(entity);
            output.push(';');
        }
        remaining = &candidate[end + 1..];
    }
    output.push_str(remaining);
    output
}

fn collapse_whitespace(value: &str) -> String {
    value
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_owned()
}

fn is_internal_uuid(token: &str) -> bool {
    let token = token
        .trim_matches(|character: char| !character.is_ascii_alphanumeric() && character != '-');
    token.len() == 36
        && [8, 13, 18, 23]
            .iter()
            .all(|index| token.as_bytes()[*index] == b'-')
        && token.chars().enumerate().all(|(index, character)| {
            [8, 13, 18, 23].contains(&index) || character.is_ascii_hexdigit()
        })
}

fn is_technical_date(token: &str) -> bool {
    let token = token.trim_matches(|character: char| matches!(character, ',' | ';' | '(' | ')'));
    token.contains('T') && chrono::DateTime::parse_from_rfc3339(token).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preparation_is_deterministic_and_uses_embeddinggemma_prefix() {
        let tags = vec!["Rust".to_owned(), "  IA ".to_owned()];
        let first = prepare_note_text("Título", "<p>Conteúdo</p>", &tags);
        let second = prepare_note_text("Título", "<p>Conteúdo</p>", &tags);
        assert_eq!(first, second);
        assert!(first.value.starts_with(EMBEDDING_PREFIX));
        assert!(first.value.contains("Título: Título"));
        assert!(first.value.contains("Tags: IA, Rust"));
    }

    #[test]
    fn removes_html_and_ignored_blocks_but_preserves_accents_code_and_headings() {
        let text = normalize_semantic_text(
      "<h2>Relações semânticas</h2><script>roubar()</script><p>Use <code>let ação = 1;</code></p>",
    );
        assert_eq!(text, "Relações semânticas\nUse let ação = 1;");
    }

    #[test]
    fn ignores_internal_uuids_and_technical_dates() {
        let text = normalize_semantic_text(
            "Ideia 550e8400-e29b-41d4-a716-446655440000 atualizada 2026-07-21T12:30:00Z agora",
        );
        assert_eq!(text, "Ideia atualizada agora");
    }

    #[test]
    fn hash_changes_with_content_and_pipeline_inputs_are_stable() {
        let first = prepare_note_text("A", "um", &[]);
        let second = prepare_note_text("A", "dois", &[]);
        assert_ne!(first.content_hash, second.content_hash);
        assert_eq!(first.content_hash.len(), 64);
    }
}
