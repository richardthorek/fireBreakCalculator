/**
 * Minimal, dependency-free XML scanner for GIS file imports (KML/GPX).
 *
 * Deliberately NOT DOMParser: imported files are untrusted, and this scanner
 * produces plain data objects — nothing is ever interpreted as HTML, no
 * entities beyond the XML built-ins are expanded, no external resources can
 * be referenced. It is lenient (real-world KML/GPX is messy), namespace-blind
 * (matches on lowercased local names, which is what geo formats need), and
 * bounded (node count + depth caps) so a hostile file cannot blow up the tab.
 */

export interface XmlElement {
  /** Lowercased local name (namespace prefix stripped). */
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct text + CDATA content. */
  text: string;
}

const MAX_NODES = 200_000;
const MAX_DEPTH = 64;

const ENTITY_RE = /&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g;

function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s.replace(ENTITY_RE, (match, body: string) => {
    switch (body) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
    }
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Strip any namespace prefix and lowercase, e.g. "gx:Track" → "track". */
const localName = (raw: string): string => {
  const colon = raw.lastIndexOf(':');
  return (colon === -1 ? raw : raw.slice(colon + 1)).toLowerCase();
};

/** Find the closing '>' of a tag starting at `from` ('<'), respecting quoted attributes. */
function findTagEnd(s: string, from: number): number {
  let quote = '';
  for (let j = from + 1; j < s.length; j++) {
    const c = s[j];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return j;
    }
  }
  return -1;
}

const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseTag(body: string): XmlElement {
  const nameEnd = body.search(/[\s/]/);
  const rawName = nameEnd === -1 ? body : body.slice(0, nameEnd);
  const attrs: Record<string, string> = {};
  if (nameEnd !== -1) {
    let m: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    const rest = body.slice(nameEnd);
    while ((m = ATTR_RE.exec(rest)) !== null) {
      attrs[localName(m[1])] = decodeEntities(m[2] ?? m[3] ?? '');
    }
  }
  return { name: localName(rawName.trim()), attrs, children: [], text: '' };
}

/**
 * Parse an XML string into a lightweight element tree under a synthetic root.
 * Throws on pathological inputs (too many nodes / too deep); tolerates the
 * usual real-world sloppiness (stray closing tags, missing closers at EOF).
 */
export function parseXml(input: string): XmlElement {
  const root: XmlElement = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  let nodes = 0;
  let i = 0;
  const n = input.length;

  const appendText = (chunk: string, isCdata = false) => {
    if (!chunk) return;
    const target = stack[stack.length - 1];
    target.text += isCdata ? chunk : decodeEntities(chunk);
  };

  while (i < n) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      appendText(input.slice(i));
      break;
    }
    if (lt > i) appendText(input.slice(i, lt));

    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (input.startsWith('<![CDATA[', lt)) {
      const end = input.indexOf(']]>', lt + 9);
      appendText(input.slice(lt + 9, end === -1 ? n : end), true);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (input.startsWith('<!', lt) || input.startsWith('<?', lt)) {
      // DOCTYPE / prolog / processing instruction — skipped, never expanded.
      const end = input.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const gt = findTagEnd(input, lt);
    if (gt === -1) break; // malformed tail — keep what we have
    const raw = input.slice(lt + 1, gt);
    i = gt + 1;
    if (!raw) continue;

    if (raw[0] === '/') {
      // Closing tag: pop to the nearest matching open element (lenient).
      const name = localName(raw.slice(1).trim());
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].name === name) {
          stack.length = s;
          break;
        }
      }
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const el = parseTag(selfClosing ? raw.slice(0, -1) : raw);
    if (++nodes > MAX_NODES) throw new Error('XML document has too many elements.');
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) {
      stack.push(el);
      if (stack.length > MAX_DEPTH) throw new Error('XML document nested too deeply.');
    }
  }

  return root;
}

/** All descendant elements (depth-first) with the given local name. */
export function findAll(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (node: XmlElement) => {
    for (const child of node.children) {
      if (child.name === name) out.push(child);
      walk(child);
    }
  };
  walk(el);
  return out;
}

/** First descendant element (depth-first) with the given local name, or null. */
export function findFirst(el: XmlElement, name: string): XmlElement | null {
  for (const child of el.children) {
    if (child.name === name) return child;
    const nested = findFirst(child, name);
    if (nested) return nested;
  }
  return null;
}

/** First DIRECT child with the given local name, or null. */
export function childFirst(el: XmlElement, name: string): XmlElement | null {
  return el.children.find(c => c.name === name) ?? null;
}
