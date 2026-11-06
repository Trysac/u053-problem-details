/**
 * RFC 9457 problem details: a typed catalog of stable error codes, leak-safe
 * error mapping, spec-compliant parsing and Markdown documentation.
 *
 * @packageDocumentation
 */

/** Stable machine-readable codes carried by {@link ProblemError}. */
export type ProblemErrorCode =
  | "unknown_code"
  | "missing_param"
  | "invalid_extension"
  | "invalid_catalog"
  | "parse_error"
  | "too_large";

/** An RFC 9457 problem details object (standard members plus extensions). */
export type ProblemDetails = {
  type: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  [extension: string]: unknown;
};

/** One catalog entry: a stable code maps to a status, title and template. */
export type CatalogEntry = {
  status: number;
  title: string;
  detailTemplate?: string;
};

/** Options for {@link defineCatalog}. */
export type CatalogOptions = {
  /** Absolute https URI ending in a slash; problem types are base + code. */
  baseUri: string;
};

/** Optional members for {@link ProblemCatalog.create}. */
export type CreateExtras = {
  instance?: string;
  extensions?: Record<string, unknown>;
};

/** A framework-neutral HTTP response. */
export type ProblemResponse = {
  status: number;
  headers: { "content-type": "application/problem+json" };
  body: string;
};

/** Options for {@link fromError}. */
export type FromErrorOptions = {
  /** Copy the error message (max 200 characters) into `detail`. */
  exposeDetails?: boolean;
};

/** Options for {@link parseProblem}. */
export type ParseOptions = {
  /** Maximum document size in UTF-8 bytes. Defaults to 65_536. */
  maxBytes?: number;
};

const MAX_MESSAGE_LENGTH = 200;
const SNIPPET_LENGTH = 50;
const MAX_ENTRIES = 1000;
const MAX_CODE_LENGTH = 100;
const MAX_TEXT_LENGTH = 2000;
const MAX_URI_LENGTH = 2048;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10_000;
const DEFAULT_MAX_BYTES = 65_536;

const CODE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const EXTENSION_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,}$/;
const PLACEHOLDER = /\{([a-z_][a-z0-9_]*)\}/g;
const STANDARD_MEMBERS: ReadonlySet<string> = new Set([
  "type",
  "title",
  "status",
  "detail",
  "instance",
]);
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** The single error type thrown by this library. */
export class ProblemError extends Error {
  /** Stable machine-readable error code. */
  readonly code: ProblemErrorCode;

  /**
   * @param code - Stable error code.
   * @param message - Human-readable message, truncated to 200 characters.
   */
  constructor(code: ProblemErrorCode, message: string) {
    super(message.slice(0, MAX_MESSAGE_LENGTH));
    this.name = "ProblemError";
    this.code = code;
  }
}

function fail(code: ProblemErrorCode, message: string): never {
  throw new ProblemError(code, message);
}

