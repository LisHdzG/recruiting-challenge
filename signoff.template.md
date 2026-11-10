# Sign-off — Hernández Guzmán Marian Lisette

> **Write this yourself, without AI assistance.** Spell-check is fine. The whole point of this artifact is the first-person attribution — AI cannot author it authentically.
>
> One line per meaningful commit (skip pure-doc commits if you want). Cover at minimum every commit that touches `src/` or `test/`.

## Authorship declaration

I used AI on this sign-off for the following limited purposes: spelling review. Everything else is mine.

---

## How to fill this in

For each commit, pick the line that matches what actually happened. Mix is expected — a submission that claims "I have read this fully" on every single commit is treated as a calibration failure, not a strength signal. Honest accounting earns more credit than performed thoroughness.

Use one of these line shapes:

- ✅ **`<sha>` — I have read this. I checked <specific things>. I would stake my name on it shipping to a 1.5k-RPS production system tonight.**
- ⚠️ **`<sha>` — I have read most of this. I'm confident on <X> but uncertain on <Y>. I'd want <a code reviewer / a load test / a property-based test> before staking my name on prod.**
- ❌ **`<sha>` — I have NOT fully read this. Claude generated it and I accepted because <specific reason — e.g. "boilerplate scaffolding", "test fixtures I will re-verify before merge"). Risks I accept: <named risks>.**

Be specific about what you actually checked — *"I read it"* without naming what you looked for is worth less than *"I checked the SQL parameterization, the WHERE clause against the IDOR fix in commit X, and ran the integration test against an in-memory DB"*.

---

## Sign-offs

> Add lines below. List by commit SHA (or a short commit-title prefix if you prefer); ordering by time is fine.

- ⚠️ `72a70c1` — I have completely read the files that were modified and basically it is just that the merchant comes only from the key (Authorization: Bearer) and no longer from something the client selects, as well as now getById now carries a validation to know if the id really corresponds or not. However, I would not launch it to production yet since being a change of great impact it needs a review from one or more engineers that help me verify that effectively it did not affect any other relevant or important part of the system
- ⚠️ `f009e0d` — I have completely read the files of this commit and basically now arrays and objects are rejected in query and body, in itself the handler no longer receives the request so everything it reads it has to validate. In the same way as the previous one I would not launch to production until a couple of engineers supported me in reviewing that the solution is the most effective without strong affectations in the system
- ✅ `e3d6161` — I have completely read the files of this commit and basically they were adjustments in the sum of the sales taking into account the refunds, the only thing that would put me a little in doubt about the launch would be that the business rules were defined this time by me however its functioning is correct and we are not impacting negatively
- ✅ `5129a22` — I have completely read this file and I could upload it since it does not affect as such the programming of the code, it is only documentation
- ❌ `f95f1c5` — I have not completely read all the lines of this change since they are quite a lot however I accepted it because the tests passed and I also verified its functioning inside the system and everything works as it should, we reviewed possible affectations or risks and it did not seem risky to me to accept it as such since it is a UI component however something I would like to keep working on is the migrations part since I feel that for this part there could be better solutions
- ✅ `c091f9a` — I have completely read this file and I could upload it since it does not affect as such the programming of the code, it is only documentation
- ✅ `f92d54c` — I have completely read this file and I could upload it since it does not affect as such the programming of the code, it is only documentation for the challenge
- ✅ `4877d98` — I have completely read this file and I could upload it since it does not affect as such the programming of the code, it is only documentation for the challenge
- ✅ `0edf9ce` — I have completely read this file and I could upload it since it does not affect as such the programming of the code, it is only documentation for the challenge


---

## What this artifact measures

The signal is not "did you read every line" — that's not what an architect does. The signal is **whether you can honestly account for what you read, what you trusted, and what you took on faith** — and whether the language you use is first-person ownership ("I accepted") rather than tool-deflection ("Claude wrote it"). The latter is what we score.
