# Bengkel Gearbox — bengkelgearbox.my

Marketing website for a CVT & automatic transmission specialist workshop, featuring a
**world-first interactive 3D CVT simulator** visitors can drive, explode and inspect in
the browser.

## Stack
Static site — plain HTML/CSS + ES-module JavaScript, [three.js](https://threejs.org/) via
CDN. No build step, no framework. Deploy anywhere that serves static files.

## Structure
- `index.html` — the landing page (hero, embedded 3D experience, services, why-us, process, FAQ, contact).
- `sim.html` — the interactive CVT simulator (Punch VT2/VT3 physics model; manual drive, exploded/section/wireframe views, webcam hand control).
- `lib/` — simulator modules (CVT parts + visual effects).

## Run locally
```bash
python -m http.server 5190
# open http://localhost:5190/
```

## Deploy (GitHub Pages)
Settings → Pages → Source: `main` / root. Site serves at the Pages URL (and at
`bengkelgearbox.my` once the domain's DNS points to GitHub Pages).

## Before launch
Replace the placeholders in `index.html`: WhatsApp number `60123456789`, phone
`+60 12-345 6789`, and the address/hours marked `data-edit`.
