# ADR-003: DTO Validation + OpenAPI + Zod

## Decision

- Use class-validator DTOs for transport-level validation.
- Use Zod in application/use-case boundary for strict command parsing.
- Generate OpenAPI docs with `@nestjs/swagger`.

## Rationale

- Defensive validation at both transport and business boundary
- Clear API contracts for frontend and external clients
- Better maintainability for evolving request models
