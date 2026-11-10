# Validation design — Hernández Guzmán Marian Lisette

> **Write this yourself, without AI assistance.** Spell-check is fine. AI-drafted validation design is an automatic decline — this artifact measures *your* judgment about how to make AI-augmented code safe to ship, which is the load-bearing architect-tier signal.
>
> ~300 words total. Concrete, named gates only — not philosophy.

## Authorship declaration

I wrote this validation design entirely without AI assistance. The only tool I used was spell-check.

---

## The question

Anyone with a competent AI tool can fix the symptoms in this codebase. What separates an architect is *building the validation layer that catches the class of bug next time* — so the same mistake cannot quietly reach production again.

For each issue class you addressed, name the gate you built (or would build with more time) that prevents the class — not just the instance. "Added a regression test" is the floor; what's the gate?

Forms a gate can take, in rough order of robustness:

- A regression test pointing at the specific bug (floor — always add this, never the whole answer)
- A property-based or fuzz test that asserts an invariant the bug violated
- A golden test / contract test at the API boundary
- A CI rule, lint rule, or pre-merge script that fails on the pattern
- A type-system constraint that makes the bug uncompilable
- An architecture rule or import-restriction that makes the bad shape impossible
- An eval suite that grades AI output against the class of failure

## What to fill in

For each issue *class* you addressed (not each instance — group by class):

### Class 1

- **Instances I fixed:** The Merchant-Id header was accepted without verification: anyone could read the data of any merchant
- **The gate I built (or would build):** 
    The merchant comes only from the API key
    MerchantId is passed to the handler and it throws an error if it fails
    GetById(id, merchantId) requires the id in the request
- **What this gate would catch that a regression test would miss:** 
    Work should be done on a route without auth
- **Where to see the gate in the diff** 
    Claude took care of modifying the files
- **If you did not build it,** 
    n my case I did not build it because I do not fully know the language and structure, however I went with analysis of the code first, confirming that the modified classes are the right ones

### Class 2

- **Instances I fixed:** Client input without validation
- **The gate I built (or would build):** 
    The handler receives ValidatedInput and never req
    A test fails if a file registers a route without validation
- **What this gate would catch that a regression test would miss:** It would also be worth validating the new filtering feature that was added
- **Where to see the gate in the diff** 
    Claude took care of modifying the files
- **If you did not build it,** 
    In my case I did not build it because I do not fully know the language and structure, however I went with analysis of the code first, confirming that the modified classes are the right ones
    
### Class 3

- **Instances I fixed:** Money rules
- **The gate I built (or would build):** 
    A file was created that holds the rules the system in general must follow
- **Where to see the gate in the diff** 
    Claude took care of modifying the files
- **If you did not build it,** 
    In my case I did not build it because I do not fully know the language and structure, however I went with analysis of the code first, confirming that the modified classes are the right ones
    
---

## Anti-patterns we score against

- "Added regression tests" with no class-level gate proposed for any class. The instance is patched; the class is not.
- A gate proposed for every class but none actually built in the diff, with no honest accounting of why.
- Generic prose ("I would invest in observability and CI quality") with no named tool, rule, or invariant.
- A 30-line wall of suggestions that reads like an AI-generated checklist. We expect 1–3 *real* gates designed deliberately, not 10 generic ones.
