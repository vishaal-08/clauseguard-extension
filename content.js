console.log("ClauseGuard is active on this page!");
const BACKEND_URL = "http://localhost:3000/api/analyze";

const riskRules = [
  {
    id: "perpetual-license",
    phrase: "perpetual",
    risk: "Your content rights may last forever.",
    severity: "HIGH"
  },
  {
    id: "worldwide-license",
    phrase: "worldwide license",
    risk: "The company may use your content anywhere in the world.",
    severity: "HIGH"
  },
  {
    id: "third-party-sharing",
    phrase: "share your data with third-party",
    risk: "Your personal data may be shared with outside companies.",
    severity: "HIGH"
  },
  {
    id: "external-partners",
    phrase: "third-party partners",
    risk: "Your data may be shared with external partners.",
    severity: "MEDIUM"
  },
  {
    id: "binding-arbitration",
    phrase: "binding arbitration",
    risk: "You may lose the option to take disputes to court.",
    severity: "HIGH"
  },
  {
    id: "auto-renewal",
    phrase: "automatic renewal",
    risk: "Your subscription may renew automatically.",
    severity: "MEDIUM"
  }
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightRiskyText() {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT
  );

  const textNodes = [];
  let node;

  while ((node = walker.nextNode())) {
    const parent = node.parentElement;

    if (
      !parent ||
      ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName) ||
      parent.closest("#clauseguard-overlay")
    ) {
      continue;
    }

    const text = node.nodeValue.toLowerCase();

    if (riskRules.some((rule) => text.includes(rule.phrase))) {
      textNodes.push(node);
    }
  }

  textNodes.forEach((textNode) => {
    const originalText = textNode.nodeValue;

    const matchingRules = riskRules.filter((rule) =>
      originalText.toLowerCase().includes(rule.phrase)
    );

    const pattern = matchingRules
      .map((rule) => escapeRegExp(rule.phrase))
      .join("|");

    const regex = new RegExp(`(${pattern})`, "gi");
    const fragment = document.createDocumentFragment();

    let lastIndex = 0;

    for (const match of originalText.matchAll(regex)) {
      const matchedText = match[0];
      const matchIndex = match.index;

      fragment.append(
        document.createTextNode(
          originalText.slice(lastIndex, matchIndex)
        )
      );

      const matchedRule = riskRules.find(
        (rule) => rule.phrase.toLowerCase() === matchedText.toLowerCase()
      );

      const highlight = document.createElement("mark");
      highlight.className = `clauseguard-highlight ${matchedRule.severity.toLowerCase()}`;
      highlight.dataset.riskId = matchedRule.id;
      highlight.textContent = matchedText;

      fragment.append(highlight);
      lastIndex = matchIndex + matchedText.length;
    }

    fragment.append(document.createTextNode(originalText.slice(lastIndex)));
    textNode.parentNode.replaceChild(fragment, textNode);
  });
}

function findEvidence(text, phrase) {
  const sentences = text.split(/(?<=[.!?])\s+/);

  const matchingSentence = sentences.find((sentence) =>
    sentence.toLowerCase().includes(phrase.toLowerCase())
  );

  if (matchingSentence) {
    return matchingSentence.trim().slice(0, 280);
  }

  return "Relevant clause could not be extracted.";
}

function scanPageForRisks() {
  const originalPageText = document.body.innerText;
  const pageText = originalPageText.toLowerCase();

  return riskRules
    .filter((rule) => pageText.includes(rule.phrase))
    .map((rule) => ({
      ...rule,
      evidence: findEvidence(originalPageText, rule.phrase)
    }));
}

async function analyzePageWithBackend() {
  const pageText = document.body.innerText;

  try {
    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: pageText
      })
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const result = await response.json();

    console.log("ClauseGuard backend response:", result);

    return result.analysis.risks.map((risk) => ({
      id: risk.id,
      phrase: risk.phrase,
      risk: risk.explanation,
      severity: risk.severity,
      category: risk.category,
      evidence: risk.evidence
    }));
  } catch (error) {
    console.warn(
      "ClauseGuard backend unavailable. Using local risk rules instead.",
      error
    );

    return scanPageForRisks();
  }
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => {
    const replacements = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return replacements[character];
  });
}

