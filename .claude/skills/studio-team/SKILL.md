---
name: studio-team
description: Run a piece of Studio work through the team of agents (architect, devs, UI/UX, QA, stakeholder, user stand-ins).
disable-model-invocation: true
---

# The Studio team

Nine agents in `.claude/agents/` build and judge Studio together. Each one owns a question:

| Agent | Owns the question |
| --- | --- |
| `studio-stakeholder` | Is this worth doing now, and is it done? (scope, priority, sign-off) |
| `studio-architect` | Where does it live and how does it fit? (structure, API, risks) |
| `studio-senior-ux` | What is the screen, and does it serve both owners? (flows, layout, words) |
| `studio-junior-ux` | Is every state and word specified? (empty, loading, error, copy, mobile) |
| `studio-senior-dev` | Is it built right? (hard parts, review of every change) |
| `studio-junior-dev` | Build the well-specified parts and their tests. |
| `studio-qa` | Does it work, for everyone, every way? (tests, keyboard, a11y, edges) |
| `user-grammi` | Can I do this without help, and does it feel like mine? |
| `user-mikey` | Can I do this fast, and can I trust what it did? |

## Running a piece of work

Each step ends when its artifact exists; hand each agent the previous artifacts, not a summary of them.

1. **Brief** (`studio-stakeholder`): the outcome in one paragraph, who it's for, what's out of scope, and how we'll know it's done. Done when the brief names a testable finish line.
2. **Shape** (`studio-architect` and `studio-senior-ux`, together): the screens and flows, the API routes used or added, the Zubra UI components, the risks. Done when every screen in the brief has a sketch (ASCII is fine) and every data need maps to a route.
3. **Specify** (`studio-junior-ux`): every state of every screen (first visit, empty, loading, full, error, offline, at 400 px) and every string. Done when there is no state a developer would have to invent.
4. **Check with the users** (`user-grammi`, `user-mikey`, in parallel): each walks the spec as themselves and lists where they would get stuck or slowed. Fold what they find back into steps 2 and 3. Done when neither has a blocker left.
5. **Build** (`studio-senior-dev` splits the work; `studio-junior-dev` takes the well-specified parts): code and tests together, following `studio-architecture`. Done when the tests pass and the senior dev has reviewed every change.
6. **Verify** (`studio-qa`): the full test run, keyboard-only, screen reader names, 320 px, reduced motion, axe, and the edge cases from the spec. Done when every finding is fixed or explicitly accepted by the stakeholder.
7. **Use it** (`user-grammi`, `user-mikey`): each does their real task on the running Studio (screenshots of each step) and says what they would change. Small fixes go back to step 5; bigger ones become the next brief.
8. **Sign off** (`studio-stakeholder`): against the brief's finish line. Done when the stakeholder says ship, with any follow-ups written down.

Two rules hold throughout: the user stand-ins speak only from their own experience (never about code), and any disagreement between them is the stakeholder's call, recorded in the brief.
