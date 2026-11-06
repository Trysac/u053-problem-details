import { describe, expect, it } from "vitest";
import {
  type CatalogEntry,
  catalogToMarkdown,
  defineCatalog,
  fromError,
  HttpProblem,
  ProblemCatalog,
  ProblemError,
  parseProblem,
  toResponse,
} from "../src/index.js";

const BASE = "https://example.com/probs/";
const GOLDEN =
  '{"type":"https://example.com/probs/out-of-credit","title":"You do not have enough credit.","status":403,"detail":"Your current balance is 30, but that costs 50.","instance":"/account/12345/msgs/abc","balance":30,"accounts":["/account/12345","/account/67890"]}';

const OUT_OF_CREDIT: CatalogEntry = {
  status: 403,
  title: "You do not have enough credit.",
  detailTemplate: "Your current balance is {balance}, but that costs {cost}.",
};

const catalog = defineCatalog(
  {
    "out-of-credit": OUT_OF_CREDIT,
    adjacent: { status: 400, title: "Adjacent", detailTemplate: "{balance}{cost}" },
    spaced: { status: 400, title: "Spaced", detailTemplate: "{ cost }" },
    odd: {
      status: 400,
      title: "Odd",
      detailTemplate: "x {Upper} {1a} {} {a-b}",
    },
    dollar: { status: 400, title: "Dollar", detailTemplate: "{balance}" },
    plain: { status: 404, title: "Not found" },
  },
  { baseUri: BASE },
);

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ProblemError) {
      return error.code;
    }
    throw error;
  }
  return "no-error";
}

function bad(value: unknown): never {
  return value as never;
}

