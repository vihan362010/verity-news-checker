
const allowedVerdicts = ["true", "false", "misleading", "unverified"];

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const claim = typeof body.claim === "string" ? body.claim.trim() : "";

  if (claim.length < 20 || claim.length > 6000) {
    return json({
      error: "Enter a claim between 20 and 6,000 characters."
    }, 400);
  }

  const groqKey = Netlify.env.get("GROQ_API_KEY");
  const tavilyKey = Netlify.env.get("TAVILY_API_KEY");

  if (!groqKey || !tavilyKey) {
    return json({
      error: "Missing GROQ_API_KEY or TAVILY_API_KEY in Netlify environment variables."
    }, 503);
  }

  try {
    // Search for evidence on both sides of the claim.
    const shortClaim = claim.slice(0, 250);

    const queries = [
      `${shortClaim} evidence official sources fact check`,
      `${shortClaim} contrary evidence rebuttal investigation`
    ];

    const searches = await Promise.all(
      queries.map(query =>
        fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: tavilyKey,
            query,
            search_depth: "basic",
            topic: "general",
            max_results: 5,
            include_answer: false
          })
        })
      )
    );

    const searchResponses = await Promise.all(
      searches.map(async response => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(
            data.detail || data.message || "Web search failed."
          );
        }
        return data;
      })
    );

    const results = searchResponses.flatMap(data => data.results || []);

    const uniqueResults = Array.from(
      new Map(results.filter(r => r.url).map(r => [r.url, r])).values()
    );

    if (uniqueResults.length === 0) {
      return json({
        error: "No web evidence was found. Please try a more specific claim."
      }, 502);
    }

    const evidence = uniqueResults.map((r, i) => ({
      number: i + 1,
      title: r.title || "Untitled source",
      url: r.url,
      content: (r.content || "").slice(0, 1800),
      score: r.score
    }));

    const prompt = `
You are VERITY, a neutral fact-checking research assistant.

Assess the claim using ONLY the supplied search results.
Apply equal evidentiary standards whether the claim supports or criticises
a government, political party, public figure, institution or organisation.

Do not assume the claim is true or false.

VERDICT DEFINITIONS:
- true: reliable evidence substantially supports the central claim.
- false: reliable evidence directly contradicts the central claim.
- misleading: a factual core exists but important context is omitted,
  distorted or exaggerated.
- unverified: evidence is insufficient, inaccessible or conflicting.

IMPORTANT RULES:
1. Examine evidence both supporting and contradicting the claim.
2. Prefer official documents, court judgments, legislation,
   original statements and reputable independent reporting.
3. Do not treat search-result ranking as proof.
4. Do not invent facts, statistics, quotations, dates or sources.
5. Use only URLs present in the supplied search results.
6. If evidence is insufficient, choose unverified.
7. Absence of evidence is not proof of falsity.
8. Do not manufacture artificial balance.
9. Confidence means confidence in the assessment, not probability.
10. Clearly disclose limitations.

RETURN ONLY VALID JSON in this exact format:

{
  "verdict": "true",
  "confidence": 0,
  "confidence_note": "Explanation of confidence",
  "summary": "Balanced 2-4 sentence conclusion",
  "claims": [],
  "supporting_evidence": [],
  "contrary_evidence": [],
  "context": "Important context",
  "limitations": "What could not be verified",
  "sources": [
    {
      "title": "Source title",
      "publisher": "Publisher",
      "date": "Publication date or unknown",
      "url": "Exact URL from supplied search results",
      "relevance": "What the source establishes"
    }
  ]
}

Use 2-8 relevant sources where available.
Use empty arrays if no reliable evidence is found.
Never invent a source.

CLAIM TO VERIFY:
${claim}

WEB SEARCH RESULTS:
${JSON.stringify(evidence)}
`;

    const upstream = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content: "You are a careful, neutral fact-checking assistant. Return valid JSON only."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 4000,
          response_format: { type: "json_object" }
        })
      }
    );

    const raw = await upstream.json();

    if (!upstream.ok) {
      return json({
        error: raw.error?.message || "The AI research service returned an error."
      }, 502);
    }

    const output = raw.choices?.[0]?.message?.content;

    if (!output) {
      return json({
        error: "The AI service returned no assessment. Please try again."
      }, 502);
    }

    let parsed;

    try {
      parsed = JSON.parse(output);
    } catch {
      return json({
        error: "The AI returned an unreadable result. Please retry."
      }, 502);
    }

    if (!allowedVerdicts.includes(parsed.verdict)) {
      parsed.verdict = "unverified";
    }

    parsed.confidence = Math.max(
      0,
      Math.min(100, Number(parsed.confidence) || 0)
    );

    for (const key of [
      "claims",
      "supporting_evidence",
      "contrary_evidence",
      "sources"
    ]) {
      if (!Array.isArray(parsed[key])) {
        parsed[key] = [];
      }
    }

    // Only allow sources actually returned by Tavily.
    const allowedUrls = new Set(uniqueResults.map(r => r.url));

    parsed.sources = parsed.sources
      .filter(source =>
        source &&
        typeof source.url === "string" &&
        allowedUrls.has(source.url)
      )
      .slice(0, 8);

    return json(parsed, 200);

  } catch (error) {
    return json({
      error: error.message || "Could not reach the research services. Please try again."
    }, 502);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
