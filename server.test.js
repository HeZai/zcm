const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  collectWorkspaceReferences,
  createInitializeResult,
  findClassReferencesInContent,
  findCssModuleImports,
  findImportPathWithExtensionlessFallback,
  findStylesheetClassReferenceAtPosition,
  minimumNodeVersionError,
  registerWorkspaceFolderChangeHandler,
  resolveRelativeStylesheetImport,
} = require("./server.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zcm-server-test-"));
}

test("resolves extensionless relative stylesheet imports", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "Button.css"), ".primaryButton {}", "utf8");

  assert.equal(
    resolveRelativeStylesheetImport(dir, "./Button"),
    path.join(dir, "Button.css"),
  );
});

test("resolves css module names without style extensions", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "Card.module.scss"), ".card {}", "utf8");

  assert.equal(
    resolveRelativeStylesheetImport(dir, "./Card.module"),
    path.join(dir, "Card.module.scss"),
  );
});

test("ignores explicit non-stylesheet extensions", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "Widget.txt.css"), ".widget {}", "utf8");

  assert.equal(resolveRelativeStylesheetImport(dir, "./Widget.txt"), "");
});

test("falls back to extensionless import resolution after upstream misses", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "Button.css"), ".primaryButton {}", "utf8");
  const fileContent = 'import styles from "./Button";';

  assert.equal(
    findImportPathWithExtensionlessFallback(() => "", fileContent, "styles", dir),
    path.join(dir, "Button.css"),
  );
});

test("keeps upstream result for explicit stylesheet imports", () => {
  const dir = tempDir();
  const upstreamPath = path.join(dir, "Panel.less");

  assert.equal(
    findImportPathWithExtensionlessFallback(
      () => upstreamPath,
      'import styles from "./Panel.less";',
      "styles",
      dir,
    ),
    upstreamPath,
  );
});

test("accepts supported Node versions", () => {
  assert.equal(minimumNodeVersionError("v18.0.0"), "");
  assert.equal(minimumNodeVersionError("v20.12.2"), "");
});

test("explains unsupported Node versions", () => {
  assert.match(
    minimumNodeVersionError("v16.20.2"),
    /zcm requires Node\.js 18 or newer.*cssmodules-language-server@1\.5\.2.*current Node\.js is v16\.20\.2/,
  );
});

test("announces references support during initialize", () => {
  assert.deepEqual(
    createInitializeResult(
      { workspace: { workspaceFolders: true } },
      [".", "["],
    ),
    {
      capabilities: {
        textDocumentSync: 2,
        hoverProvider: true,
        definitionProvider: true,
        implementationProvider: true,
        referencesProvider: true,
        completionProvider: {
          triggerCharacters: [".", "["],
          resolveProvider: true,
        },
        workspace: {
          workspaceFolders: {
            supported: true,
          },
        },
      },
    },
  );
});

test("does not crash when workspace folder change events are unsupported", () => {
  const connection = { workspace: {} };
  Object.defineProperty(connection.workspace, "onDidChangeWorkspaceFolders", {
    get() {
      throw new Error("Client doesn't support sending workspace folder change events.");
    },
  });

  assert.doesNotThrow(() =>
    registerWorkspaceFolderChangeHandler(connection, {
      _workspaceRoots: [],
      updateWorkspaceRoots() {
        throw new Error("should not update workspace roots");
      },
    }),
  );
});

test("finds stylesheet class references at the cursor position", () => {
  const content = [
    ".primary-button {",
    "  color: white;",
    "}",
    ".secondaryButton {}",
  ].join("\n");

  assert.deepEqual(
    findStylesheetClassReferenceAtPosition(content, { line: 0, character: 5 }, {
      camelCase: true,
    }),
    {
      className: "primaryButton",
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 15 },
      },
    },
  );
  assert.equal(
    findStylesheetClassReferenceAtPosition(content, { line: 1, character: 4 }, {
      camelCase: true,
    }),
    null,
  );
});

test("registers zcm for stylesheet languages", () => {
  const extensionToml = fs.readFileSync(
    path.join(__dirname, "extension.toml"),
    "utf8",
  );

  assert.match(
    extensionToml,
    /languages = \["JavaScript", "TypeScript", "TSX", "CSS", "SCSS", "LESS"\]/,
  );
  assert.match(extensionToml, /"CSS" = "css"/);
  assert.match(extensionToml, /"SCSS" = "scss"/);
  assert.match(extensionToml, /"LESS" = "less"/);
});

