"""
Action Agent — performs side effects: API calls, writes, notifications, formatting.

x402 middleware applied at the app level.
"""

import datetime
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI
from pydantic import BaseModel
from shared.x402_middleware import X402Middleware

app = FastAPI(title="AgentMesh Action Agent")
app.add_middleware(X402Middleware, price_usdc=os.getenv("AGENT_PRICE_USDC", "0.002"))


class TaskRequest(BaseModel):
    task: str
    capability: str = "action"
    sessionId: str = ""
    previousResult: dict | None = None


class TaskResponse(BaseModel):
    agent: str = "action-agent"
    capability: str = "action"
    result: dict
    sessionId: str = ""


@app.get("/health")
async def health():
    return {"status": "ok", "agent": "action-agent"}


def build_report(task: str, previous: dict) -> str:
    """Format the compute-agent analysis into a markdown report."""
    analysis = previous.get("analysis", {})
    insights: list[str] = analysis.get("insights", [])
    metrics: dict = analysis.get("metrics", {})
    confidence: float = analysis.get("confidence", 0.0)
    records_analyzed: int = analysis.get("records_analyzed", 0)
    timestamp = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    lines: list[str] = [
        f"# {task}",
        f"_Generated {timestamp} — {records_analyzed} data points analyzed_",
        "",
    ]

    if insights:
        lines.append("## Key Findings")
        for insight in insights:
            lines.append(f"- {insight}")
        lines.append("")

    if metrics:
        lines.append("## Metrics")
        for key, value in metrics.items():
            label = key.replace("_", " ").title()
            lines.append(f"| {label} | {value} |")
        lines.append("")

    lines.append(f"**Analysis confidence:** {confidence * 100:.0f}%")
    lines.append("")
    lines.append("_Source: Stellar Horizon testnet · Delivered via AgentMesh x402_")

    return "\n".join(lines)


@app.post("/")
async def execute_task(req: TaskRequest) -> TaskResponse:
    input_data = req.previousResult or {}
    report_md = build_report(req.task, input_data)

    analysis = input_data.get("analysis", {})

    result = {
        "source": "action-agent",
        "task": req.task,
        "report": report_md,
        "insights_count": len(analysis.get("insights", [])),
        "confidence": analysis.get("confidence", 0.0),
    }

    return TaskResponse(
        result=result,
        sessionId=req.sessionId,
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "3012"))
    uvicorn.run(app, host="0.0.0.0", port=port)
