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
        let server_path =
            server_proxy_path(&std::env::current_dir().map_err(|error| {
                format!("failed to resolve zcm extension work directory: {error}")
            })?);

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
}

fn server_proxy_path(extension_work_dir: &Path) -> PathBuf {
    extension_work_dir.join(SERVER_PATH)
}

fn language_server_args(server_path: &str) -> Vec<String> {
    vec![server_path.to_string(), "--stdio".to_string()]
}

zed::register_extension!(ZcmExtension);

#[cfg(test)]
mod tests {
    use super::{language_server_args, server_proxy_path};
    use std::path::Path;

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
}