test("finds css module imports with extensionless fallback", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "Button.css"), ".primary-button {}", "utf8");
  fs.writeFileSync(path.join(dir, "Panel.less"), ".panel-body {}", "utf8");

  assert.deepEqual(
    findCssModuleImports(
      [
        'import styles from "./Button";',
        'const panel = require("./Panel.less");',
        'import text from "./notes.txt";',
        'import theme from "theme/Button.css";',
      ].join("\n"),
      dir,
    ),
    [
      {
        importName: "styles",
        importPath: path.join(dir, "Button.css"),
        specifier: "./Button",
      },
      {
        importName: "panel",
        importPath: path.join(dir, "Panel.less"),
        specifier: "./Panel.less",
      },
    ],
  );
});

test("finds dot and bracket class references for an import alias", () => {
  const content = [
    'import styles from "./Button.css";',
    "const a = styles.primaryButton;",
    "const b = styles['panel-body'];",
    'const c = styles["panel-body"];',
    'const d = otherStyles["panel-body"];',
    'const e = "panel-body";',
  ].join("\n");

  assert.deepEqual(
    findClassReferencesInContent(content, "styles", "primaryButton").map(
      reference => reference.range,
    ),
    [rangeFor(content, "primaryButton")],
  );
  assert.deepEqual(
    findClassReferencesInContent(content, "styles", "panel-body").map(
      reference => reference.range,
    ),
    [rangeFor(content, "panel-body"), rangeFor(content, "panel-body", 1)],
  );
});

test("collects references only from sources importing the same stylesheet", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "Button.css"), ".primaryButton {}", "utf8");
  fs.writeFileSync(path.join(root, "Other.css"), ".primaryButton {}", "utf8");
  fs.writeFileSync(
    path.join(root, "Button.tsx"),
    'import styles from "./Button";\nstyles.primaryButton;\nclassName="primaryButton";',
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "Alias.ts"),
    'import cx from "./Button.css";\ncx["primaryButton"];',
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "Wrong.tsx"),
    'import styles from "./Other.css";\nstyles.primaryButton;',
    "utf8",
  );
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(
    path.join(root, "node_modules", "Ignored.tsx"),
    'import styles from "../Button.css";\nstyles.primaryButton;',
    "utf8",
  );

  const references = collectWorkspaceReferences(
    [root],
    path.join(root, "Button.css"),
    "primaryButton",
  );

  assert.deepEqual(
    references.map(reference => path.basename(filePathFromUri(reference.uri))),
    ["Alias.ts", "Button.tsx"],
  );
});

test("collects stylesheet declarations only when requested", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "Button.css"), ".primary-button {}", "utf8");
  fs.writeFileSync(
    path.join(root, "Button.tsx"),
    'import styles from "./Button";\nstyles.primaryButton;',
    "utf8",
  );
  const stylesheetPath = path.join(root, "Button.css");

  const withoutDeclaration = collectWorkspaceReferences(
    [root],
    stylesheetPath,
    "primaryButton",
    { includeDeclaration: false },
  );
  const withDeclaration = collectWorkspaceReferences(
    [root],
    stylesheetPath,
    "primaryButton",
    { includeDeclaration: true, camelCase: true },
  );

  assert.equal(
    withoutDeclaration.some(
      reference => filePathFromUri(reference.uri) === stylesheetPath,
    ),
    false,
  );
  assert.equal(
    withDeclaration.some(reference => filePathFromUri(reference.uri) === stylesheetPath),
    true,
  );
});

function rangeFor(content, needle, occurrence = 0) {
  let offset = -1;
  let fromIndex = 0;
  for (let i = 0; i <= occurrence; i += 1) {
    offset = content.indexOf(needle, fromIndex);
    fromIndex = offset + needle.length;
  }

  assert.notEqual(offset, -1);
  const start = positionAt(content, offset);
  const end = positionAt(content, offset + needle.length);
  return { start, end };
}

function positionAt(content, offset) {
  const lines = content.slice(0, offset).split("\n");
  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
  };
}

function filePathFromUri(uri) {
  return new URL(uri).pathname;
}
