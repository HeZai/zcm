use std::ffi::{OsStr, OsString};
use std::path::{Component, Path, PathBuf};

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
            return existing_path(&request_path);
        }

        if extension != CSS_MODULE_EXTENSION {
            return None;
        }
    }

    for extension in STYLE_EXTENSIONS {
        let candidate = path_with_appended_extension(&request_path, extension);
        if let Some(path) = existing_path(&candidate) {
            return Some(path);
        }
    }

    None
}

fn existing_path(path: &Path) -> Option<PathBuf> {
    path.exists().then(|| normalize_path(path))
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut prefix = PathBuf::new();
    let mut components: Vec<OsString> = Vec::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if components
                    .last()
                    .is_some_and(|value| value.as_os_str() != OsStr::new(".."))
                {
                    components.pop();
                } else if prefix.as_os_str().is_empty() {
                    components.push(OsString::from(".."));
                }
            }
            Component::Prefix(value) => prefix.push(value.as_os_str()),
            Component::RootDir => prefix.push(component.as_os_str()),
            Component::Normal(value) => components.push(value.to_os_string()),
        }
    }

    let mut normalized = prefix;
    for component in components {
        normalized.push(component);
    }
    normalized
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
    use std::io::ErrorKind;
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEMP_DIR_ID: AtomicUsize = AtomicUsize::new(0);

    fn temp_dir() -> std::path::PathBuf {
        loop {
            let unique = NEXT_TEMP_DIR_ID.fetch_add(1, Ordering::Relaxed);
            let dir =
                std::env::temp_dir().join(format!("zcm-test-{}-{unique}", std::process::id()));
            match fs::create_dir(&dir) {
                Ok(()) => return dir,
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("create temp dir: {error}"),
            }
        }
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
    fn resolves_parent_relative_import_with_normalized_path() {
        let dir = temp_dir();
        let source_dir = dir.join("src");
        let styles_dir = dir.join("styles");
        fs::create_dir_all(&source_dir).expect("create source dir");
        fs::create_dir_all(&styles_dir).expect("create styles dir");
        let src = source_dir.join("Button.tsx");
        fs::write(&src, "export {}").expect("write source");
        fs::write(styles_dir.join("Button.css"), ".button {}").expect("write css");

        let resolved = resolve_relative_stylesheet_import(Path::new(&src), "../styles/Button");

        assert_eq!(
            resolved.as_deref(),
            Some(styles_dir.join("Button.css").as_path())
        );
    }

    #[test]
    fn resolves_extensionless_relative_sass_import() {
        let dir = temp_dir();
        let src = dir.join("Button.tsx");
        fs::write(&src, "export {}").expect("write source");
        fs::write(dir.join("Button.sass"), ".button\n  color: red").expect("write sass");

        let resolved = resolve_relative_stylesheet_import(Path::new(&src), "./Button");

        assert_eq!(resolved.as_deref(), Some(dir.join("Button.sass").as_path()));
    }

    #[test]
    fn resolves_extensionless_relative_less_import() {
        let dir = temp_dir();
        let src = dir.join("Button.tsx");
        fs::write(&src, "export {}").expect("write source");
        fs::write(dir.join("Button.less"), ".button {}").expect("write less");

        let resolved = resolve_relative_stylesheet_import(Path::new(&src), "./Button");

        assert_eq!(resolved.as_deref(), Some(dir.join("Button.less").as_path()));
    }

    #[test]
    fn resolves_css_module_name_without_less_extension() {
        let dir = temp_dir();
        let src = dir.join("Card.ts");
        fs::write(&src, "export {}").expect("write source");
        fs::write(dir.join("Card.module.less"), ".card {}").expect("write less");

        let resolved = resolve_relative_stylesheet_import(Path::new(&src), "./Card.module");

        assert_eq!(
            resolved.as_deref(),
            Some(dir.join("Card.module.less").as_path())
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

    #[test]
    fn rejects_missing_explicit_stylesheet_import() {
        let dir = temp_dir();
        let src = dir.join("Missing.tsx");
        fs::write(&src, "export {}").expect("write source");

        let resolved = resolve_relative_stylesheet_import(Path::new(&src), "./Missing.css");

        assert!(resolved.is_none());
    }

    #[test]
    fn rejects_missing_extensionless_stylesheet_import() {
        let dir = temp_dir();
        let src = dir.join("Missing.tsx");
        fs::write(&src, "export {}").expect("write source");

        let resolved = resolve_relative_stylesheet_import(Path::new(&src), "./Missing");

        assert!(resolved.is_none());
    }

    #[test]
    fn keeps_unresolved_parent_components_for_relative_paths() {
        assert_eq!(
            super::normalize_path(Path::new("a/../../../x.css")),
            Path::new("../../x.css")
        );
    }
}
