# CLAUDE.md

## Site Structure

Static personal site with a collection of self-contained web utilities.

```
/index.html              - Main site (resume/portfolio)
/apps/index.html         - Launcher (iOS home screen app)
/apps/[name]/index.html  - Individual utilities
```

Each utility is a single self-contained `index.html` file (HTML + CSS + JS inline).

All apps live under `/apps/` so iOS standalone web apps can navigate between them without showing Safari UI (iOS treats same-path navigation as staying within the app).

When adding a new utility:
1. Create `/apps/[name]/index.html`
2. Add to launcher in `/apps/index.html`

## iOS PWA Patterns

All apps are designed to run as full-screen iOS Progressive Web Apps. Use these patterns:

### Required Meta Tags

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#1a1a2e">
```

- `viewport-fit=cover` extends content behind the notch/status bar
- `apple-mobile-web-app-capable` enables full-screen standalone mode
- `black-translucent` makes the status bar overlay the content with a translucent background
- `theme-color` sets the status bar background color

### Safe Area Handling

Use CSS environment variables to handle notch and home indicator areas:

```css
padding-top: env(safe-area-inset-top);
padding-bottom: env(safe-area-inset-bottom);
padding-left: env(safe-area-inset-left);
padding-right: env(safe-area-inset-right);

/* Or combine with other values */
padding-top: calc(env(safe-area-inset-top) + 20px);
```

### iOS-Specific CSS

```css
-webkit-overflow-scrolling: touch;  /* Smooth momentum scrolling */
-webkit-tap-highlight-color: transparent;  /* Remove tap highlight */
```

## Local Development

Preview the site locally:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000
