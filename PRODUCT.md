# PRODUCT.md — BrandForge

## Register

**Product.** Design serves the task. Someone works *in* this, they do not read it.

But serving the task is the floor, not the ceiling. An earlier pass took "tool" literally and shipped something that looked unfinished: light on light, no identity, six identical tiles, and grey rectangles during the longest screen. The interface should feel like a product that was actually designed and shipped, while every element still earns its place by serving the judgement the user came to make.

## Users & purpose

A brand or creative-ops person with a brand URL and one product photo. They are at a desk, in office light, and their job on this screen is **judging whether generated campaign images faithfully reproduce a real product**. Two moments matter:

1. **Waiting.** A run takes minutes and spends money. They need to see it is genuinely progressing, at which stage, and on which shot — not a spinner.
2. **Judging.** They compare six generated images against the original photo and decide whether the product survived. Colour and geometry fidelity is the actual decision.

Everything else (settings, prompt authoring, mood boards) is deliberately absent. The intelligence lives in the system, not in the controls.

## Brand personality

Precise · unhurried · accountable.

The product's whole claim is that it *checks its own work* and refuses what it cannot fix. The interface has to look like something that would tell you the truth: it shows blocked shots as prominently as accepted ones, shows QA scores, and never rounds a failure up.

## Anti-references

From the brief, verbatim: **not an n8n demo, not a hackathon dashboard, not an API playground.**

Two more, learned from the first attempt:

- **Not a magazine.** The first version used a display serif for UI labels, fluid clamp headings and a cream body. That is brand-register grammar applied to a tool, and it read as empty rather than considered.
- **Not a terminal.** The obvious over-correction from cream is neon-on-black developer chic. Also wrong: this is a visual-review surface, not a console.
- **Not a dashboard-shaped SaaS clone.** Dark sidebar, rounded card grid, indigo everywhere is the next reflex after those two. The identity here comes from photographic production language (crop marks, frame numbers, contact-sheet rhythm), which is true to the subject rather than borrowed from the category.

## Strategic design principles

1. **The images are the only bright thing.** Chrome is neutral and quiet so nothing biases colour perception in the photography being judged.
2. **Progress is state, never theatre.** Every stage indicator maps to a real server status. No timers pretending to be work.
3. **Failure is first-class.** A blocked shot gets the same layout weight as an accepted one, with the reason attached.
4. **Density where the user is deciding**, space where they are choosing. The intake screen can breathe; the results grid should not.

## Accessibility

Body text ≥4.5:1, focus-visible rings on every interactive, live regions for progress updates, full keyboard path through intake and gallery, and a reduced-motion alternative for every transition.