function snippet(text: string): string {
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}...` : text;
}

function setMember(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
}

function checkExtensionName(name: string): void {
  if (STANDARD_MEMBERS.has(name) || FORBIDDEN_KEYS.has(name) || !EXTENSION_PATTERN.test(name)) {
    fail("invalid_extension", `invalid extension name: ${snippet(name)}`);
  }
}

function cloneValue(
  value: unknown,
  depth: number,
  budget: { left: number },
  name: string,
): unknown {
  budget.left -= 1;
  if (budget.left < 0) {
    fail("invalid_extension", `extension ${snippet(name)} is too large`);
  }
  if (value === null || typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("invalid_extension", `extension ${snippet(name)} is not finite`);
    }
    return value;
  }
  if (typeof value === "object") {
    if (depth >= MAX_JSON_DEPTH) {
      fail("invalid_extension", `extension ${snippet(name)} is too deep`);
    }
    if (Array.isArray(value)) {
      if (value.length > budget.left) {
        fail("invalid_extension", `extension ${snippet(name)} is too large`);
      }
      return Object.freeze(value.map((item) => cloneValue(item, depth + 1, budget, name)));
    }
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      fail("invalid_extension", `extension ${snippet(name)} is not plain`);
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      setMember(
        out,
        key,
        cloneValue((value as Record<string, unknown>)[key], depth + 1, budget, name),
      );
    }
    return Object.freeze(out);
  }
  return fail("invalid_extension", `extension ${snippet(name)} is not JSON-serialisable`);
}

function collectExtensions(source: object, skipStandard: boolean): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  const budget = { left: MAX_JSON_NODES };
  for (const key of Object.keys(source)) {
    if (skipStandard && STANDARD_MEMBERS.has(key)) {
      continue;
    }
    if (skipStandard) {
      if (FORBIDDEN_KEYS.has(key)) {
        fail("invalid_extension", `invalid extension name: ${snippet(key)}`);
      }
    } else {
      checkExtensionName(key);
    }
    out.push([key, cloneValue((source as Record<string, unknown>)[key], 0, budget, key)]);
  }
  return out;
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).hostname;
  } catch {
    return "";
  }
}

function validateBaseUri(baseUri: unknown): string {
  if (
    typeof baseUri !== "string" ||
    baseUri.length > MAX_URI_LENGTH ||
    !baseUri.startsWith("https://") ||
    !baseUri.endsWith("/") ||
    /[\s?#]/.test(baseUri) ||
    hostOf(baseUri) === ""
  ) {
    return fail("invalid_catalog", "baseUri must be an absolute https URI ending in a slash");
  }
  return baseUri;
}

function validateEntry(code: string, entry: unknown): Readonly<CatalogEntry> {
  if (code.length > MAX_CODE_LENGTH || !CODE_PATTERN.test(code)) {
    fail("invalid_catalog", `invalid problem code: ${snippet(code)}`);
  }
  if (typeof entry !== "object" || entry === null) {
    fail("invalid_catalog", `entry ${code} must be an object`);
  }
  const { status, title, detailTemplate } = entry as Record<string, unknown>;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 400 || status > 599) {
    fail("invalid_catalog", `entry ${code} needs an integer status 400-599`);
  }
  if (typeof title !== "string" || title === "" || title.length > MAX_TEXT_LENGTH) {
    fail("invalid_catalog", `entry ${code} needs a title`);
  }
  if (detailTemplate === undefined) {
    return Object.freeze({ status, title });
  }
  if (typeof detailTemplate !== "string" || detailTemplate.length > MAX_TEXT_LENGTH) {
    fail("invalid_catalog", `entry ${code} has an invalid detailTemplate`);
  }
  return Object.freeze({ status, title, detailTemplate });
}

function expand(template: string, params: Record<string, string | number> | undefined): string {
  const source = params ?? {};
  return template.replace(PLACEHOLDER, (_match: string, name: string) => {
    const value = Object.hasOwn(source, name) ? source[name] : undefined;
    if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
      return String(value);
    }
    return fail("missing_param", `missing or invalid template parameter: ${name}`);
  });
}

/** A validated, immutable catalog of problem types. */
export class ProblemCatalog {
  /** Absolute https base URI, always ending in a slash. */
  readonly baseUri: string;
  readonly #entries: ReadonlyMap<string, Readonly<CatalogEntry>>;

  /**
   * Validates and stores the entries. Prefer {@link defineCatalog}.
   *
   * @throws {ProblemError} With code `invalid_catalog` on any violation.
   */
  constructor(entries: Record<string, CatalogEntry>, options: CatalogOptions) {
    if (typeof options !== "object" || options === null) {
      fail("invalid_catalog", "options with a baseUri are required");
    }
    this.baseUri = validateBaseUri(options.baseUri);
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
      fail("invalid_catalog", "entries must be an object");
    }
    const codes = Object.keys(entries);
    if (codes.length > MAX_ENTRIES) {
      fail("invalid_catalog", `a catalog holds at most ${MAX_ENTRIES} entries`);
    }
    const map = new Map<string, Readonly<CatalogEntry>>();
    for (const code of codes) {
      map.set(code, validateEntry(code, entries[code]));
    }
    this.#entries = map;
    Object.freeze(this);
  }

  /** Returns the catalog codes sorted alphabetically. */
  codes(): string[] {
    return [...this.#entries.keys()].sort();
  }

  /**
   * Returns the entry registered for `code`.
   *
   * @throws {ProblemError} With code `unknown_code`.
   */
  describe(code: string): Readonly<CatalogEntry> {
    const entry = this.#entries.get(code);
    if (entry === undefined) {
      return fail("unknown_code", `unknown problem code: ${snippet(String(code))}`);
    }
    return entry;
  }

  /**
   * Builds a frozen problem details object for `code`.
   *
   * @param code - A catalog code.
   * @param params - Values for `{name}` placeholders in the detail template.
   * @param extras - Optional instance URI and extension members.
   * @throws {ProblemError} `unknown_code`, `missing_param` or
   * `invalid_extension`.
   */
  create(
    code: string,
    params?: Record<string, string | number>,
    extras?: CreateExtras,
  ): ProblemDetails {
    const entry = this.describe(code);
    let instance: string | undefined;
    let extensions: Array<[string, unknown]> = [];
    if (extras !== undefined) {
      if (typeof extras !== "object" || extras === null) {
        fail("invalid_extension", "extras must be an object");
      }
      instance = extras.instance;
      if (
        instance !== undefined &&
        (typeof instance !== "string" || instance.length > MAX_URI_LENGTH)
      ) {
        fail("invalid_extension", "instance must be a short string");
      }
      const source = extras.extensions;
      if (source !== undefined) {
        if (typeof source !== "object" || source === null || Array.isArray(source)) {
          fail("invalid_extension", "extensions must be an object");
        }
        extensions = collectExtensions(source, false);
      }
    }
    const problem: ProblemDetails = {
      type: `${this.baseUri}${code}`,
      title: entry.title,
      status: entry.status,
    };
    if (entry.detailTemplate !== undefined) {
      problem.detail = expand(entry.detailTemplate, params);
    }
    if (instance !== undefined) {
      problem.instance = instance;
    }
    for (const [key, value] of extensions) {
      setMember(problem, key, value);
    }
    return Object.freeze(problem);
  }

  /** Like {@link ProblemCatalog.create} but wraps the result in an error. */
  toError(
    code: string,
    params?: Record<string, string | number>,
    extras?: CreateExtras,
  ): HttpProblem {
    return new HttpProblem(this.create(code, params, extras));
  }
}

/**
 * Validates and builds a {@link ProblemCatalog}.
 *
 * @throws {ProblemError} With code `invalid_catalog`.
 */
export function defineCatalog(
  entries: Record<string, CatalogEntry>,
  options: CatalogOptions,
): ProblemCatalog {
  return new ProblemCatalog(entries, options);
}

/** An error carrying a ready-to-send problem details object. */
export class HttpProblem extends Error {
  /** The problem details to send to the client. */
  readonly problem: ProblemDetails;

  /** @param problem - The problem details this error represents. */
  constructor(problem: ProblemDetails) {
    super(
      `${String(problem.status ?? 500)} ${problem.title ?? problem.type}`.slice(
        0,
        MAX_MESSAGE_LENGTH,
      ),
    );
    this.name = "HttpProblem";
    this.problem = problem;
  }
}

function optionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    fail("invalid_extension", `member ${key} must be a string`);
  }
  return value;
}

/**
 * Serialises a problem as an `application/problem+json` response.
 *
 * Members are written in the order type, title, status, detail, instance and
 * then extensions in insertion order. A missing status becomes HTTP 500.
 *
 * @throws {ProblemError} With code `invalid_extension` for malformed members.
 */
export function toResponse(problem: ProblemDetails): ProblemResponse {
  if (typeof problem !== "object" || problem === null || Array.isArray(problem)) {
    fail("invalid_extension", "problem must be an object");
  }
  const source: Record<string, unknown> = problem;
  const body: Record<string, unknown> = {};
  setMember(body, "type", optionalString(source, "type") ?? "about:blank");
  const title = optionalString(source, "title");
  if (title !== undefined) {
    setMember(body, "title", title);
  }
  const status = source.status;
  if (status !== undefined) {
    if (!isHttpStatus(status)) {
      fail("invalid_extension", "status must be an integer 100-599");
    }
    setMember(body, "status", status);
  }
  const detail = optionalString(source, "detail");
  if (detail !== undefined) {
    setMember(body, "detail", detail);
  }
  const instance = optionalString(source, "instance");
  if (instance !== undefined) {
    setMember(body, "instance", instance);
  }
  for (const [key, value] of collectExtensions(source, true)) {
    setMember(body, key, value);
  }
  return {
    status: isHttpStatus(status) ? status : 500,
    headers: { "content-type": "application/problem+json" },
    body: JSON.stringify(body),
  };
}

/**
 * Maps any thrown value to a problem without leaking internals.
 *
 * An {@link HttpProblem} yields its own problem unchanged. Everything else
 * becomes `about:blank` / Internal Server Error / 500. With `exposeDetails`,
 * an `Error` message (max 200 characters) is added as `detail`; the stack and
 * cause are never exposed.
 */
export function fromError(error: unknown, options?: FromErrorOptions): ProblemDetails {
  if (error instanceof HttpProblem) {
    return error.problem;
  }
  const problem: ProblemDetails = {
    type: "about:blank",
    title: "Internal Server Error",
    status: 500,
  };
  if (options?.exposeDetails === true && error instanceof Error && error.message !== "") {
    problem.detail = error.message.slice(0, MAX_MESSAGE_LENGTH);
  }
  return Object.freeze(problem);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return fail("parse_error", "document is not valid JSON");
  }
}

function sanitize(value: unknown, depth: number): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (depth > MAX_JSON_DEPTH) {
    fail("parse_error", "document is nested too deeply");
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (!FORBIDDEN_KEYS.has(key)) {
      setMember(out, key, sanitize((value as Record<string, unknown>)[key], depth + 1));
    }
  }
  return out;
}

/**
 * Parses an untrusted problem details document (RFC 9457 section 3.1).
 *
 * Standard members of the wrong type are ignored rather than rejected, a
 * missing type becomes `about:blank` and the keys `__proto__`, `constructor`
 * and `prototype` are dropped at every level.
 *
 * @throws {ProblemError} `too_large` above `maxBytes` (UTF-8, default 65_536)
 * or `parse_error` for invalid JSON, a non-object root or deep nesting.
 */
export function parseProblem(text: string, options?: ParseOptions): ProblemDetails {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    fail("parse_error", "maxBytes must be a positive integer");
  }
  if (typeof text !== "string") {
    fail("parse_error", "text must be a string");
  }
  if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) {
    fail("too_large", `problem document exceeds ${maxBytes} bytes`);
  }
  const parsed = parseJson(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail("parse_error", "document root must be an object");
  }
  const root = parsed as Record<string, unknown>;
  const result: ProblemDetails = {
    type: typeof root.type === "string" ? root.type : "about:blank",
  };
  if (typeof root.title === "string") {
    result.title = root.title;
  }
  if (isHttpStatus(root.status)) {
    result.status = root.status;
  }
  if (typeof root.detail === "string") {
    result.detail = root.detail;
  }
  if (typeof root.instance === "string") {
    result.instance = root.instance;
  }
  for (const key of Object.keys(root)) {
    if (!STANDARD_MEMBERS.has(key) && !FORBIDDEN_KEYS.has(key)) {
      setMember(result, key, sanitize(root[key], 1));
    }
  }
  return Object.freeze(result);
}

function cell(text: string): string {
  return text
    .replace(/\r?\n|\r/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|");
}

/**
 * Renders the catalog as a Markdown table sorted by code.
 *
 * @throws {ProblemError} With code `invalid_catalog` for a non-catalog.
 */
export function catalogToMarkdown(catalog: ProblemCatalog): string {
  if (!(catalog instanceof ProblemCatalog)) {
    fail("invalid_catalog", "a ProblemCatalog is required");
  }
  const lines = ["| Code | Status | Title | Type |", "| --- | --- | --- | --- |"];
  for (const code of catalog.codes()) {
    const entry = catalog.describe(code);
    lines.push(
      `| ${cell(code)} | ${entry.status} | ${cell(entry.title)} | ${cell(
        `${catalog.baseUri}${code}`,
      )} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
