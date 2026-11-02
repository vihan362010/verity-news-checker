
export default async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Only POST requests allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

    if (!GROQ_API_KEY || !TAVILY_API_KEY) {
      throw new Error("API keys missing in Netlify environment variables.");
    }

    const body = await req.json();
    const claim = body.claim || body.news || body.text;

    if (!claim || typeof claim !== "string" || claim.trim().length < 10) {
      return new Response(
        JSON.stringify({ error: "Please enter a valid news claim." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Search for evidence using Tavily
    const searchResponse = await fetch(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query: claim,
          search_depth: "basic",
          max_results: 6,
          include_answer: false
        })
      }
    );

    if (!searchResponse.ok) {
      throw new Error("Tavily search failed: " + await searchResponse.text());
    }

    const searchData = await searchResponse.json();

    const sources = (searchData.results || []).map(item => ({
      title: item.title,
      url: item.url,
      content: item.content
    }));

    if (sources.length === 0) {
      return new Response(
        JSON.stringify({
          verdict: "unverified",
          explanation: "No reliable supporting evidence was found.",
          sources: []
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Analyse evidence using Groq's free-tier model
    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          messages: [
            {
              role: "system",
              content: `You are VERITY, a careful news fact-checking assistant.

Analyse the user's claim using ONLY the supplied search evidence.

Return valid JSON with exactly these fields:
{
  "verdict": "true" | "false" | "misleading" | "unverified",
  "explanation": "A clear explanation of the evidence.",
  "confidence": "High" | "Medium" | "Low"
}

Rules:
- true: evidence substantially supports the claim.
- false: credible evidence directly contradicts it.
- misleading: claim contains significant distortion or missing context.
- unverified: evidence is insufficient or inconclusive.
- Never invent facts or sources.
- Do not treat lack of search results as proof that a claim is false.
- Be neutral and distinguish confirmed facts from allegations.`
            },
            {
              role: "user",
              content: `NEWS CLAIM:
${claim}

SEARCH EVIDENCE:
${JSON.stringify(sources)}`
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_completion_tokens: 1200
        })
      }
    );

    if (!groqResponse.ok) {
      throw new Error("Groq analysis failed: " + await groqResponse.text());
    }

    const groqData = await groqResponse.json();
    const answer = groqData.choices?.[0]?.message?.content;

    if (!answer) {
      throw new Error("Groq returned an empty response.");
    }

    const result = JSON.parse(answer);

    const allowedVerdicts = [
      "true",
      "false",
      "misleading",
      "unverified"
    ];

    if (!allowedVerdicts.includes(result.verdict)) {
      result.verdict = "unverified";
    }

    return new Response(
      JSON.stringify({
        verdict: result.verdict,
        explanation: result.explanation || "No explanation available.",
        confidence: result.confidence || "Low",
        sources: sources.map(source => ({
          title: source.title,
          url: source.url
        }))
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Fact-checking failed.",
        details: error.message
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
};
