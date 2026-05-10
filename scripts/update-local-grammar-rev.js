#!/usr/bin/env node

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const extensionDir = path.resolve(__dirname, "..");
const grammarRepo = process.argv[2] ? path.resolve(process.argv[2]) : "/Users/sindre/repos/treesitter-imba";
const manifestPath = path.join(extensionDir, "extension.toml");

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || extensionDir,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : "";
    const stdout = result.stdout ? `\n${result.stdout.trim()}` : "";
    throw new Error(`${command} ${args.join(" ")} failed${stderr}${stdout}`);
  }

  return (result.stdout || "").trim();
}

if (!fs.existsSync(path.join(grammarRepo, ".git"))) {
  throw new Error(`Expected a Git repository at ${grammarRepo}`);
}

const status = run("git", ["status", "--short"], { cwd: grammarRepo });
if (status) {
  console.error(status);
  throw new Error("Commit or stash Tree-sitter grammar changes before pinning a Zed grammar revision.");
}

const rev = run("git", ["rev-parse", "HEAD"], { cwd: grammarRepo });
const repository = `file://${grammarRepo}`;
let manifest = fs.readFileSync(manifestPath, "utf8");
manifest = manifest.replace(
  /\[grammars\.imba\]\n[\s\S]*$/,
  `[grammars.imba]\nrepository = "${repository}"\nrev = "${rev}"\n`,
);
fs.writeFileSync(manifestPath, manifest);
console.log(`Pinned Imba grammar ${rev} from ${repository}`);