function withKey(name: string, value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.defineProperty(out, name, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return out;
}

function nested(levels: number): unknown {
  let value: unknown = [];
  for (let i = 1; i < levels; i += 1) {
    value = [value];
  }
  return value;
}

function many(count: number): Record<string, CatalogEntry> {
  const entries: Record<string, CatalogEntry> = {};
  for (let i = 0; i < count; i += 1) {
    entries[`c${i}`] = { status: 400, title: "t" };
  }
  return entries;
}

describe("create and toResponse", () => {
  const problem = catalog.create(
    "out-of-credit",
    { balance: 30, cost: 50 },
    {
      instance: "/account/12345/msgs/abc",
      extensions: {
        balance: 30,
        accounts: ["/account/12345", "/account/67890"],
      },
    },
  );

  it("produces the RFC 9457 out-of-credit response byte for byte", () => {
    const response = toResponse(problem);
    expect(response.status).toBe(403);
    expect(response.headers["content-type"]).toBe("application/problem+json");
    expect(response.body).toBe(GOLDEN);
  });

  it("returns a frozen problem with type = baseUri + code", () => {
    expect(problem.type).toBe("https://example.com/probs/out-of-credit");
    expect(Object.isFrozen(problem)).toBe(true);
    expect(Object.isFrozen(problem.accounts)).toBe(true);
  });

  it("does not keep references to caller extension values", () => {
    const accounts = ["a"];
    const made = catalog.create("plain", undefined, {
      extensions: { accounts },
    });
    accounts.push("b");
    expect(made.accounts).toEqual(["a"]);
  });

  it("omits detail when the entry has no template", () => {
    const made = catalog.create("plain");
    expect(Object.keys(made)).toEqual(["type", "title", "status"]);
  });

  it("throws unknown_code for codes that are not in the catalog", () => {
    expect(codeOf(() => catalog.create("nope"))).toBe("unknown_code");
    expect(codeOf(() => catalog.create("constructor"))).toBe("unknown_code");
    expect(codeOf(() => catalog.create("__proto__"))).toBe("unknown_code");
    expect(codeOf(() => catalog.create(bad(42)))).toBe("unknown_code");
  });

  it("never echoes more than 200 characters of input", () => {
    try {
      catalog.create("x".repeat(500));
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message.length).toBeLessThanOrEqual(200);
    }
  });

  it("throws missing_param for absent or invalid parameters", () => {
    expect(codeOf(() => catalog.create("out-of-credit"))).toBe("missing_param");
    expect(codeOf(() => catalog.create("out-of-credit", { balance: 30 }))).toBe("missing_param");
    expect(codeOf(() => catalog.create("out-of-credit", { balance: Number.NaN, cost: 1 }))).toBe(
      "missing_param",
    );
    expect(codeOf(() => catalog.create("out-of-credit", bad({ balance: true, cost: 1 })))).toBe(
      "missing_param",
    );
    expect(codeOf(() => catalog.create("out-of-credit", bad(null)))).toBe("missing_param");
    expect(
      codeOf(() => catalog.create("adjacent", withKey("balance", 1) as Record<string, number>)),
    ).toBe("missing_param");
  });

  it("expands adjacent placeholders and leaves other braces literal", () => {
    expect(catalog.create("adjacent", { balance: 1, cost: 2 }).detail).toBe("12");
    expect(catalog.create("spaced").detail).toBe("{ cost }");
    expect(catalog.create("odd").detail).toBe("x {Upper} {1a} {} {a-b}");
  });

  it("inserts a parameter value of {cost} literally (single pass)", () => {
    const made = catalog.create("adjacent", { balance: "{cost}", cost: "x" });
    expect(made.detail).toBe("{cost}x");
    expect(catalog.create("dollar", { balance: "$&" }).detail).toBe("$&");
  });

  it("ignores inherited parameter names", () => {
    expect(codeOf(() => catalog.create("adjacent", Object.create({ balance: 1 })))).toBe(
      "missing_param",
    );
  });

  it("rejects reserved, short or non-conforming extension names", () => {
    for (const name of [
      "type",
      "title",
      "status",
      "detail",
      "instance",
      "__proto__",
      "constructor",
      "prototype",
      "ab",
      "1abc",
      "a-bc",
    ]) {
      expect(
        codeOf(() =>
          catalog.create("plain", undefined, {
            extensions: withKey(name, 1),
          }),
        ),
      ).toBe("invalid_extension");
    }
  });

  it("rejects values that are not JSON-serialisable", () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    for (const value of [
      () => 1,
      1n,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Symbol("s"),
      new Date(0),
      new Map(),
      cyclic,
      { inner: () => 1 },
      nested(33),
      new Array(10_001).fill(0),
    ]) {
      expect(codeOf(() => catalog.create("plain", undefined, { extensions: { value } }))).toBe(
        "invalid_extension",
      );
    }
  });

  it("accepts nesting up to depth 32 and null-prototype objects", () => {
    const made = catalog.create("plain", undefined, {
      extensions: {
        deep: nested(32),
        bare: Object.assign(Object.create(null), { a: 1 }),
        mixed: { a: { b: [1, "x", null, true] } },
      },
    });
    expect(made.mixed).toEqual({ a: { b: [1, "x", null, true] } });
    expect(made.bare).toEqual({ a: 1 });
  });

  it("validates extras", () => {
    expect(codeOf(() => catalog.create("plain", undefined, bad(null)))).toBe("invalid_extension");
    expect(codeOf(() => catalog.create("plain", undefined, bad({ instance: 5 })))).toBe(
      "invalid_extension",
    );
    expect(codeOf(() => catalog.create("plain", undefined, { instance: "i".repeat(3000) }))).toBe(
      "invalid_extension",
    );
    for (const extensions of [null, [], "x"]) {
      expect(codeOf(() => catalog.create("plain", undefined, bad({ extensions })))).toBe(
        "invalid_extension",
      );
    }
    expect(catalog.create("plain", undefined, {}).status).toBe(404);
  });

  it("toError wraps the problem in an HttpProblem", () => {
    const error = catalog.toError("out-of-credit", { balance: 1, cost: 2 });
    expect(error).toBeInstanceOf(HttpProblem);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("HttpProblem");
    expect(error.message).toContain("403");
    expect(error.problem.detail).toBe("Your current balance is 1, but that costs 2.");
    expect(codeOf(() => catalog.toError("nope"))).toBe("unknown_code");
  });

  it("HttpProblem falls back to the type and status 500 in its message", () => {
    expect(new HttpProblem({ type: "urn:x" }).message).toBe("500 urn:x");
  });

  it("toResponse orders members and falls back to status 500", () => {
    const response = toResponse({
      balance: 1,
      instance: "/i",
      detail: "d",
      title: "T",
      type: "u",
    });
    expect(response.status).toBe(500);
    expect(response.body).toBe('{"type":"u","title":"T","detail":"d","instance":"/i","balance":1}');
    const withStatus = toResponse({ type: "u", status: 404, zeta: 1, alpha: 2 });
    expect(withStatus.status).toBe(404);
    expect(withStatus.body).toBe('{"type":"u","status":404,"zeta":1,"alpha":2}');
  });

  it("toResponse defaults a missing type to about:blank", () => {
    expect(toResponse(bad({})).body).toBe('{"type":"about:blank"}');
  });

  it("toResponse rejects malformed problems", () => {
    expect(codeOf(() => toResponse(bad(null)))).toBe("invalid_extension");
    expect(codeOf(() => toResponse(bad([])))).toBe("invalid_extension");
    expect(codeOf(() => toResponse(bad("x")))).toBe("invalid_extension");
    expect(codeOf(() => toResponse(bad({ type: 1 })))).toBe("invalid_extension");
    expect(codeOf(() => toResponse({ type: "u", status: 99 }))).toBe("invalid_extension");
    expect(codeOf(() => toResponse({ type: "u", status: 600 }))).toBe("invalid_extension");
    expect(codeOf(() => toResponse(bad({ type: "u", title: 1 })))).toBe("invalid_extension");
    expect(codeOf(() => toResponse({ type: "u", fn: bad(() => 1) }))).toBe("invalid_extension");
  });
});

