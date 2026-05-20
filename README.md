# TTB Label Verifier

Browser-based prototype for reviewing alcohol label images against imported application facts.

## What it does

- Upload single images or batch packets
- Store session state locally in the browser
- Compare application JSON against reviewed label output
- Export a reusable ZIP packet with `manifest.json` and images
- Keep the workflow lightweight enough for local use or a Vercel deployment

## Stack

- Next.js 16
- React 19
- TypeScript
- OpenAI Responses API

## Setup

1. Install dependencies:

```bash
npm install
```

2. Run the app locally:

```bash
npm run dev
```

3. Open:

```text
http://localhost:3100
```

## How it works

- The browser stores your queue, review state, and API key locally.
- Labels are compressed in the browser before review to keep scans faster.
- If you import batch JSON or a ZIP packet, the application facts appear alongside the label review.
- Reviewed output can be exported back into a fresh batch packet.

## Deployment to Vercel

1. Push the repo to GitHub.
2. Import the repository into Vercel.
3. Let Vercel detect the Next.js project.
4. Deploy the default branch.

No server-side API key is required for the normal browser-based workflow because the key is entered locally by the reviewer.

## Notes

- This prototype does not integrate with COLA.
- Batch imports expect image files plus a JSON manifest, or a ZIP packet containing both.
- The app keeps working even if an API review fails, but the fallback analysis is less accurate than the vision model.
- Very large batches are accepted, but review still happens per image.

## Assumptions

- Reviewers provide their own OpenAI API key.
- Session data should stay in the browser instead of a shared backend.
- The exported packet should be ready to re-import as a new batch.

