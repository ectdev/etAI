# Halcyon runner 5.7 (2026-06-02)

## Added

Warm pool on GCP, matching the one on AWS and Hetzner. Fly is unchanged and remains
without one by design.

## Changed

Provisioning telemetry is now reported per provider rather than as a platform average. The
average had been hiding the Hetzner provisioning latency behind three fast providers.
