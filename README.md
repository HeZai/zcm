# zcm

Zed CSS Modules extension.

## Scope

- Registers a Rust/WASM Zed extension named `zcm`
- Starts `cssmodules-language-server@1.5.2`
- Enables CSS Modules completions, go-to-definition, hover, and references for relative stylesheet imports from JavaScript, TypeScript, and TSX buffers
- Enables Find All References from CSS Modules alias usages and stylesheet class declarations in CSS, SCSS, and LESS buffers
- Uses `camelCase: true` by default

## Requirements

- Node.js 18 or newer
- This minimum follows `cssmodules-language-server@1.5.2`, which declares `engines.node >=18`
- When started with an older Node.js runtime, the proxy exits before launching the language server and prints the current Node.js version

## Supported Imports

- `./*.css`
- `./*.scss`
- `./*.sass`
- `./*.less`
- Relative imports without an explicit extension are resolved against those four suffixes
- Explicit imports with other extensions, such as `./foo.txt`, are ignored
- JSX buffers are not registered in this first release

## Limitations

- Only relative imports are handled in the first version
- No `tsconfig` path aliases, bundler aliases, or framework-specific integrations
- The supported stylesheet suffixes are limited to `css`, `scss`, `sass`, and `less`
- References only scans JavaScript, TypeScript, and TSX workspace files
- References only match CSS Modules alias references such as `styles.foo` and `styles["foo-bar"]`, plus stylesheet class declarations imported by those aliases
- Plain class strings such as `className="foo"` are not treated as references