describe("defineCatalog", () => {
  const entry: CatalogEntry = { status: 400, title: "Bad" };

  it("rejects invalid codes, statuses and base URIs", () => {
    expect(codeOf(() => defineCatalog({ Out_Of_Credit: entry }, { baseUri: BASE }))).toBe(
      "invalid_catalog",
    );
    for (const code of ["-a", "a-", "a--b", "1a", "a_b", "", "a".repeat(101)]) {
      expect(codeOf(() => defineCatalog({ [code]: entry }, { baseUri: BASE }))).toBe(
        "invalid_catalog",
      );
    }
    for (const status of [399, 600, 400.5, Number.NaN]) {
      expect(codeOf(() => defineCatalog({ ok: { status, title: "t" } }, { baseUri: BASE }))).toBe(
        "invalid_catalog",
      );
    }
    for (const baseUri of [
      "http://example.com/probs/",
      "https://example.com/probs",
      "https:///",
      "https://example.com/a b/",
      "https://example.com/?a=1/",
      "https://example.com/#f/",
      "/probs/",
      "",
      `https://example.com/${"a".repeat(3000)}/`,
      bad(undefined),
    ]) {
      expect(codeOf(() => defineCatalog({ ok: entry }, { baseUri }))).toBe("invalid_catalog");
    }
  });

  it("rejects malformed entries and options", () => {
    expect(codeOf(() => defineCatalog({ ok: bad(null) }, { baseUri: BASE }))).toBe(
      "invalid_catalog",
    );
    expect(codeOf(() => defineCatalog({ ok: { status: 400, title: "" } }, { baseUri: BASE }))).toBe(
      "invalid_catalog",
    );
    expect(
      codeOf(() =>
        defineCatalog({ ok: { status: 400, title: "t".repeat(2001) } }, { baseUri: BASE }),
      ),
    ).toBe("invalid_catalog");
    expect(
      codeOf(() =>
        defineCatalog(
          { ok: { status: 400, title: "t", detailTemplate: bad(5) } },
          { baseUri: BASE },
        ),
      ),
    ).toBe("invalid_catalog");
    expect(codeOf(() => defineCatalog(bad([]), { baseUri: BASE }))).toBe("invalid_catalog");
    expect(codeOf(() => defineCatalog(bad(null), { baseUri: BASE }))).toBe("invalid_catalog");
    expect(codeOf(() => defineCatalog({ ok: entry }, bad(undefined)))).toBe("invalid_catalog");
  });

  it("allows 1000 entries but rejects 1001", () => {
    expect(defineCatalog(many(1000), { baseUri: BASE }).codes()).toHaveLength(1000);
    expect(codeOf(() => defineCatalog(many(1001), { baseUri: BASE }))).toBe("invalid_catalog");
  });

  it("accepts the status bounds and returns sorted codes", () => {
    const made = defineCatalog(
      {
        b: { status: 400, title: "b" },
        a: { status: 599, title: "a" },
        c: { status: 500, title: "c" },
      },
      { baseUri: BASE },
    );
    expect(made).toBeInstanceOf(ProblemCatalog);
    expect(made.codes()).toEqual(["a", "b", "c"]);
    expect(made.baseUri).toBe(BASE);
    expect(made.describe("a")).toEqual({ status: 599, title: "a" });
    expect(codeOf(() => made.describe("z"))).toBe("unknown_code");
  });

  it("is not affected by later mutation of the input", () => {
    const input: Record<string, CatalogEntry> = { a: { status: 400, title: "a" } };
    const made = defineCatalog(input, { baseUri: BASE });
    input.b = { status: 400, title: "b" };
    const first = input.a as CatalogEntry;
    first.title = "changed";
    expect(made.codes()).toEqual(["a"]);
    expect(made.describe("a").title).toBe("a");
  });
});

