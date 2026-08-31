require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");

const app = express();
const PORT = process.env.PORT || 3000;

const groq = process.env.GROQ_API_KEY
  ? new Groq({
      apiKey: process.env.GROQ_API_KEY
    })
  : null;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const riskRules = [
  {
    id: "perpetual-license",
    phrase: "perpetual",
    category: "Content and IP rights",
    severity: "HIGH",
    explanation:
      "Your content rights may continue indefinitely, even after you stop using the service."
  },
  {
    id: "worldwide-license",
    phrase: "worldwide license",
    category: "Content and IP rights",
    severity: "HIGH",
    explanation:
      "The company may receive permission to use your content around the world."
  },
  {
    id: "third-party-sharing",
    phrase: "share your data with third-party",
    category: "Privacy and data sharing",
    severity: "HIGH",
    explanation:
      "Your personal information may be shared with outside companies."
  },
  {
    id: "third-party-partners",
    phrase: "third-party partners",
    category: "Privacy and data sharing",
    severity: "MEDIUM",
    explanation:
      "Your information may be shared with external partners."
  },
  {
    id: "binding-arbitration",
    phrase: "binding arbitration",
    category: "Dispute rights",
    severity: "HIGH",
    explanation:
      "You may have to resolve disputes outside court."
  },
  {
    id: "automatic-renewal",
    phrase: "automatic renewal",
    category: "Payments and subscription",
    severity: "MEDIUM",
    explanation:
      "A paid plan may renew unless you cancel it."
  }
];

function getRiskSummary(risks) {
  let score = 0;

  for (const risk of risks) {
    score += risk.severity === "HIGH" ? 3 : 2;
  }

  score = Math.min(score, 10);

  let level = "LOW";

  if (score >= 6) {
    level = "HIGH";
  } else if (score >= 3) {
    level = "MEDIUM";
  }

  return { score, level };
}

function findEvidence(text, phrase) {
  const sentences = text.split(/(?<=[.!?])\s+/);

  const sentence = sentences.find((item) =>
    item.toLowerCase().includes(phrase.toLowerCase())
  );

  return sentence
    ? sentence.trim().slice(0, 280)
    : "Relevant clause could not be extracted.";
}

function getPrivacySummary(risks) {
  const privacyRisks = risks.filter(
    (risk) => risk.category === "Privacy and data sharing"
  );

  if (privacyRisks.length === 0) {
    return {
      status: "NOT_DETECTED",
      severity: "LOW",
      message:
        "ClauseGuard did not detect its current privacy or data-sharing risk patterns."
    };
  }

  const hasHighRisk = privacyRisks.some(
    (risk) => risk.severity === "HIGH"
  );

  return {
    status: "POSSIBLE_DATA_USE",
    severity: hasHighRisk ? "HIGH" : "MEDIUM",
    message: hasHighRisk
      ? "This agreement may allow collection, sharing, or advertising use of personal data."
      : "This agreement may involve sharing or processing personal data.",
    evidence: privacyRisks.map((risk) => risk.evidence)
  };
}

function getLocalRisks(text) {
  const lowerCaseText = text.toLowerCase();

  return riskRules
    .filter((rule) => lowerCaseText.includes(rule.phrase))
    .map((rule) => ({
      id: rule.id,
      phrase: rule.phrase,
      category: rule.category,
      severity: rule.severity,
      explanation: rule.explanation,
      evidence: findEvidence(text, rule.phrase)
    }));
}

async function getAiRisks(text) {
  if (!groq) {
    return [];
  }

  const completion = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    temperature: 0.1,
    response_format: {
      type: "json_object"
    },
    messages: [
      {
        role: "system",
        content: `
You are ClauseGuard's legal-risk screening assistant.

Analyse only the supplied agreement text. Find possible risks involving:
- collection, sharing, sale, tracking, or advertising use of personal data
- intellectual-property or content-license rights
- subscriptions, automatic renewal, fees, or cancellation
- arbitration, class-action waiver, or limits on court rights
- unilateral changes to terms
- account suspension, deletion, or loss of content

Return ONLY valid JSON in exactly this format:
{
  "risks": [
    {
      "category": "Privacy and data sharing",
      "severity": "HIGH",
      "explanation": "Plain-English explanation in one short sentence.",
      "evidence": "Exact short sentence from the agreement."
    }
  ]
}

Rules:
- Return at most 6 risks.
- severity must be LOW, MEDIUM, or HIGH.
- Do not invent clauses that are not in the agreement.
- Do not provide legal advice.
`
      },
      {
        role: "user",
        content: `Analyse this agreement:\n\n${text.slice(0, 30000)}`
      }
    ]
  });

  const content = completion.choices[0]?.message?.content || '{"risks": []}';

  const parsed = JSON.parse(
    content
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "")
      .trim()
  );

  if (!Array.isArray(parsed.risks)) {
    return [];
  }

  return parsed.risks.map((risk, index) => ({
    id: `ai-risk-${index + 1}`,
    phrase: risk.evidence?.slice(0, 80) || "AI-detected clause",
    category: risk.category || "Other legal risk",
    severity: ["LOW", "MEDIUM", "HIGH"].includes(risk.severity)
      ? risk.severity
      : "MEDIUM",
    explanation: risk.explanation || "Potential legal risk detected.",
    evidence: risk.evidence || "Relevant clause identified by AI."
  }));
}

app.get("/health", (request, response) => {
  response.json({
    status: "ok",
    groqConfigured: Boolean(groq),
    message: "ClauseGuard backend is running."
  });
});

app.post("/api/analyze", async (request, response) => {
  const { text } = request.body;

  if (typeof text !== "string" || text.trim().length === 0) {
    return response.status(400).json({
      error: "Please send agreement text in the 'text' field."
    });
  }

  const localRisks = getLocalRisks(text);

  let aiRisks = [];
  let aiStatus = "not-configured";

  if (groq) {
    try {
      aiRisks = await getAiRisks(text);
      aiStatus = "completed";
    } catch (error) {
      console.error("Groq AI analysis failed:", error.message);
      aiStatus = "failed";
    }
  }

  const combinedRisks = [...localRisks, ...aiRisks];
  const summary = getRiskSummary(combinedRisks);
  const privacy = getPrivacySummary(combinedRisks);

  response.json({
    source: groq ? "groq-ai-plus-local-rules" : "local-rule-engine",
    aiStatus,
    disclaimer: "Informational risk alert only — not legal advice.",
    analysis: {
      ...summary,
      privacy,
      risksFound: combinedRisks.length,
      risks: combinedRisks
    }
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ClauseGuard backend running at http://localhost:${PORT}`);
});