# E3 Quoter

E3 Quoter is a vinext application for calculating solar and battery quote margins. It uses Cloudflare Workers for the application runtime and D1 for users, settings and saved quotes.

## Requirements

- Node.js `>=22.13.0`
- A Cloudflare account with Workers and D1 enabled

## Local development

```bash
npm ci
npm run dev
```

Local development uses the built-in local administrator identity. D1 data is stored in the project-local Wrangler state directory.

## Cloudflare configuration

`wrangler.jsonc` is the source of truth for the Worker and its bindings:

- Worker: `quoter-helper`
- D1 binding: `DB`
- Assets binding: `ASSETS`
- Images binding: `IMAGES`

The application is publicly accessible by default. Each browser receives a long-lived, HTTP-only visitor cookie so saved quote history and administrator elevation remain separate between visitors. Public visitors always start as standard users and must enter the configured administrator password to manage base data or users.

If Cloudflare Access is enabled later, the application will use `cf-access-authenticated-user-email` as the visitor identity. It also retains the OpenAI Sites identity headers for compatibility with the original hosted version. The first authenticated user becomes an administrator; other users can choose **Administrator access** and enter the configured administrator password.

Store the administrator password as a runtime secret; never commit it to this repository:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Enter the agreed administrator password only when Wrangler prompts for the secret value. In the Cloudflare dashboard, the equivalent location is **Worker → Settings → Variables & Secrets**, with type **Secret**.

## Database and deployment

Apply the committed D1 migrations once before first use:

```bash
npm run db:migrate:remote
```

Then build and deploy:

```bash
npm test
npm run deploy
```

Cloudflare Workers Builds can use:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Production branch: `main`

## Useful commands

- `npm run dev`: start local development
- `npm run build`: produce the Worker build
- `npm test`: build and run rendered output checks
- `npm run db:generate`: generate Drizzle migrations
- `npm run db:migrate:remote`: apply migrations to the configured remote D1 database
- `npm run deploy`: build and deploy the Worker
