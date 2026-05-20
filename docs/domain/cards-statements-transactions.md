# Domain Model

## Card

Master identity and configuration.

- `tenantId + cardKey` unique
- lifecycle status (`ACTIVE`, `INACTIVE`, `CLOSED`)
- optional statement cycle day and credit limit

## Statement

Monthly statement instance for a card.

- unique by `tenantId + cardId + statementMonth`
- contains due date and due totals
- supports payment state transitions

## Transaction

Ledger row for spend events.

- belongs to card
- optional link to statement
- supports optional external dedupe id

## Invariants

- `statementCycleDay` must be 1..31
- statement monetary values are non-negative
- one statement per card per month
