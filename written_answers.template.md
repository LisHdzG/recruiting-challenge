# Written answers — <your name>

> **Write this yourself, without AI assistance.** Spell-check is fine. AI-drafted, AI-rewritten, or AI-polished written answers are an automatic decline — these questions exist specifically to measure how *you* think, write, and tell stories about your own past work.
>
> ~200 words per question. Past-tense, real systems. See `SUBMISSION.md`.

## Authorship declaration

I wrote these answers entirely without AI assistance. The only tool I used was spell-check.

---

## Q1 — Production correctness validation

> Describe a system you owned where you had to add production correctness validation — alarms, contract tests, golden datasets, something that caught a class of bugs before users did. What did you do, what worked, what didn't, and what would you do differently?

At the last company I was at, I worked on the Yelp system. My team was focused on the services area and each one led a different project, leading their own team. In my case, I got the integration of the first AI assistant inside the application, where the user could tell it what need they had in the services area and even upload images, and it was able to recognize, understand and match them with the right services.

To validate how it worked, we had to integrate various analytics and flags, both to turn the feature on and off according to the metrics we were receiving vs. the system that was there before, which was a survey to the user. So if we saw that the metrics were going down, then it was time to turn off the flag and analyze where the users were getting stuck. With the analytics team this was easy to track, and in a second release we ended up integrating the project efficiently.

What would I change? Maybe the integration into testing, which was so rushed that there were several production cases that we couldn't fully visualize.


## Q2 — Scaling-forced structural change

> Describe a system you've worked on where scaling — traffic, data volume, team size, or geography — forced a structural change to the code or architecture. What changed, who pushed back, and how did you decide?

I was working for some time inside the company BBVA a few years ago. Inside it we handled two native systems for the application, both Android and iOS. However, at some point there was a push to make it similar to the application that the same bank has in Spain, but that application used its own hybrid system, so we got into a discussion about the migration with the team to know if it was viable to make such a change. However, the tech team was against it, since the application had a very good relationship with the client and in terms of failures they were not that big. There were talks and we spoke about the pros and cons, and despite that, in the end the decision came from a level higher up, which then caused the complete migration of the system, gradually.



## Q3 — A time you rejected AI output (or accepted bad output and changed your process)

> Describe a specific moment in real work where you rejected AI output that you initially thought was correct, **or** accepted AI output that turned out to be wrong. Be concrete: what was the task, what was the output, what was the signal that flipped your judgment, and what did you do next? If the answer is "I accepted it and it shipped a bug," what did you change about your process so the class of mistake doesn't recur?

Inside the project I mentioned with Yelp, there was a moment within the image recognition that I was leading that went out to production with a bug from the AI. This happened mainly because at that moment we had a P0 to attend to but also a timeline with that delivery, so the time was very short, and the mistake was releasing without fully analyzing what the AI was suggesting to me, which basically hit some other teams. Luckily not in a critical way, but it was an impact that was not serious at all. And it was basically a patch from looking for a quick and simple solution. So that this wouldn't happen again, I focused on constant communication, also about my own timelines, on being realistic and not overloading myself so I could also do things with detail and with understanding, and not just push things to solve problems.



