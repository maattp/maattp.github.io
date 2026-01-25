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
2. Add to hamburger menu in `/index.html`
3. Add to launcher in `/apps/index.html`

## Local Development

Preview the site locally:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000