describe("fromError", () => {
  const expected = {
    type: "about:blank",
    title: "Internal Server Error",
    status: 500,
  };

  it("never leaks the input", () => {
    expect(fromError(new Error("secret message"))).toEqual(expected);
    expect(fromError("secret message")).toEqual(expected);
    expect(
      fromError({
        toJSON() {
          return "secret message";
        },
      }),
    ).toEqual(expected);
    expect(fromError(undefined)).toEqual(expected);
    expect(Object.isFrozen(fromError(null))).toBe(true);
  });

  it("exposes only a truncated message on request", () => {
    const error = new Error("y".repeat(300), { cause: new Error("inner") });
    const problem = fromError(error, { exposeDetails: true });
    expect(problem.detail).toBe("y".repeat(200));
    expect(Object.keys(problem)).toEqual(["type", "title", "status", "detail"]);
    expect(JSON.stringify(problem)).not.toContain("inner");
    expect(fromError("text", { exposeDetails: true })).toEqual(expected);
    expect(fromError(new Error(""), { exposeDetails: true })).toEqual(expected);
    expect(fromError(new Error("m"), { exposeDetails: false })).toEqual(expected);
  });

  it("returns the problem of an HttpProblem unchanged", () => {
    const error = catalog.toError("plain");
    expect(fromError(error)).toBe(error.problem);
    expect(toResponse(fromError(new Error("x"))).body).toBe(
      '{"type":"about:blank","title":"Internal Server Error","status":500}',
    );
  });
});

