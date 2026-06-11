# AGENTS.md — Shiksha Library Website

## Project Architecture

This is a **single-page static website** — everything lives in `index.html` with inline CSS and JavaScript. There is no build pipeline, framework, or server-side logic.

```
/
├── index.html          # Entire website — HTML + inline <style> + inline <script>
├── assets/
│   └── library-poster.png   # Uploaded library interior poster (shown in About section)
├── netlify.toml        # Publish dir config + cache headers
├── README.md
└── AGENTS.md
```

## Key Architecture Decisions

### Why a single HTML file?
The user explicitly requested HTML/CSS/JavaScript only with no backend. A single file is optimal for a static Netlify deploy — zero build step, instant preview.

### Inline CSS (no external stylesheet)
All styles are in a `<style>` block inside `<head>`. CSS custom properties (`--primary`, `--gold`, etc.) keep the design system consistent. Edit variables at the top of the style block to retheme globally.

### Images
- **Hero background**: Unsplash URL (`photo-1481627834876-b7833e8f5570`) — a library photo
- **Gallery strip**: 6 Unsplash study/library photos, duplicated for seamless CSS marquee loop
- **About section**: `assets/library-poster.png` — the owner's actual uploaded poster

### Membership Plans
Plans use a tab toggle (Monthly / 15-Day / 3-Month) powered by vanilla JS `showPlans()`. Each tab has its own `.plans-grid` div with `display:none` toggled to `display:grid` via the `.active` class. Plans show discount stickers (red pill badge) and crossed-out original prices.

## Coding Conventions

- All section IDs match navbar `href` anchors for smooth scroll
- Scroll reveal uses `IntersectionObserver` on `.reveal`, `.reveal-left`, `.reveal-right` classes
- Floating WhatsApp/Call buttons are in `.float-btns` fixed container (bottom-right)
- Color palette lives in `:root` CSS variables — change once to retheme

## Contact Details (hardcoded)
- Phone: `+91 7597474668`
- WhatsApp pre-filled message: URL-encoded in all `wa.me` links
- Address: 1-TA-12, Behind Vigyan Nagar Thana, Dispensary Road, Kota – 324005
- Maps embed uses Google Maps embed URL for the address

## What NOT to Change Without Care
- The `ticker-track` JS-generated items — doubling the array creates a seamless CSS animation loop
- The `particle` animation — uses `translateY` only (no layout-affecting props) for performance
- Font Awesome CDN link — required for all icons throughout the page
