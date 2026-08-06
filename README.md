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

The application has five password accounts with fixed roles. Passwords are stored only as PBKDF2 hashes, successful sign-in creates a seven-day server-side session in D1, and the browser receives an HTTP-only session cookie. Repeated failed sign-in attempts are temporarily blocked.

Standard users can view and edit shared team quotes. Administrators can additionally delete quotes, manage base data, and view the fixed account list. Account roles cannot be changed through the application.

To change an account password, generate a new unique salt and PBKDF2-SHA256 hash and update the matching account entry in `lib/server/auth.ts`; never store plaintext passwords in the repository.

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
