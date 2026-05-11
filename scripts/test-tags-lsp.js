#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const extensionRoot = path.resolve(__dirname, "..");
const serverPath = path.join(extensionRoot, "server", "imba-tags-lsp.js");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "imba-tags-lsp-"));
const fixturePath = path.join(fixtureRoot, "item-map.imba");
const fixtureText = [
  "tag item-view",
  "\tcss",
  "\t\t1navh:10px",
  "\t\t$box",
  "\t\t\tpos:fixed",
  "\tget attachment",
  "\t\tself.data",
  "\tdef render",
  "\t\t<self>",
  "",
  "global tag item-row",
  "export tag App",
  "declare tag ns:item-map",
  "",
  "global class Item < OPEmbed",
  "\tdeclare layout\\string?",
  "\tget as-icon",
  "\t\ttype..as-icon or super",
  "\topen @action do(o = {})",
  "\t\tlet dest = target",
  "",
  "extend class Item",
  "\tdef patch",
  "\t\tself",
  "",
  "tag app-root",
  "\tdef render",
  "\t\t<item-view>",
  "\t\t<item-row$row>",
  "\t\t<Item>",
  "\t\t<div[h:40navh mt:1navh]>",
  "\t\tcss pt:0.5navh",
  "\t\titem.as-icon",
  "\t\topen!",
  "",
].join("\n");

fs.writeFileSync(fixturePath, fixtureText, "utf8");

const server = spawn(process.execPath, [serverPath], {
  cwd: extensionRoot,
  stdio: ["pipe", "pipe", "pipe"],
});

let input = Buffer.alloc(0);
let nextContentLength = null;
let nextId = 0;
const pending = new Map();

server.stdout.on("data", chunk => {
  input = Buffer.concat([input, chunk]);
  readMessages();
});

server.stderr.on("data", chunk => {
  process.stderr.write(chunk);
});

server.on("exit", code => {
  if (code && pending.size) {
    throw new Error(`language server exited before responding: ${code}`);
  }
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

    const message = JSON.parse(body);
    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    }
  }
}

function request(method, params) {
  const message = {
    jsonrpc: "2.0",
    id: ++nextId,
    method,
    params,
  };

  write(message);
  return new Promise(resolve => pending.set(message.id, resolve));
}

function notify(method, params) {
  write({ jsonrpc: "2.0", method, params });
}

function write(message) {
  const json = JSON.stringify(message);
  server.stdin.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}

function positionOf(needle, offset = 0) {
  const index = fixtureText.indexOf(needle);
  assert.notEqual(index, -1, `missing fixture text: ${needle}`);
  const before = fixtureText.slice(0, index + offset);
  const lines = before.split("\n");
  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
  };
}

function lineOf(needle) {
  return positionOf(needle).line;
}

async function main() {
  await request("initialize", {
    processId: process.pid,
    rootUri: pathToFileURL(fixtureRoot).href,
    workspaceFolders: [{ name: "fixture", uri: pathToFileURL(fixtureRoot).href }],
    capabilities: {},
  });
  notify("initialized", {});

  const allSymbols = await request("workspace/symbol", { query: "" });
  assert.deepEqual(
    allSymbols.result.map(symbol => symbol.name),
    ["item-view", "item-row", "App", "ns:item-map", "Item · class", "Item · extend class", "app-root"],
  );

  const filteredSymbols = await request("workspace/symbol", { query: "view" });
  assert.deepEqual(
    filteredSymbols.result.map(symbol => symbol.name),
    ["item-view"],
  );

  const classSymbols = await request("workspace/symbol", { query: "Item" });
  assert.deepEqual(
    classSymbols.result.slice(0, 2).map(symbol => `${symbol.containerName}:${symbol.name}`),
    [
      "global class:Item · class",
      "extend class:Item · extend class",
    ],
  );

  notify("textDocument/didOpen", {
    textDocument: {
      uri: pathToFileURL(fixturePath).href,
      languageId: "imba",
      version: 1,
      text: fixtureText,
    },
  });

  const tagDefinition = await request("textDocument/definition", {
    textDocument: { uri: pathToFileURL(fixturePath).href },
    position: positionOf("<item-view>", 2),
  });
  assert.equal(tagDefinition.result[0].range.start.line, lineOf("tag item-view"));

  const tagRefDefinition = await request("textDocument/definition", {
    textDocument: { uri: pathToFileURL(fixturePath).href },
    position: positionOf("<item-row$row>", 2),
  });
  assert.equal(tagRefDefinition.result[0].range.start.line, lineOf("global tag item-row"));

  const tagClassDefinition = await request("textDocument/definition", {
    textDocument: { uri: pathToFileURL(fixturePath).href },
    position: positionOf("<Item>", 2),
  });
  assert.equal(tagClassDefinition.result[0].range.start.line, lineOf("global class Item"));

  const cssUnitDefinition = await request("textDocument/definition", {
    textDocument: { uri: pathToFileURL(fixturePath).href },
    position: positionOf("h:40navh", "h:40".length + 1),
  });
  assert.equal(cssUnitDefinition.result[0].range.start.line, lineOf("1navh:10px"));

  const decimalCssUnitDefinition = await request("textDocument/definition", {
    textDocument: { uri: pathToFileURL(fixturePath).href },
    position: positionOf("pt:0.5navh", "pt:0.5".length + 1),
  });
  assert.equal(decimalCssUnitDefinition.result[0].range.start.line, lineOf("1navh:10px"));

  const cssUnitSelfDefinition = await request("textDocument/definition", {
    textDocument: { uri: pathToFileURL(fixturePath).href },
    position: positionOf("1navh:10px", "1".length + 1),
  });
  assert.equal(cssUnitSelfDefinition.result[0].range.start.line, lineOf("1navh:10px"));

  const methodDefinitions = await request("textDocument/definition", {
    textDocument: { uri: pathToFileURL(fixturePath).href },
    position: positionOf("item.as-icon", "item.".length + 1),
  });
  assert.ok(methodDefinitions.result.some(location => location.range.start.line === lineOf("\tget as-icon")));

  const actionDefinitions = await request("textDocument/definition", {
    textDocument: { uri: pathToFileURL(fixturePath).href },
    position: positionOf("\t\topen!", "\t\t".length + 1),
  });
  assert.ok(actionDefinitions.result.some(location => location.range.start.line === lineOf("\topen @action")));

  const documentSymbols = await request("textDocument/documentSymbol", {
    textDocument: { uri: pathToFileURL(fixturePath).href },
  });
  assert.deepEqual(
    documentSymbols.result.map(symbol => symbol.name),
    ["item-view", "item-row", "App", "ns:item-map", "Item", "Item", "app-root"],
  );
  assert.deepEqual(
    documentSymbols.result[0].children.map(symbol => symbol.name),
    ["attachment", "render"],
  );
  assert.deepEqual(
    documentSymbols.result[4].children.map(symbol => symbol.name),
    ["layout", "as-icon", "open"],
  );

  await request("shutdown", null);
  notify("exit", null);

  console.log("imba-tags-lsp smoke test passed");
}

main().catch(error => {
  server.kill();
  console.error(error);
  process.exit(1);
});
