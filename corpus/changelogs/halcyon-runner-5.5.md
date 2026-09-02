# Halcyon runner 5.5 (2026-04-21)

## Added

Per step `secrets` declaration. A step receives only the secrets it names, and a step with
no `secrets` key receives none.

Before this every secret was injected into every step, which meant one compromised
published action could read all of them. Existing pipelines keep the old behaviour until
they add the key, and that grace period ends with the 6.0 release.

## Changed

Log masking now covers partial matches above 8 characters.
