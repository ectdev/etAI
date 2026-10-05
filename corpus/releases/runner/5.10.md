# Halcyon runner 5.10 (2026-08-04)

## Added

Backpressure in the agent buffer. Beyond 200 pending steps `emit()` resolves slowly rather
than dropping, which matters for jobs that emit a step per test case.

## Changed

Cache fetch on Fly now streams rather than downloading to disk first, cutting the fixed
cost of a cold cache by roughly a third. The guidance about removing the `cache` block
above 400 MB on Fly still holds; this moves the point at which the trade turns over, it
does not remove it.
