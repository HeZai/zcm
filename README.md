# zcm

zcm is a CSS Modules language service extension for Zed with direct support for CSS, SCSS, Sass, and Less stylesheet modules. It is based on `cssmodules-language-server@1.5.2` and provides CSS Modules class name completion, go-to-definition, hover, and reference lookup for JavaScript, TypeScript, TSX, and common stylesheet files.

## Features

- CSS Modules class name completion: suggests class names from stylesheet files in expressions such as `styles.` or `styles[""]`.
- Go to definition: jumps from references such as `styles.foo` and `styles["foo-bar"]` to the corresponding stylesheet class declaration.
- Hover: shows language service style information for CSS Modules class name references.
- Find references: finds usages of the same class name from CSS Modules references in source files.
- SCSS, Sass, and Less support: resolves and serves CSS Modules from `.scss`, `.sass`, and `.less` stylesheets as first-class module sources.
- Reverse lookup from stylesheet declarations: running Find All References on class declarations in CSS, SCSS, Sass, or Less files can locate source positions that import and use that class name.
- Extensionless import resolution: supports relative imports that omit the stylesheet extension, such as `import styles from "./Button"` and `import styles from "./Button.module"`.
- Default camelCase support: the extension enables `camelCase: true` by default, so `.primary-button` can be used as `styles.primaryButton`.

## How zcm differs from CSS Modules Kit

CSS Modules Kit provides a broader TypeScript language service plugin and tooling stack. zcm is intentionally narrower: it wraps `cssmodules-language-server@1.5.2` for users who want CSS Modules completions and navigation without adopting CSS Modules Kit project configuration.

The main distinction is stylesheet coverage. zcm directly resolves CSS Modules imports for CSS, SCSS, Sass, and Less, including extensionless relative imports such as `./Button`, `./Button.module`, `./Button.module.scss`, and `./Button.module.less`. It also enables `camelCase` by default for class names such as `.primary-button`.

## Support Scope

zcm registers with the following Zed languages:

- JavaScript
- TypeScript
- TSX
- CSS
- SCSS
- LESS

Supported stylesheet imports include:

- `./*.css`
- `./*.scss`
- `./*.sass`
- `./*.less`
- Relative imports without a stylesheet extension, such as `./Button` and `./Button.module`

Explicit imports of files with other extensions, such as `./foo.txt`, are ignored.

## Requirements

- Node.js 18 or newer.
- This requirement comes from `cssmodules-language-server@1.5.2`, which declares `engines.node >=18`.
- If the current Node.js version is too old, zcm exits before launching the language service and prints the current Node.js version.

## Current Limitations

- Only relative imports are handled. `tsconfig` path aliases, bundler aliases, and framework-specific path aliases are not supported.
- Supported stylesheet suffixes are limited to `css`, `scss`, `sass`, and `less`.
- Find All References only scans JavaScript, TypeScript, and TSX files in the workspace.
- Reference matching only covers CSS Modules alias forms such as `styles.foo` and `styles["foo-bar"]`, plus stylesheet class declarations imported through those aliases.
- Plain string class names, such as `className="foo"`, are not treated as references.
- JSX files are not registered in the initial language scope.

## License

This project uses the MIT License. See [LICENSE](LICENSE) for details.
