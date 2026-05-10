(class_declaration
  [
    "class"
    "interface"
    "mixin"
  ] @context
  name: (class_name) @name) @item

(class_expression
  "class" @context
  name: (class_name) @name) @item

(tag_declaration
  [
    "extend"
    "global"
    "local"
    "declare"
    "abstract"
  ]? @context
  "tag" @context
  name: (tag_type) @name) @item

(method_declaration
  [
    "def"
    "get"
    "set"
    "constructor"
  ] @context
  name: (_) @name) @item

(field_declaration
  [
    "prop"
    "attr"
    "let"
    "const"
    "isa"
  ] @context
  name: (_) @name) @item
