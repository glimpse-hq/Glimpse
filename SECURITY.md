# Security Policy

Glimpse is a small project. We take security seriously, but we're not a security team, so if you find something, we'd rather you tell us quietly and give us a bit of time than post it publicly.

## Reporting

**Please don't open a public issue for security bugs.**

- [Report it privately on GitHub](https://github.com/glimpse-hq/Glimpse/security/advisories/new). Only maintainers can see it.
- Or email [hello@tryglimpse.cc](mailto:hello@tryglimpse.cc) with "Security" in the subject.

Tell us what you found, how to reproduce it, and which Glimpse version and OS you're on (Settings → About). A proof of concept is great but not required.

We'll reply within a few days. Fixes go out as a normal release (we don't patch old versions, Glimpse updates itself), and we'll credit you in the release notes unless you'd rather we didn't. There's no bug bounty, sorry.

## What Glimpse touches

So you know where the interesting bits are:

- **It runs locally.** Audio, transcripts, dictionary, and settings live in a SQLite database on your machine. Nothing syncs, and nothing is uploaded unless you set up a cloud provider yourself.
- **It has your microphone and accessibility permissions.** The mic is only live while the pill is armed. Accessibility is used to read the focused text field and paste into it.
- **It stores API keys** for any LLM or speech provider you add. They're encrypted with AES-256-GCM using a key derived from your machine's hardware ID, so a copied database won't decrypt elsewhere.
- **It can run a local HTTP API.** Off by default, binds to `127.0.0.1` when on, and refuses to bind to LAN without an API key.
- **It updates itself.** Release manifests come from GitHub Releases and are signature-checked against the public key in `tauri.conf.json`.
- **Network traffic** with no provider configured is limited to update checks, license validation, model downloads, and anonymous usage analytics you can turn off in Settings.

If any of that turns out not to be true, that's exactly the kind of thing we want to hear about.

## Not really bugs

- Data sent to a provider you configured. That's the feature.
- Anything that needs the attacker already logged in as you with an unlocked machine.
- Scanner output for a dependency with no reachable path in Glimpse. Dependabot and CI already watch those.
- The website or license server. Still email us, we just handle those separately from this repo.

Thanks for looking out for Glimpse users.
