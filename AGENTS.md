# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Zed CSS Modules extension named `zcm`. Rust extension code lives in `src/`: `lib.rs` registers the Zed extension, installs `cssmodules-language-server@1.5.2`, and launches the Node proxy; `paths.rs` contains stylesheet import resolution helpers and unit tests. The Node proxy is `server.js`, with tests in `server.test.js`. `fixtures/` holds small JavaScript, TypeScript, TSX, CSS, SCSS, and Less samples used to exercise import resolution behavior. Extension metadata is in `extension.toml`; `extension.wasm` is a built artifact and should only change when intentionally rebuilding the extension.

## Build, Test, and Development Commands

- `cargo test`: runs Rust unit tests for extension arguments and path resolution.
- `node --test server.test.js`: runs Node tests for the language-server proxy patch.
- `cargo build`: checks the Rust crate on the host toolchain.
- `cargo fmt`: formats Rust files before committing.
- `cargo clippy --all-targets`: runs Rust lint checks when Clippy is installed.
- `cargo build --target wasm32-wasip1 --release`: builds a release WASM artifact for Zed when the target is installed.

## Zed Extension Reference

- Zed extensions overview: https://zed.dev/docs/extensions
- Developing extensions: https://zed.dev/docs/extensions/developing-extensions
- Language extensions: https://zed.dev/docs/extensions/languages
- Rust extension API: https://docs.rs/zed_extension_api/latest/zed_extension_api/

## Coding Style & Naming Conventions

Use Rust 2021 defaults and `cargo fmt`; prefer four-space indentation and `snake_case` for Rust functions, modules, and variables. Keep constants in `SCREAMING_SNAKE_CASE`. JavaScript uses CommonJS, `"use strict"`, two-space indentation, semicolons, and descriptive camelCase helpers such as `resolveRelativeStylesheetImport`. Keep parsing and path logic small and covered by tests.

## Testing Guidelines

Add Rust tests beside the module under `#[cfg(test)]` and Node tests in `server.test.js` using `node:assert/strict` and `node:test`. Name tests by behavior, for example `resolves_css_module_name_without_style_extension`. Cover supported suffixes (`css`, `scss`, `sass`, `less`), extensionless imports, and rejection paths for non-relative or non-stylesheet imports.

## Commit & Pull Request Guidelines

Git history currently uses very short messages such as `v1`; for new work, use concise imperative or scoped messages, for example `Add extensionless Less import test`. Pull requests should describe the user-visible behavior, list validation commands run, and mention any change to `extension.toml`, `server.js`, or the generated `extension.wasm`. Include screenshots only when the Zed UI behavior changes.
