# What was measured, and what it said

Every retrieval decision in this project was made against a measurement rather than
against an argument. This file has the measurements, including the ones that contradicted
me.

What the measurements are measuring is described in [retrieval.md](retrieval.md).

Every number here was produced on 2026-09-02 against the collection in `corpus/`, with
`gemini-embedding-2` at 1536 dimensions. Re-run `pnpm eval` after changing the embedding
model or its settings: the numbers belong to the model as much as to the collection, and a
new model moves all of them.

## Measuring retrieval

`pnpm eval` runs 106 questions through search and reports what came back: 67 the
collection can answer, 5 it mentions without answering, and 34 that have nothing to do
with it.

The last group is the reason the set is that size. People do not stay on topic: they paste
code, say hello, ask about the weather, try to talk the system out of its instructions, and
ask about things that sound like the subject and are not. Those are different kinds of out
of scope and they do not behave alike, and a threshold set without them is set on the easy
half of the problem.

Retrieval is built in three steps, and each one is measured against the one before it with
`pnpm eval --compare`:

| Step                                   | recall@5 | first place | MRR   |
| -------------------------------------- | -------- | ----------- | ----- |
| Vector similarity alone                | 64 of 67 | 58          | 0.904 |
| Plus keyword search, fused by rank     | 65 of 67 | 59          | 0.919 |
| Plus what is known about each document | 66 of 67 | 58          | 0.918 |

A change nobody measured against the previous version is a change rather than an
improvement, and the two look identical when the results are plausible either way.

Read the rows by which questions move, not by the totals, because the totals hide a trade.

**Keyword search buys two questions that have an exact word in them.** Vector similarity
alone missed "What has the platform been asked for and turned down?" and "Can I set my own
cache key?". The first returns the meeting notes, which are full of things being turned
down, instead of the overview section that lists them. The second returns the build cache
document, which explains how keys are derived, instead of the naming conventions page that
says plainly that you cannot write one. Both questions contain wording that appears
verbatim in the document that answers them, and that is what the keyword half is for.

**Ranking buys a question back that fusing lost.** With both searches fused and no
metadata pass, "How does a step end up with only the secrets it needs?" comes back as
three platform sync meeting notes. The notes discuss secrets repeatedly and briefly; the
policy document answers the question. The per type quota is what stops one template
written type from taking every slot, and this is the question that shows it working.

**And it costs a fraction of a place.** Fused with no ranking puts 59 questions first;
with ranking it is 58, and MRR moves from 0.919 to 0.918. The metadata pass moves a
document into the top five that was not there and pushes another off first place to do it.
On this collection that trade is worth taking, because a document outside the top five is
not in the answer at all while a document at rank two still is. It is a trade rather than a
free improvement, and reporting only the recall column would hide that.

### The one question none of the three retrieves

"What has to be true about artifact size, job duration and machine size before a pipeline
runs?" expects `release-checklist.md`, which has a section listing exactly those three
checks. All three strategies return the provider specifications instead: GCP first, then
the schema, then AWS.

The label is being kept and the miss reported rather than tuned away. A reader asking that
question is served reasonably well by a provider specification, which carries all three
numbers for one provider. But the question is about what has to be true before a run
rather than about the limits themselves, and the checklist is the document that answers it
in that form. The retrieval is defensible and the expectation is defensible, and that is
what makes it worth leaving in the set: it is the one question where the collection's
procedural document loses to the documents holding the raw numbers, and it will notice if
that changes.

### Distance, and why it cannot be a threshold on its own

| Kind of question        | Nearest result, median | Range            |
| ----------------------- | ---------------------- | ---------------- |
| Answerable              | 0.2562                 | 0.1738 to 0.3828 |
| Mentioned, not answered | 0.2639                 | 0.2413 to 0.3022 |
| Out of scope            | 0.4227                 | 0.2942 to 1.0000 |

Two things follow, and neither was obvious beforehand.

**No single distance separates answerable from unanswerable.** The answerable range runs
to 0.3828 and the out of scope range starts at 0.2942, so they overlap across a wide band.
The questions causing the overlap are the ones about continuous integration that are not
about this platform: writing a GitHub Actions workflow, the Jenkins agent directive,
Docker BuildKit cache mounts, Kubernetes Jobs, a self hosted GitLab runner. They are the
same subject as the collection and are not in it, and no number distinguishes adjacent
from inside.

So the threshold is set well above the furthest real question rather than between the
groups. At the configured limit of 0.4 it turns away 24 of the 34 out of scope questions
and refuses none of the 67 answerable ones. Everything else reaches the model, which has
the documents in front of it. The asymmetry is deliberate: an out of scope question
reaching the model costs a fraction of a cent and still gets refused correctly, while a
real question refused by arithmetic is simply wrong.

**Partial coverage cannot be a threshold at all.** The Azure questions land between 0.2413
and 0.3022, which is inside the answerable range and closer than the median answerable
question. That is correct behaviour: six customer briefs name Azure as somewhere the
customer already runs, so there is real, relevant text to find. There is no specification
for running on it. Distance cannot express the difference between "this collection
discusses your subject" and "this collection answers your question", and the judgement is
made by reading what came back.

### What this measurement does not tell you

I wrote all 106 questions, so the distribution is mine and a different set will sit
somewhere slightly different. That is the reason the threshold is loose rather than placed
at the midpoint the numbers suggest: a boundary calibrated on one person's questions should
not be trusted to a third decimal place on somebody else's.

The set is not fixed either. Questions were added for cases a change was about to affect,
which cuts both ways and is worth stating plainly: the set is a better description of this
collection than a smaller one would be, and the score it produces is not the score a set
written by somebody else would produce.

The five hardest refusals are a real limit rather than a rough edge to be tuned away.
GitHub Actions, Jenkins, BuildKit, Kubernetes and GitLab runners are adjacent to everything
this collection is about, and nothing in a distance measurement distinguishes adjacent from
inside. Reading the retrieved documents does, which is why the decision is left there.

## What has not been measured against this collection

Two measurements in this repository have not been run here, and both are blocked on the
same thing rather than on a decision.

**The ranking sweep, `pnpm eval --sweep`.** The constants in `retrieval/rank.ts` carry a
note saying they were arrived at on a collection of the same shape and have not been
re-swept against this one. Until that run happens they are inherited values, and the
comments say so rather than implying a measurement that did not happen here. The sweep now
embeds each question once for the whole run rather than once per setting, which brings it
from 1272 embedding calls to 106 and inside what a free key allows in a day.

**The provider comparison, `pnpm compare:providers`.** It needs an `ANTHROPIC_API_KEY`,
and every figure it would produce belongs to a run against this corpus that has not
happened. Rather than carry a table measured somewhere else, there is no table. What can be
said without measuring is the part that is structural: embeddings must come from Google
because the Anthropic API has no embeddings endpoint, so Google is the default and one key
runs the whole system. Answers are generated at temperature 0, and Claude Sonnet 5 does not
accept that setting, so switching gives up run to run repeatability. Whether it gives up
anything else here is not known, and this document will not guess.

Both commands are in `package.json` and both run against a working key. When they do, their
output belongs in this file with the date it was produced, the way every other number here
carries one.
