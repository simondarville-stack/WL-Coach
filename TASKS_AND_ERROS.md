#Template
You are fixing a single reported issue in the WL-Coach repo.
Follow CLAUDE.md conventions. Work only on the current branch.

ISSUE: {{body}}
LIKELY AREA: {{area}}
ACCEPTANCE: {{acceptance}}
HARD CONSTRAINTS: Do NOT modify DB schema, migrations, or table
constraints. If the fix requires a schema change, make NO code change
and instead write findings to ./BLOCKED.md explaining what's needed.

Steps: reproduce → fix → run `npm run build` and `tsc --noEmit` -> confirm behaviour with chrome extension
→ stop. Output a 3-line summary of what you changed and why.

#Errors to correct 

* Excercises that holds an interval, should show the same way as when a combi excercise has multiple boxes to control the rep structure. Currently it renders one box with a background. This should not be the case. 

* when clicking around addings sets and reps etc. there is a lot of behaviour where clicks gets reverted or they don't register or register too much. This is the main feature, and should be extremely smooth and responsive. These errors are in the error log.

* The activity feed in the dashboard should show more relevant activties. Clicking the activity should bring you there: a new day logged -> take you to the log. new PR -> take you to the log

#Backlog (do not touch these)

* Have the dashboard have the athletes as cards witht their face on them instead. Be more interactive. Like selecting a football player
* Make it possible for the coaches to create their own rotations and/or evaluations of units. Eg Easy/Medium/Hard