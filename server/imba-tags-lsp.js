#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const ImbaScriptInfo = require("./imba-monarch.js");

const SEMANTIC_TOKEN_TYPES = ImbaScriptInfo.SemanticTokenTypes.filter(tokenType => typeof tokenType === "string");
const SEMANTIC_TOKEN_MODIFIERS = ImbaScriptInfo.SemanticTokenModifiers || [];

const TAG_NAME = "[A-Za-z_][\\w]*(?::[A-Za-z_][\\w]*)?(?:-[\\w]+)*";
const TAG_DECLARATION = new RegExp(
  `^(\\s*)(?:\\$[A-Za-z_][-\\w]*\\$\\s+)?(?:export\\s+(?:default\\s+)?)?(?:(?:extend|global|local|declare|abstract)\\s+)*tag\\s+(${TAG_NAME})\\b`,
);
const IDENTIFIER = "[$A-Za-z_\\x7f-\\uffff][$\\w\\x7f-\\uffff]*(?:-[$\\w\\x7f-\\uffff]+)*[?!]?";
const PROPERTY_NAME = `(?:${IDENTIFIER}|[#]{1,2}${IDENTIFIER}|@!?${IDENTIFIER}|<=>|\\|)`;
const TAG_DOCUMENT_SYMBOL = new RegExp(
  `^(\\s*)(?:\\$[A-Za-z_][-\\w]*\\$\\s+)?(?:export\\s+(?:default\\s+)?)?(?:(?:extend|global|local|declare|abstract)\\s+)*tag\\s+(${TAG_NAME})\\b`,
);
const CLASS_DOCUMENT_SYMBOL = new RegExp(
  `^(\\s*)(?:\\$[A-Za-z_][-\\w]*\\$\\s+)?((?:export\\s+(?:default\\s+)?)?(?:(?:global|declare|abstract|extend|strict)\\s+)*)(class|interface|mixin)\\s+(${PROPERTY_NAME}(?:\\.${PROPERTY_NAME})*)\\b`,
);
const METHOD_DOCUMENT_SYMBOL = new RegExp(
  `^(\\s*)(?:(?:global|static|protected|private|declare)\\s+)*(def|get|set|constructor)\\s+(?:(?:${IDENTIFIER}|self|this)[.#])?(${PROPERTY_NAME})\\b`,
);
const FIELD_DOCUMENT_SYMBOL = new RegExp(
  `^(\\s*)(?:(?:lazy|static|declare|protected|private)\\s+)*(prop|attr|let|const|isa)\\s+(${PROPERTY_NAME})\\b`,
);
const ACTION_DESCRIPTOR_DEFINITION = new RegExp(
  `^(\\s*)(${IDENTIFIER})(?=\\s+@action\\b)`,
);
const CSS_CUSTOM_UNIT_DECLARATION = /(^|[\s\[\(])(\d+)([A-Za-z_][\w-]*)(?=\s*[:=])/g;
const CSS_NUMBER_UNIT = /(^|[^\w\x7f-\uffff-])([+-]?(?:\d+(?:\.\d+)?|\.\d+))([A-Za-z_][\w-]*)(?![$\w\x7f-\uffff-])/g;
const DESCRIPTOR_DOCUMENT_SYMBOL = new RegExp(
  `^(\\s*)(?:(?:lazy|static|declare|protected|private)\\s+)?(${IDENTIFIER})(?=\\s*(?:\\\\|@))`,
);

const SymbolKind = {
  Class: 5,
  Method: 6,
  Property: 7,
  Field: 8,
  Constructor: 9,
  Interface: 11,
};

const ignoredDirectories = new Set([
  ".git",
  ".imba-cache",
  ".zed",
  "build",
  "dist",
  "node_modules",
  "tmp",
  "temp",
]);

let nextContentLength = null;
let input = Buffer.alloc(0);
let shutdownRequested = false;
let rootPath = null;
let workspaceFolders = [];
let cachedWorkspaceSymbols = null;
let cachedDefinitionIndex = null;
const openDocuments = new Map();

process.stdin.on("data", chunk => {
  input = Buffer.concat([input, chunk]);
  readMessages();
});

function readMessages() {
  while (true) {
    if (nextContentLength == null) {
      const headerEnd = input.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = input.slice(0, headerEnd).toString("utf8");
      input = input.slice(headerEnd + 4);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) continue;
      nextContentLength = Number(match[1]);
    }

    if (input.length < nextContentLength) return;
    const body = input.slice(0, nextContentLength).toString("utf8");
    input = input.slice(nextContentLength);
    nextContentLength = null;

    try {
      handleMessage(JSON.parse(body));
    } catch (error) {
      log(`failed to handle message: ${error.stack || error.message}`);
    }
  }
}

function handleMessage(message) {
  if (message.method === "initialize") {
    rootPath = rootPathFromInitialize(message.params || {});
    workspaceFolders = workspaceFoldersFromInitialize(message.params || {}, rootPath);
    respond(message.id, {
      capabilities: {
        textDocumentSync: 1,
        definitionProvider: true,
        documentSymbolProvider: true,
        semanticTokensProvider: {
          legend: {
            tokenTypes: SEMANTIC_TOKEN_TYPES,
            tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
          },
          full: true,
        },
        workspaceSymbolProvider: true,
      },
      serverInfo: {
        name: "imba-tags-lsp",
        version: "0.0.1",
      },
    });
    return;
  }

  if (message.method === "shutdown") {
    shutdownRequested = true;
    respond(message.id, null);
    return;
  }

  if (message.method === "exit") {
    process.exit(shutdownRequested ? 0 : 1);
  }

  if (message.method === "textDocument/didOpen") {
    const document = message.params && message.params.textDocument;
    if (document) openDocuments.set(document.uri, document.text || "");
    return;
  }

  if (message.method === "textDocument/didChange") {
    const uri = message.params && message.params.textDocument && message.params.textDocument.uri;
    const changes = message.params && message.params.contentChanges;
    if (uri && Array.isArray(changes) && changes.length) {
      const fullTextChange = changes[changes.length - 1];
      if (typeof fullTextChange.text === "string") {
        openDocuments.set(uri, fullTextChange.text);
      }
    }
    return;
  }

  if (message.method === "textDocument/didClose") {
    const uri = message.params && message.params.textDocument && message.params.textDocument.uri;
    if (uri) openDocuments.delete(uri);
    return;
  }

  if (message.method === "workspace/symbol") {
    const query = String((message.params && message.params.query) || "");
    respond(message.id, workspaceSymbols(query));
    return;
  }

  if (message.method === "textDocument/documentSymbol") {
    const uri = message.params && message.params.textDocument && message.params.textDocument.uri;
    respond(message.id, documentSymbols(uri));
    return;
  }

  if (message.method === "textDocument/definition") {
    const uri = message.params && message.params.textDocument && message.params.textDocument.uri;
    const position = message.params && message.params.position;
    respond(message.id, definitionsAtPosition(uri, position));
    return;
  }

  if (message.method === "textDocument/semanticTokens/full") {
    const uri = message.params && message.params.textDocument && message.params.textDocument.uri;
    respond(message.id, semanticTokens(uri));
    return;
  }

  if (Object.prototype.hasOwnProperty.call(message, "id")) {
    respondError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

function rootPathFromInitialize(params) {
  if (params.rootUri) return uriToPath(params.rootUri);
  if (params.rootPath) return params.rootPath;
  const firstFolder = params.workspaceFolders && params.workspaceFolders[0];
  return firstFolder && firstFolder.uri ? uriToPath(firstFolder.uri) : process.cwd();
}

function workspaceFoldersFromInitialize(params, fallbackRootPath) {
  if (Array.isArray(params.workspaceFolders) && params.workspaceFolders.length) {
    return params.workspaceFolders
      .map(folder => uriToPath(folder.uri))
      .filter(Boolean);
  }
  return fallbackRootPath ? [fallbackRootPath] : [];
}

function workspaceSymbols(query) {
  const workspaceSymbols = getWorkspaceSymbols();
  const openDocumentUris = new Set(openDocuments.keys());
  const symbols = workspaceSymbols.filter(symbol => !openDocumentUris.has(symbol.location.uri));

  for (const [uri, text] of openDocuments) {
    symbols.push(...workspaceSymbolsForText(uri, text));
  }

  const seen = new Set();
  const entries = symbols
    .map((symbol, index) => ({ symbol, index }))
    .filter(({ symbol }) => {
      const key = `${matchName(symbol)}\0${symbol.location.uri}\0${symbol.location.range.start.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return matchesQuery(matchName(symbol), query);
    });

  if (query.trim()) {
    entries.sort((left, right) => compareWorkspaceSymbols(left, right, query));
  }

  return entries
    .map(entry => lspWorkspaceSymbol(entry.symbol))
    .slice(0, 2000);
}

function getWorkspaceSymbols() {
  if (cachedWorkspaceSymbols) return cachedWorkspaceSymbols;

  const symbols = [];
  for (const folder of workspaceFolders.length ? workspaceFolders : [rootPath]) {
    if (folder) scanDirectory(folder, symbols);
  }

  cachedWorkspaceSymbols = symbols;
  return symbols;
}

function documentSymbols(uri) {
  const text = openDocuments.has(uri) ? openDocuments.get(uri) : readUri(uri);
  if (text == null) return [];

  return documentSymbolsForText(text);
}

function semanticTokens(uri) {
  const text = openDocuments.has(uri) ? openDocuments.get(uri) : readUri(uri);
  if (text == null) return { data: [] };

  try {
    const script = new ImbaScriptInfo.default({ fileName: uriToPath(uri) || uri || "untitled.imba" }, text);
    return { data: lspSemanticTokenData(text, script.getSemanticTokens()) };
  } catch (error) {
    log(`failed to compute semantic tokens: ${error.stack || error.message}`);
    return { data: [] };
  }
}

function lspSemanticTokenData(text, semanticTokens) {
  const lineStarts = lineStartsForText(text);
  const data = [];
  let previousLine = 0;
  let previousCharacter = 0;

  const tokens = semanticTokens
    .map(([offset, length, tokenType, tokenModifiers]) => ({
      offset,
      length,
      tokenType,
      tokenModifiers,
      position: positionAtOffset(lineStarts, offset),
    }))
    .filter(token => (
      token.length > 0 &&
      token.tokenType >= 0 &&
      token.tokenType < SEMANTIC_TOKEN_TYPES.length &&
      token.position
    ))
    .sort((left, right) => left.offset - right.offset || left.length - right.length);

  for (const token of tokens) {
    const tokenLineEnd = lineStarts[token.position.line + 1] == null
      ? text.length
      : lineStarts[token.position.line + 1] - 1;
    const length = Math.min(token.length, Math.max(0, tokenLineEnd - token.offset));
    if (!length) continue;

    const lineDelta = token.position.line - previousLine;
    const characterDelta = lineDelta === 0
      ? token.position.character - previousCharacter
      : token.position.character;

    data.push(lineDelta, characterDelta, length, token.tokenType, token.tokenModifiers || 0);

    previousLine = token.position.line;
    previousCharacter = token.position.character;
  }

  return data;
}

function lineStartsForText(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function positionAtOffset(lineStarts, offset) {
  if (offset < 0) return null;

  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const line = Math.max(0, high);
  return {
    line,
    character: offset - lineStarts[line],
  };
}

function scanDirectory(directory, symbols) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) scanDirectory(fullPath, symbols);
    } else if (entry.isFile() && isImbaFile(entry.name)) {
      const text = readFile(fullPath);
      if (text != null) symbols.push(...workspaceSymbolsForText(pathToFileURL(fullPath).href, text));
    }
  }
}

function getDefinitionIndex() {
  const baseIndex = getBaseDefinitionIndex();
  const openDocumentUris = new Set(openDocuments.keys());
  const index = createDefinitionIndex();

  for (const collection of ["tags", "classes", "methods", "cssUnits"]) {
    for (const [name, definitions] of baseIndex[collection]) {
      for (const definition of definitions) {
        if (!openDocumentUris.has(definition.uri)) {
          addDefinition(index[collection], name, definition);
        }
      }
    }
  }

  for (const [uri, text] of openDocuments) {
    addDefinitionsForText(index, uri, text);
  }

  return index;
}

function getBaseDefinitionIndex() {
  if (cachedDefinitionIndex) return cachedDefinitionIndex;

  const index = createDefinitionIndex();
  for (const folder of workspaceFolders.length ? workspaceFolders : [rootPath]) {
    if (folder) scanDefinitionsDirectory(folder, index);
  }

  cachedDefinitionIndex = index;
  return index;
}

function createDefinitionIndex() {
  return {
    tags: new Map(),
    classes: new Map(),
    methods: new Map(),
    cssUnits: new Map(),
  };
}

function scanDefinitionsDirectory(directory, index) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) scanDefinitionsDirectory(fullPath, index);
    } else if (entry.isFile() && isImbaFile(entry.name)) {
      const text = readFile(fullPath);
      if (text != null) addDefinitionsForText(index, pathToFileURL(fullPath).href, text);
    }
  }
}

function addDefinitionsForText(index, uri, text) {
  const lines = text.split(/\r\n|\r|\n/);

  for (let line = 0; line < lines.length; line += 1) {
    const lineText = lines[line];
    addCssUnitDefinitionsForLine(index, uri, lineText, line);

    const tag = TAG_DECLARATION.exec(lineText);
    if (tag) {
      addDefinition(index.tags, tag[2], definitionFromMatch(uri, lineText, line, tag, 2, "tag"));
      continue;
    }

    const klass = CLASS_DOCUMENT_SYMBOL.exec(lineText);
    if (klass) {
      addDefinition(
        index.classes,
        klass[4],
        definitionFromMatch(uri, lineText, line, klass, 4, declarationDetail(klass[2], klass[3])),
      );
      continue;
    }

    const method = METHOD_DOCUMENT_SYMBOL.exec(lineText);
    if (method) {
      addDefinition(index.methods, method[3], definitionFromMatch(uri, lineText, line, method, 3, method[2]));
      continue;
    }

    const action = ACTION_DESCRIPTOR_DEFINITION.exec(lineText);
    if (action) {
      addDefinition(index.methods, action[2], definitionFromMatch(uri, lineText, line, action, 2, "action"));
    }
  }
}

function addCssUnitDefinitionsForLine(index, uri, lineText, line) {
  if (/^\s*#/.test(lineText)) return;

  const code = codeBeforeComment(lineText);
  CSS_CUSTOM_UNIT_DECLARATION.lastIndex = 0;

  let match;
  while ((match = CSS_CUSTOM_UNIT_DECLARATION.exec(code))) {
    const numberStart = match.index + match[1].length;
    const nameStart = numberStart + match[2].length;
    const name = match[3];
    addDefinition(
      index.cssUnits,
      name,
      definitionFromRange(uri, line, nameStart, nameStart + name.length, name, "css unit"),
    );
  }
}

function definitionFromMatch(uri, lineText, line, match, nameIndex, detail) {
  const name = match[nameIndex];
  const character = lineText.indexOf(name, match[1].length);
  return definitionFromRange(uri, line, character, character + name.length, name, detail);
}

function definitionFromRange(uri, line, startCharacter, endCharacter, name, detail) {
  return {
    name,
    detail,
    uri,
    range: {
      start: { line, character: startCharacter },
      end: { line, character: endCharacter },
    },
  };
}

function addDefinition(map, name, definition) {
  const existing = map.get(name);
  if (existing) {
    existing.push(definition);
  } else {
    map.set(name, [definition]);
  }
}

function definitionsAtPosition(uri, position) {
  if (!position || typeof position.line !== "number" || typeof position.character !== "number") {
    return [];
  }

  const text = openDocuments.has(uri) ? openDocuments.get(uri) : readUri(uri);
  if (text == null) return [];

  const target = definitionTargetAtPosition(text, position);
  if (!target) return [];

  const index = getDefinitionIndex();

  if (target.kind === "tag") {
    const tagDefinitions = definitionsForNames(index.tags, [target.name]);
    const classDefinitions = definitionsForNames(index.classes, [target.name]);
    return locationsForDefinitions([...tagDefinitions, ...classDefinitions]);
  }

  if (target.kind === "class") {
    return locationsForDefinitions(definitionsForNames(index.classes, [target.name]));
  }

  if (target.kind === "method") {
    return locationsForDefinitions(definitionsForNames(index.methods, methodLookupNames(target.name)));
  }

  if (target.kind === "cssUnit") {
    return locationsForDefinitions(definitionsForNames(index.cssUnits, [target.name]));
  }

  return [];
}

function definitionTargetAtPosition(text, position) {
  const lines = text.split(/\r\n|\r|\n/);
  const lineText = lines[position.line] || "";
  const cssUnit = cssUnitAtPosition(lineText, position.character);
  if (cssUnit && isCssUnitContext(lineText, cssUnit)) {
    return { kind: "cssUnit", name: cssUnit.name };
  }

  const token = tokenAtPosition(lineText, position.character);
  if (!token) return null;

  if (isTagNameContext(lineText, token)) {
    const name = tagLookupName(token.name);
    if (name) return { kind: "tag", name };
  }

  if (isTagDeclarationName(lineText, token)) {
    return { kind: "tag", name: token.name };
  }

  if (isClassDeclarationName(lineText, token)) {
    return { kind: "class", name: token.name };
  }

  if (isMethodDeclarationName(lineText, token) || isMethodCallContext(lineText, token)) {
    return { kind: "method", name: token.name };
  }

  return null;
}

function tokenAtPosition(lineText, character) {
  if (!lineText) return null;

  let index = Math.min(Math.max(character, 0), lineText.length - 1);
  if (!isSymbolCharacter(lineText[index]) && index > 0 && isSymbolCharacter(lineText[index - 1])) {
    index -= 1;
  }

  if (!isSymbolCharacter(lineText[index])) return null;

  let start = index;
  while (start > 0 && isSymbolCharacter(lineText[start - 1])) start -= 1;

  let end = index + 1;
  while (end < lineText.length && isSymbolCharacter(lineText[end])) end += 1;

  return {
    name: lineText.slice(start, end),
    start,
    end,
  };
}

function isSymbolCharacter(character) {
  return character != null && /[$\w\x7f-\uffff?!#@:-]/u.test(character);
}

function isTagNameContext(lineText, token) {
  return /<\s*\/?\s*$/.test(lineText.slice(0, token.start));
}

function tagLookupName(name) {
  const refStart = name.indexOf("$");
  if (refStart === -1) return name;
  return name.slice(0, refStart);
}

function isTagDeclarationName(lineText, token) {
  const match = TAG_DECLARATION.exec(lineText);
  return matchNameAtToken(lineText, match, 2, token);
}

function isClassDeclarationName(lineText, token) {
  const match = CLASS_DOCUMENT_SYMBOL.exec(lineText);
  return matchNameAtToken(lineText, match, 4, token);
}

function isMethodDeclarationName(lineText, token) {
  const method = METHOD_DOCUMENT_SYMBOL.exec(lineText);
  if (matchNameAtToken(lineText, method, 3, token)) return true;

  const action = ACTION_DESCRIPTOR_DEFINITION.exec(lineText);
  return matchNameAtToken(lineText, action, 2, token);
}

function matchNameAtToken(lineText, match, nameIndex, token) {
  if (!match) return false;

  const name = match[nameIndex];
  const character = lineText.indexOf(name, match[1].length);
  return token.start >= character && token.end <= character + name.length;
}

function isMethodCallContext(lineText, token) {
  const before = lineText.slice(0, token.start);
  const after = lineText.slice(token.end);
  const previous = previousNonWhitespace(before);
  const next = nextNonWhitespace(after);

  if (previous === ".") return true;
  if (token.name.endsWith("!")) return true;
  if (next === "(" || next === "!") return true;
  if (/[=@]\s*$/.test(before)) return true;

  return false;
}

function previousNonWhitespace(text) {
  const match = /\S\s*$/.exec(text);
  return match ? match[0].trim() : "";
}

function nextNonWhitespace(text) {
  const match = /^\s*(\S)/.exec(text);
  return match ? match[1] : "";
}

function methodLookupNames(name) {
  if (name.endsWith("!")) return [name, name.slice(0, -1)];
  return [name];
}

function cssUnitAtPosition(lineText, character) {
  if (!lineText || /^\s*#/.test(lineText)) return null;

  const code = codeBeforeComment(lineText);
  if (character > code.length) return null;

  CSS_NUMBER_UNIT.lastIndex = 0;
  let match;
  while ((match = CSS_NUMBER_UNIT.exec(code))) {
    const start = match.index + match[1].length;
    const number = match[2];
    const name = match[3];
    const nameStart = start + number.length;
    const end = nameStart + name.length;

    if (character >= start && character <= end) {
      return { name, start, end, nameStart, number };
    }
  }

  return null;
}

function isCssUnitContext(lineText, unit) {
  if (/^\s*[:=]/.test(lineText.slice(unit.end))) return true;

  const before = lineText.slice(0, unit.start);
  if (/(?:^|\s)(?:global\s+)?css(?:\s|$)/.test(before)) return true;
  if (/(?:^|[\s\[\(])[-$@.#\w]+(?:\.\.[-$@.#\w]+)?\s*[:=][^\n]*$/.test(before)) return true;

  return false;
}

function codeBeforeComment(lineText) {
  const match = /(^|\s)#(?:\s|$)/.exec(lineText);
  if (!match) return lineText;
  return lineText.slice(0, match.index + match[1].length);
}

function definitionsForNames(map, names) {
  const definitions = [];
  const seen = new Set();

  for (const name of names) {
    for (const definition of map.get(name) || []) {
      const key = `${definition.uri}\0${definition.range.start.line}\0${definition.range.start.character}`;
      if (!seen.has(key)) {
        seen.add(key);
        definitions.push(definition);
      }
    }
  }

  return definitions;
}

function locationsForDefinitions(definitions) {
  return definitions.slice(0, 200).map(definition => ({
    uri: definition.uri,
    range: definition.range,
  }));
}

function workspaceSymbolsForText(uri, text) {
  const symbols = [];
  const lines = text.split(/\r\n|\r|\n/);

  for (let line = 0; line < lines.length; line += 1) {
    const tag = TAG_DECLARATION.exec(lines[line]);
    if (tag) {
      symbols.push(workspaceSymbolFromMatch(uri, lines[line], line, tag, 2, "tag", SymbolKind.Class));
      continue;
    }

    const klass = CLASS_DOCUMENT_SYMBOL.exec(lines[line]);
    if (klass) {
      const detail = declarationDetail(klass[2], klass[3]);
      symbols.push(
        workspaceSymbolFromMatch(
          uri,
          lines[line],
          line,
          klass,
          4,
          detail,
          symbolKindForClass(klass[3]),
          workspaceClassDisplayName(klass[4], detail),
        ),
      );
    }
  }

  return symbols;
}

function workspaceSymbolFromMatch(uri, lineText, line, match, nameIndex, containerName, kind, displayName) {
  const name = match[nameIndex];
  const character = lineText.indexOf(name, match[1].length);
  const range = {
    start: { line, character },
    end: { line, character: character + name.length },
  };

  return {
    name: displayName || name,
    matchName: name,
    kind,
    location: { uri, range },
    containerName,
  };
}

function workspaceClassDisplayName(name, detail) {
  if (/\bextend\b/.test(detail)) return `${name} · extend class`;
  if (/\bdeclare\b/.test(detail)) return `${name} · declare class`;
  if (/\binterface\b/.test(detail)) return `${name} · interface`;
  if (/\bmixin\b/.test(detail)) return `${name} · mixin`;
  return `${name} · class`;
}

function lspWorkspaceSymbol(symbol) {
  return {
    name: symbol.name,
    kind: symbol.kind,
    location: symbol.location,
    containerName: symbol.containerName,
  };
}

function documentSymbolsForText(text) {
  const roots = [];
  const stack = [];
  const lines = text.split(/\r\n|\r|\n/);

  for (let line = 0; line < lines.length; line += 1) {
    const declaration = declarationForLine(lines[line], line);
    if (!declaration) continue;

    while (stack.length && stack[stack.length - 1].indent >= declaration.indent) {
      closeDocumentSymbol(stack.pop(), lines, line - 1);
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.symbol.children.push(declaration.symbol);
    } else {
      roots.push(declaration.symbol);
    }

    stack.push(declaration);
  }

  while (stack.length) {
    closeDocumentSymbol(stack.pop(), lines, lines.length - 1);
  }

  return roots;
}

function declarationForLine(lineText, line) {
  if (!lineText.trim()) return null;

  const matchers = [
    {
      pattern: TAG_DOCUMENT_SYMBOL,
      nameIndex: 2,
      detail: () => "tag",
      kind: () => SymbolKind.Class,
    },
    {
      pattern: CLASS_DOCUMENT_SYMBOL,
      nameIndex: 4,
      detail: match => declarationDetail(match[2], match[3]),
      kind: match => symbolKindForClass(match[3]),
    },
    {
      pattern: METHOD_DOCUMENT_SYMBOL,
      nameIndex: 3,
      detail: match => match[2],
      kind: match => symbolKindForMethod(match[2]),
    },
    {
      pattern: FIELD_DOCUMENT_SYMBOL,
      nameIndex: 3,
      detail: match => match[2],
      kind: () => SymbolKind.Field,
    },
    {
      pattern: DESCRIPTOR_DOCUMENT_SYMBOL,
      nameIndex: 2,
      detail: () => "field",
      kind: () => SymbolKind.Property,
    },
  ];

  for (const matcher of matchers) {
    const match = matcher.pattern.exec(lineText);
    if (!match) continue;

    const name = match[matcher.nameIndex];
    const resolvedDetail = matcher.detail(match);
    const resolvedKind = matcher.kind(match);
    const character = lineText.indexOf(name, match[1].length);
    if (character < 0) continue;

    return {
      indent: indentationLevel(match[1]),
      symbol: {
        name,
        detail: resolvedDetail,
        kind: resolvedKind,
        range: {
          start: { line, character: match[1].length },
          end: { line, character: lineText.length },
        },
        selectionRange: {
          start: { line, character },
          end: { line, character: character + name.length },
        },
        children: [],
      },
    };
  }

  return null;
}

function declarationDetail(modifierText, kind) {
  const modifiers = modifierText
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return [...modifiers, kind].join(" ") || kind;
}

function symbolKindForClass(kind) {
  return kind === "interface" ? SymbolKind.Interface : SymbolKind.Class;
}

function symbolKindForMethod(kind) {
  if (kind === "constructor") return SymbolKind.Constructor;
  if (kind === "get" || kind === "set") return SymbolKind.Property;
  return SymbolKind.Method;
}

function closeDocumentSymbol(declaration, lines, endLine) {
  const line = Math.max(declaration.symbol.range.start.line, endLine);
  declaration.symbol.range.end = {
    line,
    character: lines[line] ? lines[line].length : 0,
  };
}

function indentationLevel(leadingWhitespace) {
  let level = 0;
  for (const character of leadingWhitespace) {
    level += character === "\t" ? 2 : 1;
  }
  return level;
}

function compareWorkspaceSymbols(left, right, query) {
  return (
    matchRank(matchName(left.symbol), query) - matchRank(matchName(right.symbol), query) ||
    declarationRank(left.symbol) - declarationRank(right.symbol) ||
    left.symbol.name.length - right.symbol.name.length ||
    left.index - right.index
  );
}

function matchName(symbol) {
  return symbol.matchName || symbol.name;
}

function matchRank(name, query) {
  const normalizedName = name.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedName === normalizedQuery) return 0;
  if (normalizedName.startsWith(normalizedQuery)) return 1;
  if (normalizedName.includes(normalizedQuery)) return 2;
  return 3;
}

function declarationRank(symbol) {
  const containerName = symbol.containerName || "";
  if (/\bextend\b/.test(containerName)) return 20;
  if (/\bdeclare\b/.test(containerName)) return 10;
  if (/\bclass\b/.test(containerName)) return 0;
  if (/\binterface\b/.test(containerName)) return 2;
  if (/\bmixin\b/.test(containerName)) return 3;
  return 0;
}

function matchesQuery(name, query) {
  const normalizedName = name.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  if (normalizedName.includes(normalizedQuery)) return true;

  let index = 0;
  for (const char of normalizedQuery) {
    index = normalizedName.indexOf(char, index);
    if (index === -1) return false;
    index += 1;
  }
  return true;
}

function isImbaFile(fileName) {
  return fileName.endsWith(".imba") || fileName.endsWith(".imba2");
}

function readUri(uri) {
  const filePath = uriToPath(uri);
  return filePath ? readFile(filePath) : null;
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function uriToPath(uri) {
  if (!uri || typeof uri !== "string") return null;
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

function respond(id, result) {
  write({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

function log(message) {
  write({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 3, message } });
}

function write(message) {
  const json = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}
