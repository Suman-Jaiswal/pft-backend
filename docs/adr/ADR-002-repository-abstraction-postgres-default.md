# ADR-002: Repository Abstraction, Postgres Default

## Decision

Define repository interfaces in domain modules and implement Postgres adapters via Prisma in infrastructure.

## Rationale

- Keeps domain/application decoupled from ORM
- Enables Mongo adapter later without rewriting use cases
- Supports testability with mocked repositories
