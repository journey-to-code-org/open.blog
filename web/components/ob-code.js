// <ob-code highlight> wraps rendered Markdown. It adds a "Copy" button to every
// code block and, when the `highlight` attribute is present, colours the code
// with a small built-in tokenizer: no external library, no network request.
//
// Colours come from theme tokens (--ob-color-code-keyword and friends), so a
// theme restyles the palette without touching this file. A theme that ships
// its own highlighter sets "codeHighlighting": false in theme.json, which
// drops the attribute, and loads its script through "scripts".
//
// Tokens are emitted as <span class="tok-…"> elements built with DOM calls,
// never innerHTML, so code can never inject markup.

const ALIASES = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  sh: "bash", shell: "bash", zsh: "bash", console: "bash", shellsession: "bash",
  yml: "yaml", rs: "rust", py: "python", rb: "ruby",
  html: "markup", xml: "markup", svg: "markup", vue: "markup", astro: "markup",
  c: "clike", cpp: "clike", "c++": "clike", h: "clike", hpp: "clike", java: "clike", cs: "clike", csharp: "clike",
  kt: "clike", kotlin: "clike", swift: "clike", scala: "clike", dart: "clike", php: "clike",
  golang: "go", md: "markdown", mkd: "markdown", txt: "none", text: "none", plain: "none", plaintext: "none",
};

const words = (s) => new Set(s.split(/\s+/));

