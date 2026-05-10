; Keywords
[
  "abstract"
  "as"
  "await"
  "begin"
  "break"
  "catch"
  "class"
  "const"
  "continue"
  "css"
  "declare"
  "def"
  "do"
  "elif"
  "else"
  "export"
  "extend"
  "finally"
  "for"
  "from"
  "get"
  "global"
  "if"
  "import"
  "interface"
  "let"
  "local"
  "mixin"
  "new"
  "own"
  "return"
  "set"
  "static"
  "tag"
  "throw"
  "try"
  "unless"
  "until"
  "var"
  "when"
  "while"
  "yield"
] @keyword

(debugger_statement) @keyword

[
  "and"
  "delete"
  "in"
  "isa"
  "is"
  "isnt"
  "not"
  "of"
  "or"
  "typeof"
] @operator

[
  "="
  "=?"
  "??="
  "||="
  "&&="
  "+="
  "-="
  "*="
  "/="
  "%="
  "^="
  "|="
  "&="
  "~="
  "<<="
  ">>="
  ">>>="
  "=="
  "!="
  "==="
  "!=="
  "~="
  "<"
  "<="
  ">"
  ">="
  "+"
  "-"
  "*"
  "/"
  "%"
  "**"
  "&&"
  "||"
  "??"
  "?"
  ":"
  "."
  "?."
  "::"
] @operator

; Declarations
(class_declaration
  name: (class_name) @type)

(class_expression
  name: (class_name) @type)

(tag_declaration
  name: (tag_type) @type)

(method_declaration
  name: (_) @function @function.method)

(call_expression
  function: (identifier) @function @function.call)

(call_expression
  function: (member_expression
    property: (identifier) @function @function.method.call))

(field_declaration
  name: (_) @property)

(pair
  key: (_) @property)

(tag_literal) @tag

(css_property
  name: (css_property_name) @property)

(css_selector_part) @tag

; Identifiers and literals
(identifier) @variable
(pair
  key: (identifier) @property)
(decorator_identifier) @attribute
(style_mixin_identifier) @attribute
(symbol_identifier) @constant
(env_flag) @constant
(argument_variable) @variable @variable.parameter

(this) @variable @variable.special
(self) @variable @variable.special
(super) @variable @variable.special
(arguments_identifier) @variable @variable.special

(number) @number
(unit) @type
(unit_number) @number
(color_literal) @constant
(boolean) @boolean
(null) @constant.builtin
(undefined) @constant.builtin
(symbol) @string.special
(regex_literal) @string @string.regex
(heregex_literal) @string @string.regex

[
  (single_quote_string)
  (double_quote_string)
  (template_string)
  (triple_quote_string)
  (triple_single_quote_string)
] @string

(style_interpolation "{" @punctuation.special "}" @punctuation.special)

; Comments
(line_comment) @comment
(block_comment) @comment

; Punctuation
[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  ","
] @punctuation.delimiter
