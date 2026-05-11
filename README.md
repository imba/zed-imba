# Imba for Zed

Zed language extension for Imba.

This extension wires Zed to the standalone Tree-sitter Imba grammar and ships the first set of Tree-sitter queries for syntax highlighting, CSS injections, bracket matching, indentation, and outline entries.

It also includes a very small language server that indexes `tag ...` and `class ...` declarations so Zed's project symbol search can find Imba tags/classes. The same server can provide indentation-based document symbols for nested tags/classes/methods while the Tree-sitter grammar is still incomplete, basic goto-definition for tag names, custom CSS units, and naive same-name method/action lookups, plus semantic tokens from the vendored `imba-monarch` parser.

## Installation

Once published in the Zed extension registry, install it from `zed: extensions` by searching for `Imba`.

Until then, install it as a dev extension:

1. Clone this repository.
2. Install Rust through `rustup` if you have not already.
3. In Zed, open the command palette.
4. Run `zed: install dev extension`.
5. Select the cloned `zed-imba` directory.
6. Open an `.imba` file.

The extension downloads the Tree-sitter grammar from `https://github.com/imba/treesitter-imba` at the revision pinned in `extension.toml`, so users do not need a local grammar checkout.

If Zed does not pick up changes, reinstall or reload the dev extension and check `zed: open log`.

## Development

To smoke-test the language server outside Zed:

```sh
node scripts/test-tags-lsp.js
```

Zed dev extensions that include language servers are Rust extensions, so local extension development needs Rust installed through `rustup`.

To update the pinned grammar revision after committing and pushing grammar changes:

```sh
node scripts/update-local-grammar-rev.js ../treesitter-imba
```

That command reads the local grammar checkout, but writes the public grammar repository URL into `extension.toml`. For private local grammar experiments only, pass `--local` to write a `file://` grammar URL.

To use the language server for the outline and breadcrumbs instead of `outline.scm`, add this to your Zed settings:

```json
{
  "languages": {
    "Imba": {
      "document_symbols": "on"
    }
  }
}
```

To test semantic tokens, enable them in Zed settings:

```json
{
  "languages": {
    "Imba": {
      "semantic_tokens": "combined"
    }
  }
}
```

## Publishing

Before publishing:

- Make sure `extension.toml` uses a public grammar repository URL, not `file://`.
- Make sure the pinned grammar `rev` has been pushed to the grammar repository.
- Make sure this repository has been pushed publicly.
- Keep an accepted license file at the extension root.
- Bump `version` in `extension.toml` for releases.

To publish to the Zed registry, open a PR to `zed-industries/extensions` that adds this repo as a submodule under `extensions/imba`, adds an `[imba]` entry to `extensions.toml`, and runs `pnpm sort-extensions`.
