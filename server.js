"use strict";

const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

const STYLE_EXTENSIONS = ["css", "scss", "sass", "less"];
const CSS_MODULE_EXTENSION = "module";
const MINIMUM_NODE_MAJOR_VERSION = 18;
const SOURCE_EXTENSIONS = new Set([".js", ".ts", ".tsx"]);
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

function requireFromCssModulesPackage(specifier) {
  return createRequire(require.resolve("cssmodules-language-server/package.json"))(
    specifier,
  );
}

function minimumNodeVersionError(version = process.version) {
  const match = /^v?(\d+)\./.exec(version);
  const majorVersion = match ? Number(match[1]) : 0;
  if (majorVersion >= MINIMUM_NODE_MAJOR_VERSION) {
    return "";
  }

  return [
    `zcm requires Node.js ${MINIMUM_NODE_MAJOR_VERSION} or newer.`,
    "cssmodules-language-server@1.5.2 declares engines.node >=18, so older Node.js runtimes are unsupported.",
    `The current Node.js is ${version}.`,
  ].join(" ");
}

function assertSupportedNodeVersion() {
  const error = minimumNodeVersionError();
  if (error) {
    throw new Error(error);
  }
}

function isRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function styleExtension(specifier) {
  const extension = path.extname(specifier);
  return extension.startsWith(".") ? extension.slice(1) : extension;
}

