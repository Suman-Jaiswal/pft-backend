# ADR-001: Modular Monolith with NestJS

## Decision

Use NestJS modular monolith with strict module boundaries by domain.

## Rationale

- Clear separation of concerns (controllers/services/domain)
- Built-in DI and guards/interceptors for enterprise workflows
- Easy extraction to microservices later if needed
