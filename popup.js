document.addEventListener("DOMContentLoaded", () => {
  const badge = document.getElementById("risk-badge");
  const statusMessage = document.getElementById("status-message");
  const riskList = document.getElementById("risk-list");
  const copyButton = document.getElementById("copy-report");
  const copyMessage = document.getElementById("copy-message");

  chrome.storage.local.get(["lastScan"], (data) => {
    const scan = data.lastScan;

    if (!scan) {
      copyButton.disabled = true;
      return;
    }

    badge.textContent = `${scan.level} · ${scan.score}/10`;
    badge.classList.add(scan.level.toLowerCase());

    statusMessage.textContent =
      `Latest webpage scan found ${scan.risks.length} possible risk pattern(s).`;

    if (scan.risks.length === 0) {
      riskList.innerHTML = `
        <div class="risk-card">
          <p>No common risk patterns were found in the latest scan.</p>
        </div>
      `;
    } else {
      riskList.innerHTML = scan.risks
        .map(
          (risk) => `
            <div class="risk-card ${risk.severity.toLowerCase()}">
              <span class="risk-label ${risk.severity.toLowerCase()}">
                ${risk.severity} RISK
              </span>
              <p>${risk.risk}</p>
            </div>
          `
        )
        .join("");
    }

    copyButton.addEventListener("click", async () => {
      const riskReport = scan.risks
        .map(
          (risk, index) =>
            `${index + 1}. ${risk.severity} RISK\n` +
            `What it could mean: ${risk.risk}\n` +
            `Detected clause: ${risk.evidence || "Not available"}`
        )
        .join("\n\n");

      const report = [
        "CLAUSEGUARD — CONSENT RISK REPORT",
        `Risk score: ${scan.score}/10 (${scan.level})`,
        "",
        riskReport,
        "",
        "Informational guidance only — not legal advice."
      ].join("\n");

      try {
        await navigator.clipboard.writeText(report);
        copyMessage.textContent = "Report copied successfully.";
      } catch (error) {
        copyMessage.textContent = "Could not copy the report. Please try again.";
      }
    });
  });
});