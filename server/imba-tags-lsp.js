#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

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
  `^(\\s*)(?:\\$[A-Za-z_][-\\w]*\\$\\s+)?(?:export\\s+(?:default\\s+)?)?(?:(?:global|declare|abstract|extend|strict)\\s+)*(class|interface|mixin)\\s+(${PROPERTY_NAME}(?:\\.${PROPERTY_NAME})*)\\b`,
);
const METHOD_DOCUMENT_SYMBOL = new RegExp(
  `^(\\s*)(?:(?:global|static|protected|private|declare)\\s+)*(def|get|set|constructor)\\s+(?:(?:${IDENTIFIER}|self|this)[.#])?(${PROPERTY_NAME})\\b`,
);
const FIELD_DOCUMENT_SYMBOL = new RegExp(
  `^(\\s*)(?:(?:lazy|static|declare|protected|private)\\s+)*(prop|attr|let|const|isa)\\s+(${PROPERTY_NAME})\\b`,
);
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
        documentSymbolProvider: true,
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
  return symbols
    .filter(symbol => {
      const key = `${symbol.name}\0${symbol.location.uri}\0${symbol.location.range.start.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return matchesQuery(symbol.name, query);
    })
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
      symbols.push(
        workspaceSymbolFromMatch(
          uri,
          lines[line],
          line,
          klass,
          3,
          klass[2],
          symbolKindForClass(klass[2]),
        ),
      );
    }
  }

  return symbols;
}

function workspaceSymbolFromMatch(uri, lineText, line, match, nameIndex, containerName, kind) {
  const name = match[nameIndex];
  const character = lineText.indexOf(name, match[1].length);
  const range = {
    start: { line, character },
    end: { line, character: character + name.length },
  };

  return {
    name,
    kind,
    location: { uri, range },
    containerName,
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
    [TAG_DOCUMENT_SYMBOL, 2, "tag", SymbolKind.Class],
    [CLASS_DOCUMENT_SYMBOL, 3, null, symbolKindForClass],
    [METHOD_DOCUMENT_SYMBOL, 3, null, symbolKindForMethod],
    [FIELD_DOCUMENT_SYMBOL, 3, null, SymbolKind.Field],
    [DESCRIPTOR_DOCUMENT_SYMBOL, 2, "field", SymbolKind.Property],
  ];

  for (const [pattern, nameIndex, detail, kind] of matchers) {
    const match = pattern.exec(lineText);
    if (!match) continue;

    const name = match[nameIndex];
    const resolvedDetail = detail || match[2];
    const resolvedKind = typeof kind === "function" ? kind(match[2]) : kind;
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
