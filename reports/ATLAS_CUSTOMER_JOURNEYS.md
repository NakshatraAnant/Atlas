# ATLAS customer journeys and calls to action

12 Nov 2026. A simplification of the visitor and customer experience. The design rests on published guidance, outlined below. CTR is not yet measured; the last section covers how to measure it.

## What the research says (and how strong it is)

- **One goal per page converts better than many.**
  - Unbounce's analysis of about 18,600 landing pages: single-CTA pages converted at 13.5% against 10.5% for pages with five or more links ([Brandrums](https://www.brandrums.com/blog/landing-page-design-tips-convert-visitors-to-leads/), citing Unbounce).
  - The CTA can repeat, if every copy leads to the same goal.
- **Fewer choices, faster decisions (Hick's law).** Decision time grows with the number of options. Prioritise core features; show the rest on demand ([Userpilot](https://userpilot.com/blog/?p=39659)).
- **Progressive disclosure.** Show core features first and advanced ones later, so new users aren't overwhelmed ([Userpilot](https://userpilot.com/blog/progressive-disclosure/)).
- **The first screen matters most.** Attention concentrates above the fold and in the first two screens ([KlientBoost](https://klientboost.com/cro/landing-page-best-practices)).
- **Caveat:** these figures come from vendor and agency summaries, not primary studies, so they set direction rather than promise numbers. ATLAS's own conversion rates have not been measured.

## Before → after

| Area | Before | After |
|---|---|---|
| Header, signed in | 7 controls: Search, plan pill, Notices, Settings, Account, Sign out, Theme | 3: Search, notifications bell with a badge, account menu (plan, Settings, Account, theme, feedback, sign out) |
| Section nav | 10 links in a sideways-scrolling bar | 4 choices: Home · Markets ▾ · Research ▾ · Learn ▾. Menus have one-line descriptions and work by keyboard and on phones |
| Landing | Long headline; three equal buttons (Create account, Sign in, Methodology); two dense lists | One goal, **Start free**, at the top and the bottom. A short headline and sub-line. "No card needed". An animated hero. Three steps, three benefits. Limits folded into "What ATLAS does not do" |
| Sign-up | 3 fields, 6 checkboxes, password rules in the label | 2 fields plus 2 required confirmations. Optional preferences folded away (all off). Show/hide password with a live count. Benefits beside the form. The button enables when the form is complete |
| After sign-up | "Check your email" | The same, plus the 3 next steps |
| First sign-in | Straight to Home (and onboarding built on demo companies, empty on this install) | Onboarding in three short steps: goal, then markets, then one tailored first action |
| Home | 7 panels, greeting paragraph, footer links | One **next-step card** with one primary action, then the first 3 panels. The rest behind "Show N more" (remembered) |
| Academy | (Session 13) journey map, lesson progress, completion → next lesson | Unchanged |

## The journeys

1. **Visitor to account:**
   - Landing ("Start free") → sign-up (email, password, 2 confirmations) → "Check your email" (3 next steps) → verify → onboarding.
   - Every page has one primary action.
2. **First session:**
   - Onboarding asks for a goal (Learn, Keep up, Research) and markets.
   - The final step shows one action matched to the goal: the first lesson, Home, or the Research hub. It also offers one-click follows for the chosen markets.
   - Home then leads with those markets.
3. **Returning visit:**
   - Home's next-step card picks one action:
     - **Learning goal:** continue the recommended lesson.
     - **Research goal:** the Research hub.
     - **No follows yet:** follow a series.
     - **Otherwise:** the next Academy step.
4. **Learning:** course journey map → lesson (progress bar) → quiz → "Lesson complete" → next lesson. This was built earlier in session 13.

## CTA rules applied

- One primary (gold, pill-shaped) action per screen. Secondary actions are plain links.
- Verbs that name the outcome: "Start free", "Choose a series", "Continue", "Start: <lesson>".
- Friction-reducers next to the action: "Free plan · No card needed", "takes a minute".
- The same goal repeats at the end of the landing page; no competing goals.

## Motion

- **Page content:** fades up on load (staggered).
- **Landing:** sections reveal on scroll. The hero lines draw in, with a travelling marker and floating source tags.
- **Interactions:** CTAs have a light sweep and an arrow nudge on hover. Cards lift; menus scale and fade in; the notification badge pops.
- **Onboarding:** step dots animate.
- **Reduced motion:** `prefers-reduced-motion` turns all of it off.

## How to measure CTR (not yet done)

ATLAS has an events endpoint, and browser analytics are opt-in (consent at sign-up, off by default). To measure:
1. Record CTA clicks (landing hero, landing final, sign-up submit, onboarding final action, Home next-step) as events, for consenting users only.
2. Track the funnel: visit → sign-up started → account created → verified → onboarding finished → first follow or lesson.
3. Compare variants of the headline and CTA wording over equal periods. With few visitors, judge on the funnel's absolute numbers, not small percentage differences.

## Verified

Walked in Microsoft Edge at 1280 px and 390 px, with a fresh account each time:
- landing → sign-up (button disabled until complete) → sign-in → onboarding (goal, markets, set up) → Home (next step, 3 panels, "Show 4 more") → Markets menu → account menu.
- **0 console errors, 0 failed requests.**

Two defects were found and fixed along the way:
- On phones, the menus were clipped by an old fade-out mask on the nav bar.
- Follow buttons were invisible while loading.