function getRiskSummary(risks) {
  let score = 0;

  risks.forEach((risk) => {
    if (risk.severity === "HIGH") {
      score += 3;
    }

    if (risk.severity === "MEDIUM") {
      score += 2;
    }
  });

  score = Math.min(score, 10);

  let level = "LOW";

  if (score >= 6) {
    level = "HIGH";
  } else if (score >= 3) {
    level = "MEDIUM";
  }

  return { score, level };
}

function saveScanToDashboard(risks) {
  const summary = getRiskSummary(risks);

  chrome.storage.local.set({
    lastScan: {
      score: summary.score,
      level: summary.level,
      risks: risks,
      scannedAt: new Date().toISOString()
    }
  });
}

function getControlText(control) {
  const label = control.closest("label");

  return (
    control.innerText +
    " " +
    control.value +
    " " +
    control.getAttribute("aria-label") +
    " " +
    (label ? label.innerText : "")
  ).toLowerCase();
}

function isAgreementControl(control) {
  const text = getControlText(control);

  const agreementWords = [
    "i agree",
    "agree to",
    "accept",
    "terms",
    "privacy policy",
    "consent"
  ];

  return agreementWords.some((word) => text.includes(word));
}

function showRiskModal(risks, onContinue) {
  const summary = getRiskSummary(risks);
  saveScanToDashboard(risks);
  const oldModal = document.getElementById("clauseguard-overlay");

  if (oldModal) {
    oldModal.remove();
  }

  const riskItems = risks.length
    ? risks
        .map(
          (item) => `
            <div class="clauseguard-risk ${item.severity.toLowerCase()}">
              <strong>${item.severity} RISK</strong>
              <p><strong>What this could mean:</strong> ${item.risk}</p>

              <div class="clauseguard-evidence">
                <span>DETECTED CLAUSE</span>
                <blockquote>“${escapeHtml(item.evidence)}”</blockquote>
                <button
                  class="clauseguard-show-clause"
                  data-risk-id="${item.id}"
                >
                  Show me this clause
                </button>
              </div>
            </div>
          `
        )
        .join("")
    : `
      <div class="clauseguard-risk low">
        <strong>NO COMMON HIGH-RISK PHRASES FOUND</strong>
        <p>ClauseGuard did not find its current warning patterns.</p>
      </div>
    `;

  const overlay = document.createElement("div");
  overlay.id = "clauseguard-overlay";

  overlay.innerHTML = `
    <div id="clauseguard-modal">
      <div class="clauseguard-header">
        <span>🛡️ ClauseGuard</span>
        <span class="clauseguard-status ${summary.level.toLowerCase()}">
          ${summary.level} RISK · ${summary.score}/10
        </span>
      </div>

      <h2>Risk score: ${summary.score}/10</h2>
      <p class="clauseguard-description">
        We found possible legal-risk language in this agreement.
      </p>

      <div id="clauseguard-risk-list">
        ${riskItems}
      </div>

      <p class="clauseguard-disclaimer">
        Informational alert only — not legal advice.
      </p>

      <div class="clauseguard-actions">
        <button id="clauseguard-close">Go back</button>
        <button id="clauseguard-continue">I understand, continue</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelectorAll(".clauseguard-show-clause").forEach((button) => {
    button.addEventListener("click", () => {
      const riskId = button.dataset.riskId;
      const highlightedClause = document.querySelector(
        `[data-risk-id="${riskId}"]`
      );

      if (!highlightedClause) {
        return;
      }

      overlay.remove();

      highlightedClause.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

      highlightedClause.classList.add("clauseguard-focus");

      setTimeout(() => {
        highlightedClause.classList.remove("clauseguard-focus");
      }, 2200);
    });
  });

  document.getElementById("clauseguard-close").addEventListener("click", () => {
    overlay.remove();
  });

  document
    .getElementById("clauseguard-continue")
    .addEventListener("click", () => {
      overlay.remove();
      onContinue();
    });
}



function addClauseGuardStyles() {
  const style = document.createElement("style");

  style.textContent = `
    #clauseguard-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(8, 15, 30, 0.72);
      font-family: Arial, sans-serif;
    }

    #clauseguard-modal {
      width: min(560px, 100%);
      max-height: 85vh;
      overflow-y: auto;
      padding: 26px;
      border: 1px solid #334155;
      border-radius: 18px;
      color: #e2e8f0;
      background: #0f172a;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.45);
    }

    .clauseguard-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #f8fafc;
      font-size: 18px;
      font-weight: bold;
    }

    .clauseguard-status {
      padding: 6px 9px;
      border-radius: 999px;
      color: #fbbf24;
      background: #3f2b0b;
      font-size: 11px;
    }

    .clauseguard-status.high {
      color: #fecaca;
      background: #7f1d1d;
    }

    .clauseguard-status.medium {
      color: #fde68a;
      background: #78350f;
    }

    .clauseguard-status.low {
      color: #bbf7d0;
      background: #14532d;
    }

    #clauseguard-modal h2 {
      margin: 22px 0 8px;
      color: white;
    }

    .clauseguard-description,
    .clauseguard-disclaimer {
      color: #94a3b8;
      line-height: 1.5;
    }

    .clauseguard-risk {
      margin: 12px 0;
      padding: 14px;
      border-radius: 10px;
    }

    .clauseguard-risk p {
      margin: 7px 0 0;
      color: #f8fafc;
      line-height: 1.4;
    }

    .clauseguard-risk.high {
      border-left: 5px solid #ef4444;
      background: #3b1117;
    }

    .clauseguard-risk.medium {
      border-left: 5px solid #f59e0b;
      background: #3b2a10;
    }

    .clauseguard-risk.low {
      border-left: 5px solid #22c55e;
      background: #12351f;
    }

    .clauseguard-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 22px;
    }

    .clauseguard-actions button {
      padding: 11px 15px;
      border: 0;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
    }

    #clauseguard-close {
      color: white;
      background: #334155;
    }

    #clauseguard-continue {
      color: #111827;
      background: #fbbf24;
    }

    .clauseguard-highlight {
      padding: 2px 4px;
      border-radius: 4px;
      color: white;
      font-weight: bold;
    }

    .clauseguard-highlight.high {
      background: #dc2626;
    }

    .clauseguard-highlight.medium {
      background: #d97706;
    }
    
        .clauseguard-evidence {
      margin-top: 12px;
      padding: 10px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.65);
    }

    .clauseguard-evidence span {
      color: #94a3b8;
      font-size: 10px;
      font-weight: bold;
      letter-spacing: 0.8px;
    }

    .clauseguard-evidence blockquote {
      margin: 7px 0 0;
      color: #cbd5e1;
      font-size: 13px;
      font-style: italic;
      line-height: 1.45;
    }
    
        .clauseguard-show-clause {
      margin-top: 12px;
      padding: 8px 10px;
      border: 1px solid #64748b;
      border-radius: 7px;
      color: #e2e8f0;
      background: #334155;
      cursor: pointer;
      font-size: 12px;
      font-weight: bold;
    }

    .clauseguard-show-clause:hover {
      background: #475569;
    }

    .clauseguard-focus {
      outline: 4px solid #facc15;
      box-shadow: 0 0 0 7px rgba(250, 204, 21, 0.32);
      animation: clauseguard-pulse 0.8s ease-in-out infinite alternate;
    }

    @keyframes clauseguard-pulse {
      from {
        transform: scale(1);
      }

      to {
        transform: scale(1.06);
      }
    }
    `;

  document.head.appendChild(style);
}

addClauseGuardStyles();
highlightRiskyText();
saveScanToDashboard(scanPageForRisks());

const controls = document.querySelectorAll(
  'input[type="checkbox"], button, input[type="button"], input[type="submit"]'
);

controls.forEach((control) => {
  if (!isAgreementControl(control)) {
    return;
  }

  console.log("ClauseGuard found an agreement control:", control);

  control.addEventListener(
    "click",
    async (event) => {
      if (control.dataset.clauseguardApproved === "true") {
        control.dataset.clauseguardApproved = "";
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      const risks = await analyzePageWithBackend();

      showRiskModal(risks, () => {
        control.dataset.clauseguardApproved = "true";
        control.click();
      });
    },
    true
  );
});