describe("parseProblem", () => {
  it("ignores standard members of the wrong type", () => {
    expect(parseProblem('{"status":"500","title":7}')).toEqual({
      type: "about:blank",
    });
    expect(parseProblem('{"type":5,"detail":[],"instance":{},"title":null}')).toEqual({
      type: "about:blank",
    });
  });

  it("keeps valid statuses and drops invalid ones", () => {
    expect(parseProblem('{"type":"x","status":403}')).toEqual({
      type: "x",
      status: 403,
    });
    expect(parseProblem('{"status":1e3}')).toEqual({ type: "about:blank" });
    for (const status of ["99", "600", "1.5", "-1", "null", "true"]) {
      expect(parseProblem(`{"status":${status}}`).status).toBeUndefined();
    }
    expect(parseProblem('{"status":100}').status).toBe(100);
    expect(parseProblem('{"status":599}').status).toBe(599);
  });

  it("keeps valid members and extensions in order", () => {
    const parsed = parseProblem(
      '{"balance":30,"instance":"/i","detail":"d","title":"T","type":"u","status":404}',
    );
    expect(Object.keys(parsed)).toEqual([
      "type",
      "title",
      "status",
      "detail",
      "instance",
      "balance",
    ]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parseProblem(GOLDEN).accounts).toEqual(["/account/12345", "/account/67890"]);
  });

  it("rejects non-object roots, bad JSON and a leading BOM", () => {
    for (const text of ["[]", "null", '"x"', "1", "not json", "", "\uFEFF{}"]) {
      expect(codeOf(() => parseProblem(text))).toBe("parse_error");
    }
    expect(codeOf(() => parseProblem(bad(5)))).toBe("parse_error");
  });

  it("'[]' and a text with a leading BOM throw code 'parse_error'", () => {
    expect(codeOf(() => parseProblem("[]"))).toBe("parse_error");
    expect(codeOf(() => parseProblem("﻿{}"))).toBe("parse_error");
  });

  it("acceptance fragments: create('nope') throw ProblemError code 'unknown_code'; 65_537 bytes throws code 'too_large'", () => {
    expect(codeOf(() => catalog.create("nope"))).toBe("unknown_code");
    expect(codeOf(() => parseProblem("x".repeat(65_537)))).toBe("too_large");
  });

  it("65_537 bytes throws code 'too_large'", () => {
    expect(codeOf(() => parseProblem("x".repeat(65_537)))).toBe("too_large");
  });

  it("create('nope') throws ProblemError code 'unknown_code'", () => {
    expect(codeOf(() => catalog.create("nope"))).toBe("unknown_code");
  });

  it("enforces maxBytes in UTF-8 bytes", () => {
    expect(codeOf(() => parseProblem("x".repeat(65_537)))).toBe("too_large");
    expect(codeOf(() => parseProblem("\u20AC".repeat(30_000)))).toBe("too_large");
    const head = '{"pad":"';
    const tail = '"}';
    const pad = "a".repeat(65_536 - head.length - tail.length);
    expect(parseProblem(`${head}${pad}${tail}`).type).toBe("about:blank");
    expect(codeOf(() => parseProblem("{}", { maxBytes: 1 }))).toBe("too_large");
    expect(parseProblem("{}", { maxBytes: 2 }).type).toBe("about:blank");
    expect(codeOf(() => parseProblem("{}", { maxBytes: 0 }))).toBe("parse_error");
    expect(codeOf(() => parseProblem("{}", { maxBytes: 1.5 }))).toBe("parse_error");
  });

  it("does not pollute prototypes and drops dangerous keys", () => {
    const parsed = parseProblem('{"__proto__":{"x":1}}');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect((parsed as Record<string, unknown>).x).toBeUndefined();
    expect(Object.keys(parsed)).toEqual(["type"]);
    const more = parseProblem(
      '{"type":"x","constructor":1,"prototype":2,"a":{"__proto__":{"y":1},"b":2}}',
    );
    expect(Object.keys(more)).toEqual(["type", "a"]);
    expect(more.a).toEqual({ b: 2 });
    expect(({} as Record<string, unknown>).y).toBeUndefined();
  });

  it("limits nesting depth", () => {
    const ok = `{"a":${"[".repeat(32)}${"]".repeat(32)}}`;
    const tooDeep = `{"a":${"[".repeat(40)}${"]".repeat(40)}}`;
    expect(parseProblem(ok).a).toBeDefined();
    expect(codeOf(() => parseProblem(tooDeep))).toBe("parse_error");
  });

  it("does not echo the input in error messages", () => {
    try {
      parseProblem("{".repeat(100));
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message.length).toBeLessThanOrEqual(200);
      expect((error as Error).message).not.toContain("{{");
    }
  });
});

describe("round trip", () => {
  it("re-serialises a parsed problem with short extension names", () => {
    const parsed = parseProblem('{"type":"x","a":1}');
    expect(toResponse(parsed).body).toBe('{"type":"x","a":1}');
  });
});

describe("catalogToMarkdown", () => {
  it("renders a byte-exact golden table sorted by code", () => {
    const made = defineCatalog(
      {
        pipe: { status: 400, title: "a|b" },
        "out-of-credit": OUT_OF_CREDIT,
        alpha: { status: 404, title: "Not found" },
      },
      { baseUri: BASE },
    );
    const expected = [
      "| Code | Status | Title | Type |",
      "| --- | --- | --- | --- |",
      "| alpha | 404 | Not found | https://example.com/probs/alpha |",
      "| out-of-credit | 403 | You do not have enough credit. | https://example.com/probs/out-of-credit |",
      "| pipe | 400 | a\\|b | https://example.com/probs/pipe |",
      "",
    ].join("\n");
    expect(catalogToMarkdown(made)).toBe(expected);
  });

  it("escapes backslashes and flattens newlines", () => {
    const made = defineCatalog({ a: { status: 400, title: "a\\b\nc" } }, { baseUri: BASE });
    expect(catalogToMarkdown(made)).toContain("| a | 400 | a\\\\b c |");
  });

  it("rejects values that are not catalogs", () => {
    expect(codeOf(() => catalogToMarkdown(bad({})))).toBe("invalid_catalog");
  });
});

describe("ProblemError", () => {
  it("carries a stable code and truncates long messages", () => {
    const error = new ProblemError("parse_error", "m".repeat(500));
    expect(error.code).toBe("parse_error");
    expect(error.name).toBe("ProblemError");
    expect(error.message).toHaveLength(200);
    expect(error).toBeInstanceOf(Error);
  });
});
