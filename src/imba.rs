use std::{env, fs};
use zed_extension_api::{self as zed, Result};

const IMBA_TAGS_LSP: &str = include_str!("../server/imba-tags-lsp.js");

struct ImbaExtension;

impl zed::Extension for ImbaExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let server_directory = env::current_dir()
            .map_err(|err| format!("failed to read extension work directory: {err}"))?
            .join("server");
        fs::create_dir_all(&server_directory)
            .map_err(|err| format!("failed to create Imba language server directory: {err}"))?;

        let server_path = server_directory.join("imba-tags-lsp.js");
        fs::write(&server_path, IMBA_TAGS_LSP)
            .map_err(|err| format!("failed to write Imba language server: {err}"))?;

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                server_path.to_string_lossy().to_string(),
                "--stdio".to_string(),
            ],
            env: Default::default(),
        })
    }
}

zed::register_extension!(ImbaExtension);
