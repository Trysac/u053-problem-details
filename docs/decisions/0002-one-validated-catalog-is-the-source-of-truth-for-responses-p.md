# One validated catalog is the source of truth for responses, parsing and docs

Status: accepted (generated, pending human review)

## Context

RFC 9457 defines the problem body, but teams also need stable error codes, templated details, a safe default for unexpected exceptions and documentation of the codes. Hand-built bodies drift, leak stack traces and accept hostile input from other services.

## Decision

A frozen ProblemCatalog validates codes, statuses (400-599), an https base URI and at most 1000 entries at definition time. Problems are created only from catalog codes with a single-pass {name} template expansion, and extension members are checked by name and by a depth- and node-limited JSON walk that also deep-copies and freezes values. fromError always returns a generic 500 unless the caller opts into a truncated message, and parseProblem follows section 3.1 by ignoring wrongly typed standard members, dropping prototype-polluting keys and building objects with defineProperty. Markdown documentation is generated from the same catalog. All failures use one ProblemError class with stable codes and short messages.

## Consequences

Responses, client parsing and docs cannot drift apart, and unexpected exceptions cannot leak details by default. The cost is that ad-hoc problem types cannot be created through the catalog, extension values are limited to plain JSON data, and parsing rejects documents above 64 KiB or nested deeper than 32 levels unless the caller raises maxBytes. Framework middleware, i18n, XML and content negotiation stay out of scope.
