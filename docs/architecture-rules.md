# Backend Architecture Rules

This document defines architecture constraints for long-term maintainability.

## Layering rules

- Controller -> Application Service -> Repository Port -> Prisma Adapter.
- Services must not directly call Prisma for domain persistence where a repository port exists.
- Repository ports live under module `domain/repositories`.
- Prisma adapters live under `src/infrastructure/repositories`.

## Contract and validation rules

- Domain contracts must be explicit JSON fixtures under `src/config`.
- Contract conformance tests must exist for each contracted domain.
- DTO validation covers transport concerns; app-layer validation enforces domain invariants.
- Any JSON payload persisted in DB (`loanPayments`, `customExpenses`, `banks`) must be normalized first.

## Calculator rules

- Financial math belongs in pure domain calculators (`src/modules/**/domain/*calculator.ts`).
- Services orchestrate; calculators compute.
- All calculators require edge-case tests.

## CI and drift gate rules

- CI must run:
  - `npm run monthly-split:check`
  - `npm run prisma:generate`
  - `npm run lint`
  - `npm run test`
  - `npm run build`
- Any contract drift must fail PR checks.

## SOLID mapping

- **SRP**: repository adapters persist, services orchestrate, calculators compute.
- **OCP**: extending a domain adds new adapter/contract implementations without rewriting core flows.
- **LSP**: any adapter implementing a repository port is interchangeable.
- **ISP**: each module exposes narrow repository interfaces.
- **DIP**: services depend on repository abstractions, not Prisma directly.
