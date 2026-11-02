# Publishing workflow notes

- GitHub Actions is the build system for Netlify production deploys.
- Netlify project builds must remain stopped; CLI/API deploys continue to work while builds are stopped.
- `dist/` is generated output and is not committed to `main`.
- Daily publication does not require exact-to-the-minute timing; the first daily run after a post's date publishes it.
