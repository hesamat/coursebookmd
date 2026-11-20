/**
 * Python built-in function documentation for hover previews.
 *
 * A curated dataset of the builtins a coursebook mentions in prose. The
 * markdown renderer turns matching inline code spans (`len`, `len(x)`) into
 * links to the official docs page, and LinkPreview's PythonDocsProvider
 * serves the card content from this table, so both sides stay offline-safe
 * and deterministic. Signatures mirror the official forms shown on
 * docs.python.org (defaults, `/` and `*` markers included); the card styles
 * those markers down so they read as structure, not noise. Extend the table
 * when coursebooks start mentioning more builtins; every entry needs a
 * `signatures` array and a one-line `summary`, plus an `example` (a short
 * call and its result) where the description alone stays abstract.
 */

export const PYTHON_DOCS_URL = "https://docs.python.org/3/library/functions.html";

export const PYTHON_BUILTINS = {
  bool: {
    signatures: ["bool(object=False, /)"],
    summary:
      'Convert a value to True or False. Empty values like 0, "", and [] are falsy.',
  },
  chr: {
    signatures: ["chr(codepoint, /)"],
    summary: 'Return the character for a Unicode code point: chr(65) is "A".',
  },
  dict: {
    signatures: [
      "dict(**kwargs)",
      "dict(mapping, /, **kwargs)",
      "dict(iterable, /, **kwargs)",
    ],
    summary:
      "Create a dictionary: dict(pairs) from key-value pairs, dict(a=1) from keywords.",
  },
  dir: {
    signatures: ["dir(object, /)", "dir()"],
    summary: "List the attributes and methods available on an object.",
  },
  enumerate: {
    signatures: ["enumerate(iterable, start=0)"],
    summary:
      "Pair each item of an iterable with its index: for i, item in enumerate(items).",
    example: "list(enumerate(\"ab\")) → [(0, 'a'), (1, 'b')]",
  },
  float: {
    signatures: ["float(number=0.0, /)", "float(string, /)"],
    summary: "Convert a number or string to a floating-point number.",
  },
  help: {
    signatures: ["help(request)", "help()"],
    summary:
      "Show the documentation for a function, type, or module in the interactive help system.",
  },
  input: {
    signatures: ["input()", "input(prompt, /)"],
    summary: "Read a line of typed text from the user and return it as a string.",
  },
  int: {
    signatures: ["int(number=0, /)", "int(string, /, base=10)"],
    summary:
      'Convert a number or string to an integer. int("42") is 42; int(3.9) truncates to 3.',
  },
  isinstance: {
    signatures: ["isinstance(object, classinfo, /)"],
    summary:
      "Return True if object is an instance of classinfo (or one of its subclasses).",
    example: 'isinstance("a", str) → True',
  },
  len: {
    signatures: ["len(object, /)"],
    summary: "Return the number of items in a sequence or collection.",
  },
  list: {
    signatures: ["list(iterable=(), /)"],
    summary: 'Build a list from an iterable: list("abc") is ["a", "b", "c"].',
  },
  map: {
    signatures: ["map(function, iterable, /, *iterables, strict=False)"],
    summary:
      "Apply function to every item of an iterable and return an iterator of the results.",
    example: "list(map(str, [1, 2])) → ['1', '2']",
  },
  max: {
    signatures: [
      "max(iterable, /, *, key=None)",
      "max(iterable, /, *, default, key=None)",
      "max(arg1, arg2, /, *args, key=None)",
    ],
    summary:
      "Return the largest item of an iterable, or the largest of several arguments. key= customizes the comparison.",
  },
  min: {
    signatures: [
      "min(iterable, /, *, key=None)",
      "min(iterable, /, *, default, key=None)",
      "min(arg1, arg2, /, *args, key=None)",
    ],
    summary:
      "Return the smallest item of an iterable, or the smallest of several arguments. key= customizes the comparison.",
  },
  next: {
    signatures: ["next(iterator, /)", "next(iterator, default, /)"],
    summary: "Return the next item from an iterator and advance it by one.",
  },
  open: {
    signatures: [
      "open(file, mode='r', buffering=-1, encoding=None, errors=None, newline=None, closefd=True, opener=None)",
    ],
    summary:
      'Open a file and return a file object. Common modes: "r" for reading, "w" for writing.',
  },
  ord: {
    signatures: ["ord(character, /)"],
    summary: 'Return the Unicode code point of a one-character string: ord("A") is 65.',
  },
  print: {
    signatures: ["print(*objects, sep=' ', end='\\n', file=None, flush=False)"],
    summary:
      "Print objects to the screen, separated by sep and ended with end (both customizable).",
  },
  range: {
    signatures: ["range(stop, /)", "range(start, stop, step=1, /)"],
    summary:
      "Represent a sequence of integers: range(stop), or range(start, stop, step) to set the beginning and stride.",
    example: "list(range(3)) → [0, 1, 2]",
  },
  round: {
    signatures: ["round(number, ndigits=None)"],
    summary:
      "Round to a given number of decimal places, or to the nearest integer without ndigits.",
    example: "round(3.14159, 2) → 3.14",
  },
  set: {
    signatures: ["set(iterable=(), /)"],
    summary: "Build a set: an unordered collection of unique items.",
  },
  sorted: {
    signatures: ["sorted(iterable, /, *, key=None, reverse=False)"],
    summary:
      "Return a new sorted list without changing the original. key= and reverse= customize the order.",
  },
  str: {
    signatures: ["str(object)", "str(object, encoding, errors='strict')"],
    summary: "Convert a value to its human-readable string form.",
  },
  sum: {
    signatures: ["sum(iterable, /, start=0)"],
    summary: "Add up the items of an iterable and return the total.",
    example: "sum([2, 3, 5]) → 10",
  },
  tuple: {
    signatures: ["tuple(iterable=(), /)"],
    summary: "Build an immutable sequence from an iterable.",
  },
  type: {
    signatures: ["type(object, /)", "type(name, bases, dict, /, **kwargs)"],
    summary: "Return the type of an object, such as int, str, or list.",
  },
  zip: {
    signatures: ["zip(*iterables, strict=False)"],
    summary: "Combine several iterables item by item into tuples.",
    example: "list(zip(\"ab\", [1, 2])) → [('a', 1), ('b', 2)]",
  },
};

// Longest-first so a future prefix pair like `format`/`format_map` anchors to
// the right name; the full-match anchors below do the rest of the work.
const MENTION_PATTERN = new RegExp(
  `^\\s*(${Object.keys(PYTHON_BUILTINS)
    .sort((a, b) => b.length - a.length)
    .join("|")})\\b(?:\\s*\\([\\s\\S]*\\))?\\s*$`,
);

/**
 * The docs URL an inline code span should link to, or null when its text is
 * not a builtin mention. A mention is the bare name (`len`) or a call
 * (`len(x)`); anything else (`len(x) > 0`, `for`, `my_len`) stays plain code.
 */
export function builtinDocHref(codeText) {
  if (typeof codeText !== "string") return null;
  const match = codeText.match(MENTION_PATTERN);
  return match ? `${PYTHON_DOCS_URL}#${match[1]}` : null;
}
