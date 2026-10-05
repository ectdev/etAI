# Halcyon runner 5.4 (2026-03-31)

## Added

`gpu-small` machine size on Hetzner. One GPU with 8 vCPU and 32 GB. This is the only GPU
size on the platform and it exists only on this provider.

## Changed

Validation now rejects a machine size that does not exist on the target provider before
the job is scheduled, and the error names the sizes that do exist. Previously the job was
scheduled and failed on the machine, which cost a queue slot and read as a platform fault.
