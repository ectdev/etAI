# Halcyon runner 5.9 (2026-07-14)

## Changed

The agent handshake is now lazy. `start()` resolves before registration and the first
`emit()` carries it, so a job that reports nothing never pays for the round trip.

## Deprecated

drift agent v2 reaches end of support with the 6.0 release. It was retired in March and
has been receiving no changes since; this is notice of the support date rather than a new
decision.