// Shared rule pieces. All regexes are sticky: they must match at the cursor.
const LINE_COMMENT = (prefix) => ({ re: new RegExp(`${prefix}[^\\n]*`, "y"), cls: "comment" });
const BLOCK_COMMENT = { re: /\/\*[\s\S]*?(?:\*\/|$)/y, cls: "comment" };
const DQ_STRING = { re: /"(?:\\[\s\S]|[^"\\\n])*"?/y, cls: "string" };
const SQ_STRING = { re: /'(?:\\[\s\S]|[^'\\\n])*'?/y, cls: "string" };
const TEMPLATE = { re: /`(?:\\[\s\S]|[^`\\])*`?/y, cls: "string" };
const NUMBER = { re: /\b(?:0x[\da-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)(?:[a-zA-Z_][\w]*)?\b/y, cls: "number" };
const WS = { re: /\s+/y, cls: null };

/** Identifier rule: keyword, type, or function call, else plain. */
function ident(keywords, types, { capsAreTypes = false, builtins = new Set() } = {}) {
  return {
    re: /[A-Za-z_$][\w$]*/y,
    cls: (m, src, end) => {
      if (keywords.has(m)) return "keyword";
      if (types.has(m) || builtins.has(m)) return "type";
      if (capsAreTypes && /^[A-Z]/.test(m)) return "type";
      if (/^\s*\(/y.test(src.slice(end, end + 2))) return "function";
      return null;
    },
  };
}

const RUST_KW = words("as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while union macro_rules");
const RUST_TY = words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Some None Result Ok Err Box Rc Arc HashMap HashSet BTreeMap Cow");
const JS_KW = words("abstract as async await break case catch class const continue debugger default delete do else enum export extends finally for from function get if implements import in instanceof interface let new null of package private protected public return satisfies set static super switch this throw true false try type typeof undefined var void while with yield keyof readonly declare namespace module override");
const JS_TY = words("Array Object String Number Boolean Promise Map Set Symbol Date RegExp Error JSON Math console document window customElements HTMLElement Element Node globalThis");
const PY_KW = words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None match case self");
const PY_TY = words("int float str bool list dict set tuple bytes object range print len type super Exception ValueError TypeError");
const GO_KW = words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota");
const GO_TY = words("bool byte rune string error int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 any");
const CLIKE_KW = words("abstract as break case catch class const continue default delete do else enum explicit export extends extern final finally for friend goto if implements import in inline instanceof interface internal namespace native new null nullptr operator override package private protected public return sealed sizeof static struct super switch synchronized template this throw throws transient try typedef typename union unsigned using var virtual void volatile while with yield true false fun val let when object data companion guard defer func init mutating where is out ref readonly");
const CLIKE_TY = words("int long short char float double bool boolean byte string String void auto size_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t Int Double Float Bool List Map Array Integer");
const SQL_KW = words("select from where and or not in is null as join inner left right full outer on group by order having limit offset insert into values update set delete create table drop alter add primary key foreign references index view if exists distinct union all case when then else end like between asc desc with returning default unique check constraint begin commit rollback");
const BASH_KW = words("if then else elif fi for while until do done case esac in function select time return exit export local readonly set unset source alias cd echo printf read test true false sudo");

function clikeRules(kw, ty, extra = {}) {
  return [WS, LINE_COMMENT("//"), BLOCK_COMMENT, DQ_STRING, SQ_STRING, TEMPLATE, NUMBER, ident(kw, ty, extra)];
}

const LANGUAGES = {
  rust: [
    WS, LINE_COMMENT("//"), BLOCK_COMMENT,
    { re: /#!?\[[^\]\n]*\]/y, cls: "meta" },
    { re: /'[A-Za-z_]\w*(?!')/y, cls: "meta" }, // lifetime
    { re: /b?"(?:\\[\s\S]|[^"\\])*"?/y, cls: "string" },
    { re: /b?r#*"[\s\S]*?"#*/y, cls: "string" },
    { re: /b?'(?:\\.|[^'\\])'/y, cls: "string" },
    NUMBER,
    { re: /[A-Za-z_]\w*!(?=[\s(\[{])/y, cls: "function" }, // macro
    ident(RUST_KW, RUST_TY, { capsAreTypes: true }),
  ],
  javascript: clikeRules(JS_KW, JS_TY),
  typescript: clikeRules(JS_KW, JS_TY),
  go: clikeRules(GO_KW, GO_TY),
  clike: [WS, LINE_COMMENT("//"), BLOCK_COMMENT, { re: /#\s*\w+[^\n]*/y, cls: "meta" }, DQ_STRING, SQ_STRING, NUMBER, { re: /@\w+/y, cls: "meta" }, ident(CLIKE_KW, CLIKE_TY)],
  python: [
    WS, LINE_COMMENT("#"),
    { re: /[rbfu]*("""|''')[\s\S]*?\1/y, cls: "string" },
    { re: /[rbfu]*"(?:\\[\s\S]|[^"\\\n])*"?/y, cls: "string" },
    { re: /[rbfu]*'(?:\\[\s\S]|[^'\\\n])*'?/y, cls: "string" },
    { re: /@[\w.]+/y, cls: "meta" },
    NUMBER,
    ident(PY_KW, PY_TY, { capsAreTypes: true }),
  ],
  ruby: [WS, LINE_COMMENT("#"), DQ_STRING, SQ_STRING, { re: /:\w+/y, cls: "meta" }, { re: /@{1,2}\w+/y, cls: "variable" }, NUMBER, ident(words("def end class module if elsif else unless while until for do return yield begin rescue ensure self nil true false and or not require include attr_accessor puts"), new Set(), { capsAreTypes: true })],
  bash: [
    WS, LINE_COMMENT("#"),
    { re: /^\$ /my, cls: "prompt" },
    DQ_STRING, SQ_STRING,
    { re: /\$(?:\{[^}\n]*\}|[\w@#?*$!-]+)/y, cls: "variable" },
    { re: /(?<=^|[\s|&;(])--?[\w-]+/y, cls: "attr" },
    NUMBER,
    { re: /[A-Za-z_][\w.-]*/y, cls: (m, src, end, start) => (BASH_KW.has(m) ? "keyword" : /(?:^|[|&;(]|&&|\|\|)\s*$/.test(src.slice(Math.max(0, start - 40), start)) ? "function" : null) },
  ],
  sql: [WS, LINE_COMMENT("--"), BLOCK_COMMENT, SQ_STRING, DQ_STRING, NUMBER, { re: /[A-Za-z_]\w*/y, cls: (m, src, end) => (SQL_KW.has(m.toLowerCase()) ? "keyword" : /^\s*\(/y.test(src.slice(end, end + 2)) ? "function" : null) }],
  json: [WS, { re: /"(?:\\[\s\S]|[^"\\\n])*"(?=\s*:)/y, cls: "attr" }, DQ_STRING, NUMBER, { re: /\b(?:true|false|null)\b/y, cls: "keyword" }],
  yaml: [
    WS, LINE_COMMENT("#"),
    { re: /^(?:---|\.\.\.)$/my, cls: "meta" },
    { re: /(?<=^[ \t]*(?:- )?)[^\s#:"'][^:\n]*(?=:(?:\s|$))/my, cls: "attr" },
    { re: /[&*][\w-]+/y, cls: "variable" },
    DQ_STRING, SQ_STRING,
    { re: /\b(?:true|false|null|yes|no|on|off)\b/y, cls: "keyword" },
    NUMBER,
  ],
  toml: [WS, LINE_COMMENT("#"), { re: /^\[\[?[^\]\n]+\]\]?/my, cls: "tag" }, { re: /^[ \t]*[\w."'-]+(?=\s*=)/my, cls: "attr" }, { re: /"""[\s\S]*?"""|'''[\s\S]*?'''/y, cls: "string" }, DQ_STRING, SQ_STRING, { re: /\d{4}-\d\d-\d\d(?:[T ][\d:.]+(?:Z|[+-]\d\d:\d\d)?)?/y, cls: "number" }, NUMBER, { re: /\b(?:true|false|inf|nan)\b/y, cls: "keyword" }],
  css: [
    WS, BLOCK_COMMENT, DQ_STRING, SQ_STRING,
    { re: /@[\w-]+/y, cls: "keyword" },
    { re: /!important/y, cls: "keyword" },
    { re: /--[\w-]+/y, cls: "variable" },
    { re: /#[\da-fA-F]{3,8}\b/y, cls: "number" },
    { re: /-?\d*\.?\d+(?:%|[a-zA-Z]+)?/y, cls: "number" },
    { re: /[\w-]+(?=\s*:)/y, cls: "attr" },
    { re: /[\w-]+(?=\()/y, cls: "function" },
    { re: /(?:\.|#|::?)[\w-]+|\[[^\]\n]*\]/y, cls: "tag" },
  ],
  markdown: [
    WS,
    { re: /^#{1,6} [^\n]*/my, cls: "keyword" },
    { re: /```[\s\S]*?```/y, cls: "string" },
    { re: /`[^`\n]+`/y, cls: "string" },
    { re: /\*\*[^*\n]+\*\*|__[^_\n]+__/y, cls: "type" },
    { re: /!?\[[^\]\n]*\]\([^)\n]*\)/y, cls: "function" },
    { re: /^>[^\n]*/my, cls: "comment" },
    { re: /^\s*(?:[-*+]|\d+\.) /my, cls: "meta" },
  ],
};

