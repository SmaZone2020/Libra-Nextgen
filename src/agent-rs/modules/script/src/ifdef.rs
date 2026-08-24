//! C#-MAUI-style preprocessor for Rhai plugin scripts.
//!
//! `#if(WINDOWS)` / `#elif(LINUX)` / `#else` / `#endif` are **preprocessor
//! directives** (exactly like C#'s `#if`): they are resolved BEFORE the script
//! is parsed, so the blocks for other platforms are textually removed and never
//! reach the Rhai engine. This mirrors MAUI's behavior more faithfully than a
//! runtime/Rhai-syntax construct would.
//!
//! Supported form: `#if(PLATFORM)` and `#if(PLATFORM1, PLATFORM2)`, where
//! platform names are case-insensitive. The `!` prefix negates a name
//! (e.g. `#if(!LINUX)`). Nesting is supported.

/// Resolve the conditional-compilation directives in `src` against the current
/// platform, returning the preprocessed source. Only the branches whose
/// condition matches `platform` are kept; inactive branches are dropped
/// (replaced by nothing), so their text never reaches the parser.
pub fn preprocess(src: &str, platform: &str) -> Result<String, String> {
    let mut out = String::with_capacity(src.len());
    let mut stack: Vec<Frame> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for (idx, raw_line) in src.lines().enumerate() {
        let line_no = idx + 1;
        let trimmed = raw_line.trim_start();

        // Only lines starting with '#' (at the start, allowing leading ws)
        // are directives.
        if trimmed.starts_with('#') {
            let directive = trimmed;
            if let Some(cond) = strip_prefix_ci(directive, "#if(") {
                let (names, negated) = parse_platforms(cond)?;
                let active = eval(&names, &negated, platform);
                stack.push(Frame { parent_active: current_active(&stack), active, any_taken: active, else_seen: false });
                continue;
            } else if let Some(cond) = strip_prefix_ci(directive, "#elif(") {
                let (names, negated) = parse_platforms(cond)?;
                match stack.last_mut() {
                    Some(frame) => {
                        if frame.else_seen {
                            errors.push(format!("line {}: #elif after #else", line_no));
                        }
                        frame.active = frame.parent_active && !frame.any_taken && eval(&names, &negated, platform);
                        frame.any_taken = frame.any_taken || frame.active;
                    }
                    None => errors.push(format!("line {}: #elif without #if", line_no)),
                }
                continue;
            } else if strip_prefix_ci(directive, "#else") == Some("") {
                match stack.last_mut() {
                    Some(frame) => {
                        if frame.else_seen {
                            errors.push(format!("line {}: duplicate #else", line_no));
                        }
                        frame.else_seen = true;
                        frame.active = frame.parent_active && !frame.any_taken;
                        frame.any_taken = true;
                    }
                    None => errors.push(format!("line {}: #else without #if", line_no)),
                }
                continue;
            } else if strip_prefix_ci(directive, "#endif") == Some("") {
                if stack.pop().is_none() {
                    errors.push(format!("line {}: #endif without #if", line_no));
                }
                continue;
            }
            // Not a recognized directive — treat as a normal line.
        }

        if current_active(&stack) {
            out.push_str(raw_line);
            out.push('\n');
        }
    }

    if !stack.is_empty() {
        errors.push("unterminated #if (missing #endif)".to_string());
    }
    if !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(out)
}

struct Frame {
    parent_active: bool,
    active: bool,
    any_taken: bool,
    else_seen: bool,
}

fn current_active(stack: &[Frame]) -> bool {
    stack.last().map(|f| f.active).unwrap_or(true)
}

/// Parse the inside of `#if(...)` into platform names + which are negated.
/// Input has already had the `#if(` prefix and trailing `)` stripped; a trailing
/// `)` from the original line is handled by the caller.
fn parse_platforms(cond: &str) -> Result<(Vec<String>, Vec<bool>), String> {
    // cond is everything after "#if(", so it may still have a trailing ")".
    let body = cond.trim_end();
    let body = body.strip_suffix(')').ok_or("missing ')' in #if directive")?;
    let mut names = Vec::new();
    let mut negated = Vec::new();
    for part in body.split(',') {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
        let (neg, name) = if let Some(rest) = p.strip_prefix('!') {
            (true, rest)
        } else {
            (false, p)
        };
        names.push(name.to_ascii_uppercase());
        negated.push(neg);
    }
    if names.is_empty() {
        return Err("empty platform list in #if".to_string());
    }
    Ok((names, negated))
}

fn eval(names: &[String], negated: &[bool], platform: &str) -> bool {
    let plat = platform.to_ascii_uppercase();
    // OR semantics: any matching (non-negated) or non-matching (negated) name.
    names.iter().zip(negated).any(|(name, &neg)| {
        let matches = name == &plat;
        if neg { !matches } else { matches }
    })
}

/// Case-insensitive prefix strip; returns the remainder if `s` starts with
/// `prefix` (ASCII case-insensitive), else `None`.
fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    if s.len() >= prefix.len() && s[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&s[prefix.len()..])
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_matching_branch() {
        let src = "#if(WINDOWS)\nlet x = 1;\n#else\nlet x = 2;\n#endif\n";
        let out = preprocess(src, "windows").unwrap();
        assert!(out.contains("let x = 1;"));
        assert!(!out.contains("let x = 2;"));
    }

    #[test]
    fn keeps_else_branch_when_no_match() {
        let src = "#if(WINDOWS)\nlet x = 1;\n#elif(LINUX)\nlet x = 2;\n#else\nlet x = 3;\n#endif\n";
        let out = preprocess(src, "macos").unwrap();
        assert!(out.contains("let x = 3;"));
        assert!(!out.contains("let x = 1;"));
        assert!(!out.contains("let x = 2;"));
    }

    #[test]
    fn negation() {
        let src = "#if(!LINUX)\nlet x = 1;\n#endif\n";
        assert!(preprocess(src, "windows").unwrap().contains("let x = 1;"));
        assert!(!preprocess(src, "linux").unwrap().contains("let x = 1;"));
    }

    #[test]
    fn missing_endif_is_error() {
        let src = "#if(WINDOWS)\nlet x = 1;\n";
        assert!(preprocess(src, "windows").is_err());
    }
}
