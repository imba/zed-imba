# Imba for Zed

Development Zed language extension for Imba.

This extension wires Zed to the standalone Tree-sitter Imba grammar and ships the first set of Tree-sitter queries for syntax highlighting, CSS injections, bracket matching, indentation, and outline entries.

## Local Testing

The extension currently points at the local grammar repository in `/Users/sindre/repos/treesitter-imba`. If the grammar changes, commit those changes in that repo and then run:

```sh
node scripts/update-local-grammar-rev.js
```

Then in Zed:

1. Open the command palette.
2. Run `zed: install dev extension`.
3. Select `/Users/sindre/repos/zed-imba`.
4. Open an `.imba` file, for example `/Users/sindre/repos/treesitter-imba/examples/syntax.imba`.

If Zed does not pick up changes, reinstall or reload the dev extension and check `zed: open log`.

## Publishing Shape

For publishing, switch the grammar entry in `extension.toml` from the local `file://` repository to the Tree-sitter Imba repository:

```toml
[grammars.imba]
repository = "https://github.com/imba/treesitter-imba"
rev = "<commit-sha>"
```

Zed extension publishing also expects an accepted license file at the extension root.
