const allowedVerdicts = ["true", "false", "misleading", "unverified"];

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }
  const claim = typeof body.claim === "string" ? body.claim.trim() : "";
  if (claim.length < 20 || claim.length > 6000) return json({ error: "Enter a claim between 20 and 6,000 characters." }, 400);

  const apiKey = Netlify.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ error: "The app is not configured yet. Add GEMINI_API_KEY in Netlify → Site configuration → Environment variables, then redeploy." }, 503);

  const prompt = `You are Verity, a neutral news and claim verification research assistant. Assess the user's claim without political, ideological, geographic, or institutional bias. Do not presume a claim is false, and do not presume it is true. Apply the same evidentiary standard to both directions.

Research the claim using Google Search. Prefer primary sources (official datasets, court judgments, legislation, original statements, peer-reviewed research) and reputable independent reporting. Seek evidence that could support AND contradict the claim. Distinguish a false claim from a claim that is merely unverified. Do not invent sources, quotations, dates, statistics, or URLs. Include only source URLs actually returned/used in research. If evidence is mixed or insufficient, choose "unverified" or "misleading" rather than forcing a binary verdict. A lack of search results is not proof of falsity.

Verdict definitions:
- true: reliable evidence substantially supports the central factual claim.
- false: reliable evidence directly contradicts the central factual claim.
- misleading: there is a factual core, but important context is omitted, distorted, or exaggerated.
- unverified: evidence is insufficient, inaccessible, too recent, or materially conflicting.

Confidence is confidence in the assessment based on evidence quality, not a probability that the claim is true. Keep confidence modest when sources are few, weak, partisan, or indirect. Do not use the number of sources as a substitute for source quality.

Return ONLY valid JSON with this exact shape:
{
 "verdict":"true|false|misleading|unverified",
 "confidence":0,
 "confidence_note":"short explanation of confidence",
 "summary":"2-4 sentence balanced conclusion",
 "claims":["atomic factual subclaim"],
 "supporting_evidence":["evidence that supports the claim, with source attribution"],
 "contrary_evidence":["evidence that challenges the claim, with source attribution"],
 "context":"important dates, definitions, caveats, or missing context",
 "limitations":"what could not be verified and what a reader should check",
 "sources":[{"title":"source title","publisher":"publisher","date":"publication date or unknown","url":"full URL","relevance":"what this source establishes"}]
}
Use empty arrays when nothing reliable is found. Do not manufacture a supporting side merely to make the report symmetrical; instead say no reliable evidence was found. Keep source list to 2-8 high-quality items. Claim to assess:
${claim}`;

  try {
    const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      })
    });
    const raw = await upstream.json();
    if (!upstream.ok) return json({ error: raw.error?.message || "The research service returned an error." }, 502);
    const output = raw.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n");
    if (!output) return json({ error: "The research service returned no assessment. Please try again." }, 502);
    let parsed;
    try { parsed = JSON.parse(output); } catch {
      const cleaned = output.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      try { parsed = JSON.parse(cleaned); } catch { return json({ error: "The research service returned an unreadable result. Please retry." }, 502); }
    }
    if (!allowedVerdicts.includes(parsed.verdict)) parsed.verdict = "unverified";
    parsed.confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));
    for (const key of ["claims", "supporting_evidence", "contrary_evidence", "sources"]) if (!Array.isArray(parsed[key])) parsed[key] = [];
    parsed.sources = parsed.sources.filter(s => s && typeof s.url === "string" && /^https?:\/\//i.test(s.url)).slice(0, 8);
    return json(parsed, 200);
  } catch {
    return json({ error: "Could not reach the research service. Check your connection and try again." }, 502);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}