use std::path::{Path, PathBuf};

const STYLE_EXTENSIONS: [&str; 4] = ["css", "scss", "sass", "less"];
const CSS_MODULE_EXTENSION: &str = "module";

#[allow(dead_code)]
pub fn resolve_relative_stylesheet_import(source_file: &Path, specifier: &str) -> Option<PathBuf> {
    if !(specifier.starts_with("./") || specifier.starts_with("../")) {
        return None;
    }

    let base_dir = source_file.parent()?;
    let request_path = base_dir.join(specifier);

    if let Some(extension) = request_path.extension().and_then(|value| value.to_str()) {
        if STYLE_EXTENSIONS.contains(&extension) {
            return request_path.exists().then_some(request_path);
        }

        if extension != CSS_MODULE_EXTENSION {
            return None;
        }
    }

    for extension in STYLE_EXTENSIONS {
        let candidate = path_with_appended_extension(&request_path, extension);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

fn path_with_appended_extension(path: &Path, extension: &str) -> PathBuf {
    let mut candidate = path.as_os_str().to_os_string();
    candidate.push(".");
    candidate.push(extension);
    PathBuf::from(candidate)
}

#[cfg(test)]
mod tests {
    use super::resolve_relative_stylesheet_import;
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("zcm-test-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn resolves_extensionless_relative_css_import() {
        let dir = temp_dir();
        let src = dir.join("Button.tsx");
        fs::write(&src, "export {}").expect("write source");
        fs::write(dir.join("Button.css"), ".button {}").expect("write css");

        let resolved = resolve_relative_stylesheet_import(Path::new(&src), "./Button");

        assert_eq!(resolved.as_deref(), Some(dir.join("Button.css").as_path()));
    }

    #[test]
    fn resolves_explicit_scss_import() {
        let dir = temp_dir();
        let src = dir.join("Card.ts");
        fs::write(&src, "export {}").expect("write source");
        fs::write(dir.join("Card.module.scss"), ".card {}").expect("write scss");

        let resolved = resolve_relative_stylesheet_import(Path::new(&src), "./Card.module.scss");

        assert_eq!(
            resolved.as_deref(),
            Some(dir.join("Card.module.scss").as_path())
        );
    }

    #[test]
    fn resolves_css_module_name_without_style_extension() {
        let dir = temp_dir();
        let src = dir.join("Card.ts");
        fs::write(&src, "export {}").expect("write source");
        fs::write(dir.join("Card.module.scss"), ".card {}").expect("write scss");

        let resolved = resolve_relative_stylesheet_import(Path::new(&src), "./Card.module");

        assert_eq!(
            resolved.as_deref(),
            Some(dir.join("Card.module.scss").as_path())
        );
    }

    #[test]
    fn rejects_non_relative_imports() {
        let dir = temp_dir();
        let src = dir.join("app.js");
        fs::write(&src, "export {}").expect("write source");

        let resolved = resolve_relative_stylesheet_import(Path::new(&src), "styles/button");

        assert!(resolved.is_none());
    }

    #[test]
    fn rejects_explicit_non_stylesheet_extension() {
        let dir = temp_dir();
        let src = dir.join("Widget.tsx");
        fs::write(&src, "export {}").expect("write source");
        fs::write(dir.join("Widget.txt"), "not styles").expect("write text");

        let resolved = resolve_relative_stylesheet_import(Path::new(&src), "./Widget.txt");

        assert!(resolved.is_none());
    }
}
