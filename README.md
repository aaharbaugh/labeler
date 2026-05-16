# TTB Label Verifier

Standalone prototype for AI-powered alcohol label verification.

## What it does

- Upload one or many alcohol label images
- Send each image to an OpenAI vision model for structured extraction
- Apply local TTB-style checks on the extracted fields
- Display a simple pass / needs review / fail result for agents

## Stack

- Next.js 16
- React 19
- TypeScript
- OpenAI Responses API

## Model choice

This prototype defaults to `gpt-5.5`, which the current OpenAI model guidance lists as the flagship model for complex reasoning and professional work. It supports image input through the Responses API.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local`:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.5
```

3. Run locally:

```bash
npm run dev
```

Open http://localhost:3000.

## Deployment

This app needs a Node-hosted deployment because it calls OpenAI from a server route.

Recommended options:

- Vercel
- Render
- Fly.io
- Any Node runtime that supports Next.js

Set the same environment variables in the host:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` optional, defaults to `gpt-5.5`

## Notes and trade-offs

- The app does not integrate with COLA.
- The review flow is image-only for the prototype.
- If the OpenAI call fails, the app still returns a local fallback review so the UI remains usable.
- Very large batches are accepted in the UI and queued, but they still process one image per OpenAI request.

## Files

- `src/app/page.tsx` - batch upload UI
- `src/app/api/review/route.ts` - OpenAI-backed review endpoint
- `src/lib/openai.ts` - API integration
- `src/lib/ttb.ts` - local validation logic
