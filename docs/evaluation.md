# What was measured, and what it said

Every retrieval decision in this project was made against a measurement rather than
against an argument. This file has the measurements, including the ones that
contradicted me.

What the measurements are measuring is described in [retrieval.md](retrieval.md).

## Measuring retrieval

`pnpm eval` runs 79 questions through search and reports what came back: 40 the
collection can answer, 5 it mentions without answering, and 34 that have nothing to do
with it.

The last group is the reason the set is that size. Five questions ship with the
collection, and five numbers are not a distribution. People do not stay on topic: they
paste code, say hello, ask about the weather, try to talk the system out of its
instructions, and ask about things that sound like the subject and are not. Those are
different kinds of out of scope and they do not behave alike.

What the current numbers say, with vector similarity alone and no ranking yet:

| Kind of question        | Nearest result, median | Range            |
| ----------------------- | ---------------------- | ---------------- |
| Answerable              | 0.2413                 | 0.1600 to 0.3304 |
| Mentioned, not answered | 0.2782                 | 0.2554 to 0.3157 |
| Out of scope            | 0.4112                 | 0.3135 to 0.4835 |

Retrieval is built in three steps, and each one is measured against the one before it
with `pnpm eval --compare`:

| Step                                   | recall@5 | first place | MRR   |
| -------------------------------------- | -------- | ----------- | ----- |
| Vector similarity alone                | 29 of 33 | 27          | 0.848 |
| Plus keyword search, fused by rank     | 30 of 33 | 28          | 0.879 |
| Plus what is known about each document | 33 of 33 | 29          | 0.922 |

Those three were measured against 33 answerable questions, which is what the set held at
the time. It holds 40 now and the current figure is **40 of 40 at MRR 0.923**, with 35 of
those 40 in first place. This is the one place that number is stated; everywhere else
points here, because the same figure written in four documents was wrong in three of them.
The table is
left at the numbers the decisions were actually made on rather than restated against a
set that did not exist yet, because rerunning the first two rows today would report what
the old design scores on new questions, which is a different claim.

A change nobody measured against the previous version is a change rather than an
improvement, and the two look identical when the results are plausible either way.

Two things follow from this, and neither was obvious beforehand.

**No single distance separates answerable from unanswerable.** The ranges overlap, and
the three questions causing the overlap are: running an ad campaign,
mobile game monetisation, App Store policy. They sound exactly like this collection and
are not in it. A number cannot tell the difference. So the threshold is set well above
the furthest real question rather than between the groups, at a point where it turns
away 25 of the 34 out of scope questions without ever refusing an answerable one.
Everything else reaches the model, which has the documents in front of it. The
asymmetry is deliberate: an out of scope question reaching the model costs a fraction of
a cent and still gets refused correctly, while a real question refused by arithmetic is
just wrong.

**Partial coverage cannot be a threshold at all.** The ironSource questions land at
0.2554 to 0.3157, inside the answerable range, because the collection does
discuss ironSource: six briefs name it as a target network. It just has no
specification for it. That is a judgement made by reading what came back, not by
comparing a number.

### What this measurement does not tell you

I wrote all 79 questions, which means the distribution is mine and a different set will
sit somewhere slightly different. That is why the threshold is loose
rather than placed at the midpoint the numbers suggest: a boundary calibrated on one
person's questions should not be trusted to a third decimal place on somebody else's.

The set is wider than the questions that ship with the collection, and the
collection says why. `sample_questions.md` notes that its own evaluation uses those
questions "plus a private set in the same style", so a set that only contained the
samples would measure the one thing already known to be tested and nothing else. The
other 74 exist for the questions I will not see.

The set is not fixed either. It started at five and grew every time the measurement
disagreed with something I believed, and some of the questions in it were written to
represent a case a change was about to affect. That cuts both ways and it is worth
stating plainly: the set is a better description of this collection than it was, and the
score it produces is not the score a set written by somebody else would produce. Three of
my own labels turned out to be wrong and the measurement is what caught them, which is
the argument for growing it rather than freezing it.

The three overlapping questions are a real limit rather than a rough edge to be tuned
away. Ad campaigns, mobile game monetisation and App Store policy are adjacent to
everything this collection is about, and nothing in a distance measurement distinguishes
adjacent from inside. Reading the retrieved documents does, which is why the decision is
left there.

Re-run `pnpm eval` after changing the embedding model or its settings. The numbers
belong to the model rather than to the collection, and a new model moves all of them.

## Which model writes the answers

Both providers are supported and the default is Google, so one key runs everything. That
is a convenience argument rather than a quality one, so the two were measured.

`pnpm compare:providers` runs the question set through both. Retrieval is identical
whichever model writes the answer, so `recall@5` cannot separate them and is not
reported here. What can separate them is judgement: reading the retrieved documents and
deciding how much of the question they answer.

Only questions that reach a model are worth running. 54 of the 79 do; the other 25 are
turned away by the distance check before any model is called, so both providers produce
the identical refusal and counting those would inflate agreement with rows that measure
nothing.

| Measure                          | Gemini 3.6 Flash | Claude Sonnet 5 |
| -------------------------------- | ---------------- | --------------- |
| Coverage judged correctly        | 53 of 54         | 53 of 54        |
| Cited nothing it was denied      | 54 of 54         | 54 of 54        |
| Cited something when it answered | 44 of 45         | 43 of 45        |
| Median generation time           | 13041 ms         | 7778 ms         |

Three things come out of this and only one of them is about picking a model.

**The citation gate does not depend on the model.** Both cited nothing they were not
given, on every question. That number is produced by comparing paths against a list rather
than by a model behaving well, so it should not move, and a difference between providers
would have meant the check was not working.

**The two providers now agree on everything except one question.** Both return
`not_documented` for whether ironSource allows runtime network requests, where the
collection names the network and specifies nothing about it. The rule here calls that
`partial`, because a reader is better served by being told the subject exists and the fact
does not. That is a difference of reading rather than an error, and the prompt was written
while looking at one model's output, which is worth knowing when both disagree with it in
the same direction.

**One disagreement was mine.** Both models returned `partial` for a question I had
labelled answerable. The document names who runs the delivery review and says nothing
about what happens to the feedback, so the question asks two things and the collection
answers one. Two independent models disagreeing with a label in the same direction is
worth more than the label. It is now `partial`, which is why the answerable set is 40
rather than 41.

**Gemini is no longer the faster one.** An earlier run had it a second ahead, and the
numbers above have it five seconds behind. That measurement was taken after the model was
asked to mark each claim with its document number, and the instruction makes it write
more; whether that accounts for all of the difference is not something this comparison can
separate from the provider simply being slower on the day.

Gemini stays the default anyway, and the reason was never speed. Embeddings need a Google
key, so one key runs the whole system, and a reviewer who wants to try it needs one free
key rather than two. Judgement is now level at 53 of 54 each, and Gemini is one ahead on
citing something when it answers. If answer latency mattered more than setup, Claude would
be the better choice on these numbers.

**Switching gives up reproducibility.** Answers are generated at temperature 0, because
reading documents and reporting what they say is not a task that benefits from sampling
widely. Claude Sonnet 5 does not accept the setting: the SDK warns and ignores it. The
answers stay grounded, since that comes from the prompt and the citation check rather
than from the temperature, but they stop being repeatable run to run.