function resolveRelativeStylesheetImport(directoryPath, specifier) {
  if (!isRelativeSpecifier(specifier)) {
    return "";
  }

  const extension = styleExtension(specifier);
  const requestPath = path.resolve(directoryPath, specifier);

  if (STYLE_EXTENSIONS.includes(extension)) {
    return fs.existsSync(requestPath) ? requestPath : "";
  }

  if (extension && extension !== CSS_MODULE_EXTENSION) {
    return "";
  }

  for (const candidateExtension of STYLE_EXTENSIONS) {
    const candidate = `${requestPath}.${candidateExtension}`;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function importSpecifierRegExp(importName) {
  const fromOrRequire = String.raw`(?:from\s+|=\s*require(?:<any>)?\()`;
  return new RegExp(
    String.raw`\b${escapeRegExp(importName)}\s+${fromOrRequire}["']([^"']+)["']\)?`,
  );
}

function findExtensionlessImportSpecifier(fileContent, importName) {
  const match = importSpecifierRegExp(importName).exec(fileContent);
  return match ? match[1] : "";
}

function findImportPathWithExtensionlessFallback(
  originalFindImportPath,
  fileContent,
  importName,
  directoryPath,
) {
  const upstreamResult = originalFindImportPath(fileContent, importName, directoryPath);
  if (upstreamResult) {
    return upstreamResult;
  }

  const specifier = findExtensionlessImportSpecifier(fileContent, importName);
  return specifier
    ? resolveRelativeStylesheetImport(directoryPath, specifier)
    : "";
}

function findCssModuleImports(fileContent, directoryPath) {
  const imports = [];
  const importRegExp =
    /\b([A-Za-z_$][\w$]*)\s+(?:from\s+|=\s*require(?:<any>)?\(\s*)["']([^"']+)["']\s*\)?/g;

  let match;
  while ((match = importRegExp.exec(fileContent)) !== null) {
    const [, importName, specifier] = match;
    const importPath = resolveRelativeStylesheetImport(directoryPath, specifier);
    if (importPath) {
      imports.push({ importName, importPath, specifier });
    }
  }

  return imports;
}

function findClassReferencesInContent(fileContent, importName, className) {
  const references = [];
  const escapedImportName = escapeRegExp(importName);
  const escapedClassName = escapeRegExp(className);
  const dotReferenceRegExp = new RegExp(
    String.raw`(^|[^\w$])(${escapedImportName})(\s*\.\s*)(${escapedClassName})(?![\w$])`,
    "g",
  );
  const bracketReferenceRegExp = new RegExp(
    String.raw`(^|[^\w$])(${escapedImportName})(\s*\[\s*)(["'])(${escapedClassName})\4(\s*\])`,
    "g",
  );

  let match;
  while ((match = dotReferenceRegExp.exec(fileContent)) !== null) {
    const start =
      match.index + match[1].length + match[2].length + match[3].length;
    references.push(referenceAtOffsets(fileContent, start, start + className.length));
  }

  while ((match = bracketReferenceRegExp.exec(fileContent)) !== null) {
    const start =
      match.index +
      match[1].length +
      match[2].length +
      match[3].length +
      match[4].length;
    references.push(referenceAtOffsets(fileContent, start, start + className.length));
  }

  return references
    .sort((left, right) => left.offset - right.offset)
    .map(({ range }) => ({ range }));
}

function findClassReferenceAtPosition(fileContent, position) {
  const lineInfo = lineAt(fileContent, position.line);
  if (!lineInfo) {
    return null;
  }

  const candidates = [];
  const dotReferenceRegExp =
    /(^|[^\w$])([A-Za-z_$][\w$]*)(\s*\.\s*)([A-Za-z_$][\w$]*)/g;
  const bracketReferenceRegExp =
    /(^|[^\w$])([A-Za-z_$][\w$]*)(\s*\[\s*)(["'])([^"']+)\4(\s*\])/g;

  let match;
  while ((match = dotReferenceRegExp.exec(lineInfo.text)) !== null) {
    const expressionStart = match.index + match[1].length;
    const classStart = expressionStart + match[2].length + match[3].length;
    const classEnd = classStart + match[4].length;
    candidates.push({
      className: match[4],
      end: classEnd,
      importName: match[2],
      start: expressionStart,
    });
  }

  while ((match = bracketReferenceRegExp.exec(lineInfo.text)) !== null) {
    const expressionStart = match.index + match[1].length;
    const classStart =
      expressionStart + match[2].length + match[3].length + match[4].length;
    const classEnd = classStart + match[5].length;
    candidates.push({
      className: match[5],
      end: classEnd,
      importName: match[2],
      start: expressionStart,
    });
  }

  return (
    candidates.find(
      candidate =>
        position.character >= candidate.start && position.character <= candidate.end,
    ) || null
  );
}

function findStylesheetClassReferenceAtPosition(
  fileContent,
  position,
  options = {},
) {
  const lineInfo = lineAt(fileContent, position.line);
  if (!lineInfo) {
    return null;
  }

  const transform = classNameTransformer(options.camelCase);
  const classNameRegExp = /\.(-?[_a-zA-Z][-_a-zA-Z0-9]*)/g;
  let match;
  while ((match = classNameRegExp.exec(lineInfo.text)) !== null) {
    const classStart = match.index + 1;
    const classEnd = classStart + match[1].length;
    if (position.character < match.index || position.character > classEnd) {
      continue;
    }

    return {
      className: transform(match[1]),
      range: {
        start: { line: position.line, character: classStart },
        end: { line: position.line, character: classEnd },
      },
    };
  }

  return null;
}

function collectWorkspaceReferences(
  workspaceRoots,
  targetImportPath,
  className,
  options = {},
) {
  const targetPath = path.resolve(targetImportPath);
  const references = [];
  const seen = new Set();

  if (options.includeDeclaration) {
    addLocation(
      references,
      seen,
      options.declarationLocation ||
        findStylesheetDeclarationLocation(targetPath, className, options),
    );
  }

  for (const sourcePath of findWorkspaceSourceFiles(workspaceRoots)) {
    const fileContent = readTextFile(sourcePath);
    if (fileContent === null) {
      continue;
    }

    const directoryPath = path.dirname(sourcePath);
    for (const cssModuleImport of findCssModuleImports(fileContent, directoryPath)) {
      if (path.resolve(cssModuleImport.importPath) !== targetPath) {
        continue;
      }

      for (const reference of findClassReferencesInContent(
        fileContent,
        cssModuleImport.importName,
        className,
      )) {
        addLocation(
          references,
          seen,
          locationForRange(sourcePath, reference.range),
        );
      }
    }
  }

  return references.sort(compareLocations);
}

function findWorkspaceSourceFiles(workspaceRoots) {
  const files = [];
  const seenDirectories = new Set();

  for (const root of workspaceRoots || []) {
    if (!root) {
      continue;
    }
    walkSourceFiles(path.resolve(root), files, seenDirectories);
  }

  return files.sort();
}

function walkSourceFiles(directoryPath, files, seenDirectories) {
  let realDirectoryPath;
  try {
    realDirectoryPath = fs.realpathSync(directoryPath);
  } catch {
    return;
  }

  if (seenDirectories.has(realDirectoryPath)) {
    return;
  }
  seenDirectories.add(realDirectoryPath);

  let entries;
  try {
    entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        walkSourceFiles(entryPath, files, seenDirectories);
      }
      continue;
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
}

function findStylesheetDeclarationLocation(stylesheetPath, className, options = {}) {
  const fileContent = readTextFile(stylesheetPath);
  if (fileContent === null) {
    return null;
  }

  const declaration = findStylesheetClassDeclaration(
    fileContent,
    className,
    options,
  );
  return declaration ? locationForRange(stylesheetPath, declaration.range) : null;
}

function findStylesheetClassDeclaration(fileContent, className, options = {}) {
  const transform = classNameTransformer(options.camelCase);
  const classNameRegExp = /\.(-?[_a-zA-Z][-_a-zA-Z0-9]*)/g;

  let match;
  while ((match = classNameRegExp.exec(fileContent)) !== null) {
    if (transform(match[1]) !== className) {
      continue;
    }

    const position = positionAtOffset(fileContent, match.index);
    return { range: { start: position, end: position } };
  }

  return null;
}

function classNameTransformer(camelCaseConfig) {
  switch (camelCaseConfig) {
    case true:
      return value =>
        value
          .replace(/^[-_]+/, "")
          .replace(/[-_]+([A-Za-z0-9])/g, (_, character) =>
            character.toUpperCase(),
          );
    case "dashes":
      return value =>
        value.replace(/-+(\w)/g, (_, character) => character.toUpperCase());
    default:
      return value => value;
  }
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function referenceAtOffsets(fileContent, startOffset, endOffset) {
  return {
    offset: startOffset,
    range: {
      start: positionAtOffset(fileContent, startOffset),
      end: positionAtOffset(fileContent, endOffset),
    },
  };
}

function positionAtOffset(fileContent, offset) {
  let line = 0;
  let character = 0;

  for (let index = 0; index < offset; index += 1) {
    const value = fileContent[index];
    if (value === "\r") {
      if (fileContent[index + 1] === "\n" && index + 1 < offset) {
        index += 1;
      }
      line += 1;
      character = 0;
      continue;
    }

    if (value === "\n") {
      line += 1;
      character = 0;
      continue;
    }

    character += 1;
  }

  return { line, character };
}

function lineAt(fileContent, targetLine) {
  let line = 0;
  let lineStart = 0;

  for (let index = 0; index <= fileContent.length; index += 1) {
    const value = fileContent[index];
    const isLineEnd =
      index === fileContent.length || value === "\n" || value === "\r";
    if (!isLineEnd) {
      continue;
    }

    if (line === targetLine) {
      return {
        startOffset: lineStart,
        text: fileContent.slice(lineStart, index),
      };
    }

    if (value === "\r" && fileContent[index + 1] === "\n") {
      index += 1;
    }
    line += 1;
    lineStart = index + 1;
  }

  return null;
}

function locationForRange(filePath, range) {
  return {
    range,
    uri: pathToFileURL(filePath).href,
  };
}

function addLocation(locations, seen, location) {
  if (!location) {
    return;
  }

  const key = [
    location.uri,
    location.range.start.line,
    location.range.start.character,
    location.range.end.line,
    location.range.end.character,
  ].join(":");

  if (!seen.has(key)) {
    seen.add(key);
    locations.push(location);
  }
}

function compareLocations(left, right) {
  return (
    left.uri.localeCompare(right.uri) ||
    left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character ||
    left.range.end.line - right.range.end.line ||
    left.range.end.character - right.range.end.character
  );
}

function patchCssModulesLanguageServer() {
  const utils = requireFromCssModulesPackage("./lib/utils");
  if (utils.__zcmExtensionlessImportPatch) {
    return;
  }

  const originalFindImportPath = utils.findImportPath;
  utils.findImportPath = (fileContent, importName, directoryPath) =>
    findImportPathWithExtensionlessFallback(
      originalFindImportPath,
      fileContent,
      importName,
      directoryPath,
    );

  Object.defineProperty(utils, "__zcmExtensionlessImportPatch", {
    value: true,
  });
}

class CSSModulesReferencesProvider {
  constructor(textDocuments, utils, workspaceRoots) {
    this._camelCaseConfig = true;
    this._textDocuments = textDocuments;
    this._utils = utils;
    this._workspaceRoots = workspaceRoots || [];
    this.references = async params => {
      const textdocument = this._textDocuments.get(params.textDocument.uri);
      if (textdocument === undefined) {
        return [];
      }

      return this.provideReferences(
        textdocument,
        params.position,
        !!(params.context && params.context.includeDeclaration),
      );
    };
  }

  updateSettings(camelCaseConfig) {
    this._camelCaseConfig = camelCaseConfig;
  }

  updateWorkspaceRoots(workspaceRoots) {
    this._workspaceRoots = workspaceRoots;
  }

  async provideReferences(textdocument, position, includeDeclaration) {
    const fileContent = textdocument.getText();
    const currentPath = filePathFromUri(textdocument.uri);
    const currentDir = this._utils.getCurrentDirFromUri(textdocument.uri);
    const workspaceRoots = this._workspaceRoots.length
      ? this._workspaceRoots
      : [currentDir];

    if (isStylesheetPath(currentPath)) {
      const stylesheetReference = findStylesheetClassReferenceAtPosition(
        fileContent,
        position,
        { camelCase: this._camelCaseConfig },
      );
      if (stylesheetReference === null) {
        return [];
      }

      return collectWorkspaceReferences(
        workspaceRoots,
        currentPath,
        stylesheetReference.className,
        {
          declarationLocation: locationForRange(
            currentPath,
            stylesheetReference.range,
          ),
          includeDeclaration,
        },
      );
    }

    const reference = findClassReferenceAtPosition(fileContent, position);
    if (reference === null) {
      return [];
    }

    const importPath = this._utils.findImportPath(
      fileContent,
      reference.importName,
      currentDir,
    );
    if (importPath === "") {
      return [];
    }

    const declarationLocation = includeDeclaration
      ? await this.declarationLocation(importPath, reference.className)
      : null;

    return collectWorkspaceReferences(
      workspaceRoots,
      importPath,
      reference.className,
      {
        declarationLocation,
        includeDeclaration: includeDeclaration && declarationLocation !== null,
      },
    );
  }

  async declarationLocation(importPath, className) {
    try {
      const position = await this._utils.getPosition(
        importPath,
        className,
        this._camelCaseConfig,
      );
      return position
        ? locationForRange(importPath, { start: position, end: position })
        : null;
    } catch {
      return null;
    }
  }
}

function createInitializeResult(capabilities, completionTriggers) {
  const hasWorkspaceFolderCapability = !!(
    capabilities.workspace && capabilities.workspace.workspaceFolders
  );
  const result = {
    capabilities: {
      textDocumentSync: 2,
      hoverProvider: true,
      definitionProvider: true,
      implementationProvider: true,
      referencesProvider: true,
      completionProvider: {
        triggerCharacters: completionTriggers,
        resolveProvider: true,
      },
    },
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }

  return result;
}

function workspaceRootsFromInitializeParams(params) {
  const roots = [];

  for (const workspaceFolder of params.workspaceFolders || []) {
    const workspacePath = filePathFromUri(workspaceFolder.uri);
    if (workspacePath) {
      roots.push(workspacePath);
    }
  }

  const rootUriPath = params.rootUri ? filePathFromUri(params.rootUri) : "";
  if (rootUriPath) {
    roots.push(rootUriPath);
  } else if (params.rootPath) {
    roots.push(params.rootPath);
  }

  return [...new Set(roots.map(root => path.resolve(root)))];
}

function filePathFromUri(uri) {
  try {
    return fileURLToPath(uri);
  } catch {
    return "";
  }
}

function isStylesheetPath(filePath) {
  return STYLE_EXTENSIONS.includes(styleExtension(filePath));
}

function registerWorkspaceFolderChangeHandler(connection, referencesProvider) {
  if (!connection.workspace) {
    return;
  }

  let onDidChangeWorkspaceFolders;
  try {
    onDidChangeWorkspaceFolders = connection.workspace.onDidChangeWorkspaceFolders;
  } catch (error) {
    if (isUnsupportedWorkspaceFolderChangeError(error)) {
      return;
    }
    throw error;
  }

  if (typeof onDidChangeWorkspaceFolders !== "function") {
    return;
  }

  onDidChangeWorkspaceFolders.call(connection.workspace, event => {
    const currentRoots = new Set(referencesProvider._workspaceRoots);
    for (const removed of event.removed || []) {
      const removedPath = filePathFromUri(removed.uri);
      if (removedPath) {
        currentRoots.delete(path.resolve(removedPath));
      }
    }
    for (const added of event.added || []) {
      const addedPath = filePathFromUri(added.uri);
      if (addedPath) {
        currentRoots.add(path.resolve(addedPath));
      }
    }
    referencesProvider.updateWorkspaceRoots([...currentRoots]);
  });
}

function isUnsupportedWorkspaceFolderChangeError(error) {
  return (
    error instanceof Error &&
    error.message.includes("workspace folder change events")
  );
}

function createZcmConnection() {
  patchCssModulesLanguageServer();

  const lsp = requireFromCssModulesPackage("vscode-languageserver/node");
  const {
    COMPLETION_TRIGGERS,
    CSSModulesCompletionProvider,
  } = requireFromCssModulesPackage("./lib/CompletionProvider");
  const { CSSModulesDefinitionProvider } = requireFromCssModulesPackage(
    "./lib/DefinitionProvider",
  );
  const { textDocuments } = requireFromCssModulesPackage("./lib/textDocuments");
  const utils = requireFromCssModulesPackage("./lib/utils");
  const connection = lsp.createConnection(process.stdin, process.stdout);
  const defaultSettings = {
    camelCase: true,
  };
  const completionProvider = new CSSModulesCompletionProvider(
    defaultSettings.camelCase,
  );
  const definitionProvider = new CSSModulesDefinitionProvider(
    defaultSettings.camelCase,
  );
  const referencesProvider = new CSSModulesReferencesProvider(
    textDocuments,
    utils,
    [],
  );

  textDocuments.listen(connection);

  connection.onInitialize(params => {
    const { capabilities, initializationOptions } = params;
    if (initializationOptions && "camelCase" in initializationOptions) {
      completionProvider.updateSettings(initializationOptions.camelCase);
      definitionProvider.updateSettings(initializationOptions.camelCase);
      referencesProvider.updateSettings(initializationOptions.camelCase);
    }

    referencesProvider.updateWorkspaceRoots(
      workspaceRootsFromInitializeParams(params),
    );

    return createInitializeResult(capabilities, COMPLETION_TRIGGERS);
  });

  registerWorkspaceFolderChangeHandler(connection, referencesProvider);

  connection.onCompletion(completionProvider.completion);
  connection.onDefinition(definitionProvider.definition);
  connection.onImplementation(definitionProvider.definition);
  connection.onHover(definitionProvider.hover);
  connection.onReferences(referencesProvider.references);

  return connection;
}

function main() {
  try {
    assertSupportedNodeVersion();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }

  const args = process.argv;
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${requireFromCssModulesPackage("./package.json").version}`);
    process.exit(0);
  }

  if (args.includes("rage")) {
    const environment = {
      Platform: process.platform,
      Arch: process.arch,
      NodeVersion: process.version,
      NodePath: process.execPath,
      CssModulesLanguageServerVersion:
        requireFromCssModulesPackage("./package.json").version,
    };
    Object.entries(environment).forEach(([key, value]) => {
      process.stdout.write(`${key}: ${value}\n`);
    });
    process.exit(0);
  }

  createZcmConnection().listen();
}

if (require.main === module) {
  main();
}

module.exports = {
  collectWorkspaceReferences,
  createInitializeResult,
  findClassReferenceAtPosition,
  findClassReferencesInContent,
  findCssModuleImports,
  findExtensionlessImportSpecifier,
  findImportPathWithExtensionlessFallback,
  findStylesheetClassReferenceAtPosition,
  minimumNodeVersionError,
  patchCssModulesLanguageServer,
  registerWorkspaceFolderChangeHandler,
  resolveRelativeStylesheetImport,
};
