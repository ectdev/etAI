# Secrets in pipelines

How a pipeline gets credentials, and what it is not allowed to do with them.

## Where secrets live

Secrets are stored per customer, encrypted at rest, and injected as environment variables
into the steps that declare them. They are never written to the pipeline definition, never
committed, and never returned by the API once set. Setting a secret is a write only
operation: it can be replaced and deleted, and it cannot be read back.

## Declaring what a step needs

A step names the secrets it needs and receives only those.

```yaml
steps:
  - run: ./deploy.sh
    secrets: [DEPLOY_KEY]
```

A step with no `secrets` key receives none. This is the rule that matters most in this
document, because the alternative, injecting every secret into every step, is what every
pipeline did before schema v2 and it means one compromised action reads everything.

## Agent tokens

The `HALCYON_TOKEN` a job carries is scoped by the agent, not by the platform. drift v3
accepts a `scope` argument and refuses a token broader than the scope asked for. The v2
agent has no equivalent, which is one of the three reasons it was retired.

## Masking

Any value that matches a stored secret is replaced with `***` in logs, including partial
matches above 8 characters. Masking is best effort and is not a control: a step that base64
encodes a secret before printing it will print it. The control is that the step should not
have had the secret.

## Rotation

Secrets are rotated by the customer. We do not expire them, we do not warn on age, and we
have turned down building either twice. An expiry we enforce would break pipelines at
three in the morning for a policy that is the customer's to set.

## What is never allowed

No secret may be passed as a command line argument, because arguments are visible in the
process table to anything else running in the job. No secret may be written to the cache.
Both are checked by the release checklist rather than by the platform, which is a gap and
is recorded as one.
