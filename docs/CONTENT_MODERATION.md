# Content moderation stance — AI-generated environments

## The honest situation

Genesis's "Create a world" feature sends your text prompt directly to
Pollinations.ai's public image API and displays whatever comes back.
Genesis does not run its own moderation layer on top of it — there is
no server in this path to moderate on (see `js/app.js`'s Pollinations
call and `docs/ARCHITECTURE.md`). Pollinations is unmoderated at the
API level, so a malicious prompt can produce harmful output, and that
risk is real, not hypothetical.

## What Genesis does today

- The in-app disclosure (`environments.html`) tells users their prompt
  goes to a third party and isn't moderated on Genesis's end, so they
  don't mistake it for a vetted, first-party feature.
- Generated images are used locally as a background — they are not
  published, shared, or stored anywhere by Genesis unless the user
  explicitly saves them via cloud sync.

## What this stance does NOT cover yet

**[PLACEHOLDER — decide before onboarding real users:]**
- How do you want to handle a report that someone generated harmful
  content? (e.g. an abuse-report email address, a manual review process)
- Do you want a client-side prompt filter (blocklist of obvious terms)
  as a first line of defense, even though it can't be comprehensive?
- If cloud sync (Supabase Storage) is enabled, generated images a user
  chooses to save become stored content under your control — decide
  whether you want any review step before/after that save.
- At what point (user count, funding) does self-hosting a moderated
  image model become worth the cost, replacing Pollinations?

This file should be revisited before Phase 6/7 cloud accounts and
payments go live — moderation stakes are much higher once generated
content can be stored and shared, not just displayed locally.
