mod paths;

use std::fs;
use std::path::{Path, PathBuf};
use zed_extension_api::serde_json::{json, Value};
use zed_extension_api::{
    self as zed, node_binary_path, npm_install_package, npm_package_installed_version, Command,
    Extension, LanguageServerId, Result, Worktree,
};

const PACKAGE_NAME: &str = "cssmodules-language-server";
const PACKAGE_VERSION: &str = "1.5.2";
const SERVER_PATH: &str = "server.js";
const SERVER_SOURCE: &str = include_str!("../server.js");

struct ZcmExtension {
    installed_version: Option<String>,
}

impl Extension for ZcmExtension {
    fn new() -> Self {
        Self {
            installed_version: None,
        }
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<Command> {
        self.ensure_language_server_installed()?;
        let server_path = self.ensure_server_proxy_written()?;

        let node = node_binary_path()?;
        let env = worktree.shell_env();

        Ok(Command {
            command: node,
            args: language_server_args(&server_path),
            env,
        })
    }

    fn language_server_initialization_options(
        &mut self,
        _language_server_id: &LanguageServerId,
        _worktree: &Worktree,
    ) -> Result<Option<Value>> {
        Ok(Some(json!({
            "camelCase": true,
        })))
    }
}

impl ZcmExtension {
    fn ensure_language_server_installed(&mut self) -> Result<()> {
        if self.installed_version.as_deref() == Some(PACKAGE_VERSION) {
            return Ok(());
        }

        let installed_version = npm_package_installed_version(PACKAGE_NAME)?;
        if installed_version.as_deref() != Some(PACKAGE_VERSION) {
            npm_install_package(PACKAGE_NAME, PACKAGE_VERSION)?;
        }

        self.installed_version = Some(PACKAGE_VERSION.to_string());
        Ok(())
    }

    fn ensure_server_proxy_written(&self) -> Result<String> {
        let extension_work_dir = std::env::current_dir()
            .map_err(|error| format!("failed to resolve zcm extension work directory: {error}"))?;
        ensure_server_proxy_written_in_dir(&extension_work_dir)
    }
}

fn server_proxy_path(extension_work_dir: &Path) -> PathBuf {
    extension_work_dir.join(SERVER_PATH)
}

fn ensure_server_proxy_written_in_dir(extension_work_dir: &Path) -> Result<String> {
    let server_path = server_proxy_path(extension_work_dir);

    if fs::read_to_string(&server_path).ok().as_deref() != Some(SERVER_SOURCE) {
        fs::write(&server_path, SERVER_SOURCE).map_err(|error| {
            format!(
                "failed to write zcm server proxy to {}: {error}",
                server_path.display()
            )
        })?;
    }

    server_path.to_str().map(ToOwned::to_owned).ok_or_else(|| {
        format!(
            "zcm server proxy path is not valid UTF-8: {}",
            server_path.display()
        )
    })
}

fn language_server_args(server_path: &str) -> Vec<String> {
    vec![server_path.to_string(), "--stdio".to_string()]
}

zed::register_extension!(ZcmExtension);

#[cfg(test)]
mod tests {
    use super::{ensure_server_proxy_written_in_dir, language_server_args, server_proxy_path};
    use std::fs;
    use std::io::ErrorKind;
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEMP_DIR_ID: AtomicUsize = AtomicUsize::new(0);

    fn temp_dir() -> std::path::PathBuf {
        loop {
            let unique = NEXT_TEMP_DIR_ID.fetch_add(1, Ordering::Relaxed);
            let dir =
                std::env::temp_dir().join(format!("zcm-lib-test-{}-{unique}", std::process::id()));
            match fs::create_dir(&dir) {
                Ok(()) => return dir,
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("create temp dir: {error}"),
            }
        }
    }

    #[test]
    fn language_server_command_uses_absolute_extensionless_import_proxy() {
        assert_eq!(
            language_server_args("/zed/extensions/work/zcm/server.js"),
            vec![
                "/zed/extensions/work/zcm/server.js".to_string(),
                "--stdio".to_string()
            ]
        );
    }

    #[test]
    fn server_proxy_path_lives_in_extension_work_dir() {
        assert_eq!(
            server_proxy_path(Path::new("/zed/extensions/work/zcm")),
            Path::new("/zed/extensions/work/zcm/server.js")
        );
    }

    #[test]
    fn writes_server_proxy_when_missing() {
        let dir = temp_dir();
        let server_path = dir.join("server.js");

        let written_path = ensure_server_proxy_written_in_dir(&dir).expect("write server proxy");

        assert_eq!(written_path, server_path.to_string_lossy());
        assert_eq!(
            fs::read_to_string(server_path).expect("read server proxy"),
            super::SERVER_SOURCE
        );
    }

    #[test]
    fn updates_server_proxy_when_stale() {
        let dir = temp_dir();
        let server_path = dir.join("server.js");
        fs::write(&server_path, "stale proxy").expect("write stale proxy");

        ensure_server_proxy_written_in_dir(&dir).expect("write server proxy");

        assert_eq!(
            fs::read_to_string(server_path).expect("read server proxy"),
            super::SERVER_SOURCE
        );
    }

    #[test]
    fn keeps_existing_server_proxy_when_current() {
        let dir = temp_dir();
        let server_path = dir.join("server.js");
        fs::write(&server_path, super::SERVER_SOURCE).expect("write current proxy");
        let mut permissions = fs::metadata(&server_path)
            .expect("read proxy metadata")
            .permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&server_path, permissions).expect("make proxy readonly");

        ensure_server_proxy_written_in_dir(&dir).expect("write server proxy");

        assert_eq!(
            fs::read_to_string(server_path).expect("read server proxy"),
            super::SERVER_SOURCE
        );
    }
}
