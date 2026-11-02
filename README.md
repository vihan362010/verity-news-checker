# Verity — Balanced News Credibility Checker

A deploy-ready Netlify prototype that evaluates a news claim using Gemini 2.5 Flash with Google Search grounding.

## Deploy

1. Create a free Netlify account and choose **Add new site → Deploy manually**.
2. Unzip this project and drag the contents of the `balanced-news-checker` folder into Netlify's manual deploy area, or push the folder to a Git repository and import it into Netlify.
3. In Netlify, open **Site configuration → Environment variables**.
4. Add `GEMINI_API_KEY` with an API key from Google AI Studio.
5. Trigger a fresh deploy. The site is ready at its Netlify URL.

The API key is used only by the Netlify serverless function. It is not placed in browser JavaScript.

## How it works

- User submits a headline, post, article excerpt, or claim.
- Netlify Function calls Gemini 2.5 Flash with Google Search.
- The model returns one of four outcomes: **True**, **False**, **Misleading**, or **Unverified**.
- The report shows supporting evidence, contrary evidence, context, limitations, and source links.

## Fairness design

The prompt explicitly requires the same evidence standard for true and false claims, seeks corroboration and contradiction, and avoids treating lack of evidence as proof of falsity. It does not force equal quantities of evidence on both sides: evidence must not be fabricated to create artificial balance.

## Important limitations

This is an AI-assisted prototype, not a certified fact-checking authority. Search coverage may be incomplete; model-generated summaries and source metadata can be wrong. Users should open cited sources, inspect original documents, and verify dates and context. For a production-grade service, add human review, source-quality scoring, abuse/rate limiting, logging controls, and tests against a labelled benchmark dataset.

## Local development

Install the Netlify CLI, set `GEMINI_API_KEY` in your environment, then run:

```bash
npm install -g netlify-cli
netlify dev
```

Open the local URL printed by Netlify CLI.
