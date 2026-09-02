# Postmortem: secret printed in logs, May 2026

Date: 2026-05-08. Severity 2. One customer affected.

## What happened

A customer's deploy key appeared in a job log in plain text, and stayed readable for four
days before they reported it.

## Cause

The step base64 encoded the key before printing it as part of a debugging line the customer
had added. Masking compares log output against stored secret values and the encoded form
matched nothing.

This is the documented behaviour. The secrets document says masking is best effort and not
a control, and says the control is that the step should not have had the secret. It was
correct and it did not help.

## Detection

The customer found it. We have no detection for this and adding one means detecting
arbitrary encodings of a secret, which is not a thing that can be done.

## Fix

Nothing in the masker. The key was rotated by the customer within an hour of the report.

## What we changed

Per step `secrets` shipped in 5.5, six weeks after this. It was already planned and this
moved it forward. The step in question declared no secrets it needed and would not have
received the key at all.

## What we did not fix

Masking is unchanged and will stay best effort. Presenting it as a control is the actual
risk here, so the secrets document now says so in its first paragraph rather than its last.