/** Tokenize with sticky rules; returns [{text, cls}] covering the whole source. */
function tokenize(src, rules) {
  const out = [];
  let pos = 0;
  let plain = "";
  const flush = () => {
    if (plain) out.push({ text: plain, cls: null });
    plain = "";
  };
  while (pos < src.length) {
    let matched = false;
    for (const rule of rules) {
      rule.re.lastIndex = pos;
      const m = rule.re.exec(src);
      if (!m || m[0].length === 0) continue;
      const cls = typeof rule.cls === "function" ? rule.cls(m[0], src, pos + m[0].length, pos) : rule.cls;
      if (cls) {
        flush();
        out.push({ text: m[0], cls });
      } else {
        plain += m[0];
      }
      pos += m[0].length;
      matched = true;
      break;
    }
    if (!matched) {
      plain += src[pos];
      pos += 1;
    }
  }
  flush();
  return out;
}

/** HTML/XML: tags, attributes, attribute values, comments; text stays plain. */
function tokenizeMarkup(src) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/?[A-Za-z][^\s>/]*(?:\s+[^>]*?)?\/?>/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ text: src.slice(last, m.index), cls: null });
    const tag = m[0];
    if (tag.startsWith("<!--")) out.push({ text: tag, cls: "comment" });
    else if (tag.startsWith("<!")) out.push({ text: tag, cls: "meta" });
    else {
      const name = tag.match(/^<\/?[^\s>/]+/)[0];
      out.push({ text: name, cls: "tag" });
      const rest = tag.slice(name.length);
      const attrRe = /([^\s=/>]+)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s>]+)?|\/?>|\s+/g;
      let a;
      while ((a = attrRe.exec(rest))) {
        if (a[1]) {
          out.push({ text: a[1], cls: "attr" });
          if (a[2]) out.push({ text: a[2], cls: null });
          if (a[3]) out.push({ text: a[3], cls: "string" });
        } else if (a[0].trim().endsWith(">")) out.push({ text: a[0], cls: "tag" });
        else out.push({ text: a[0], cls: null });
      }
    }
    last = m.index + tag.length;
  }
  if (last < src.length) out.push({ text: src.slice(last), cls: null });
  return out;
}

export function highlight(code, language) {
  const lang = ALIASES[language] || language;
  if (lang === "markup") return tokenizeMarkup(code);
  const rules = LANGUAGES[lang];
  return rules ? tokenize(code, rules) : [{ text: code, cls: null }];
}

function paint(codeEl) {
  const match = /(?:^|\s)language-([\w+#-]+)/.exec(codeEl.className || "");
  if (!match || codeEl.dataset.highlighted) return;
  const tokens = highlight(codeEl.textContent, match[1].toLowerCase());
  if (tokens.every((t) => !t.cls)) return;
  const frag = document.createDocumentFragment();
  for (const t of tokens) {
    if (t.cls) {
      const span = document.createElement("span");
      span.className = `tok-${t.cls}`;
      span.textContent = t.text;
      frag.append(span);
    } else {
      frag.append(t.text);
    }
  }
  codeEl.replaceChildren(frag);
  codeEl.dataset.highlighted = "true";
}

class ObCode extends HTMLElement {
  connectedCallback() {
    const doHighlight = this.hasAttribute("highlight");
    for (const pre of this.querySelectorAll("pre")) {
      const code = pre.querySelector("code");
      if (doHighlight && code) {
        try {
          paint(code);
        } catch {
          // A tokenizer bug must never blank out the code; the plain text stays.
        }
      }
      if (navigator.clipboard && !pre.querySelector(".ob-copy")) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ob-copy";
        button.textContent = "Copy";
        button.setAttribute("aria-label", "Copy code to clipboard");
        button.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(code?.textContent ?? pre.textContent);
            button.textContent = "Copied";
          } catch {
            button.textContent = "Failed";
          }
          setTimeout(() => (button.textContent = "Copy"), 1600);
        });
        pre.append(button);
      }
    }
  }
}

if (!customElements.get("ob-code")) {
  customElements.define("ob-code", ObCode);
}
