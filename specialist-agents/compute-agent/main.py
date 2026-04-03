"""
Compute Agent — runs analysis, inference, or transformation tasks.

x402 middleware applied at the app level.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI
from pydantic import BaseModel
from shared.x402_middleware import X402Middleware

app = FastAPI(title="AgentMesh Compute Agent")
app.add_middleware(X402Middleware, price_usdc=os.getenv("AGENT_PRICE_USDC", "0.005"))


class TaskRequest(BaseModel):
    task: str
    capability: str = "compute"
    sessionId: str = ""
    previousResult: dict | None = None


class TaskResponse(BaseModel):
    agent: str = "compute-agent"
    capability: str = "compute"
    result: dict
    sessionId: str = ""


@app.get("/health")
async def health():
    return {"status": "ok", "agent": "compute-agent"}


def analyze(task: str, previous: dict) -> dict:
    """Derive real insights from data-agent output."""
    data_payload = previous.get("data", {})
    insights: list[str] = []
    metrics: dict = {}

    ledger = data_payload.get("latest_ledger")
    if ledger:
        seq = ledger.get("sequence", 0)
        tx_ok = ledger.get("successful_transaction_count", 0)
        tx_fail = ledger.get("failed_transaction_count", 0)
        ops = ledger.get("operation_count", 0)
        total_tx = tx_ok + tx_fail
        success_rate = (tx_ok / total_tx * 100) if total_tx > 0 else 0.0
        metrics["ledger_sequence"] = seq
        metrics["tx_success_rate_pct"] = round(success_rate, 2)
        metrics["operations_per_ledger"] = ops
        insights.append(
            f"Ledger #{seq}: {tx_ok}/{total_tx} transactions succeeded "
            f"({success_rate:.1f}% success rate), {ops} operations."
        )

    usdc = data_payload.get("usdc_asset")
    if usdc:
        authorized = usdc.get("accounts_authorized", 0)
        amount = float(usdc.get("amount", "0"))
        metrics["usdc_authorized_accounts"] = authorized
        metrics["usdc_total_supply"] = round(amount, 2)
        insights.append(
            f"USDC on Stellar: {authorized:,} authorized accounts, "
            f"{amount:,.2f} USDC total supply."
        )

    fee = data_payload.get("fee_stats")
    if fee:
        p50 = fee.get("fee_charged_p50")
        p99 = fee.get("fee_charged_p99")
        capacity = fee.get("ledger_capacity_usage")
        metrics["median_fee_stroops"] = p50
        metrics["ledger_capacity_usage"] = capacity
        if p50 and p99:
            insights.append(
                f"Network fees: median {p50} stroops, p99 {p99} stroops. "
                f"Ledger capacity usage: {capacity}."
            )

    records_in = previous.get("records_fetched", 0)
    confidence = min(0.95, 0.6 + 0.12 * len(insights))

    return {
        "task": task,
        "records_analyzed": records_in,
        "insights": insights,
        "metrics": metrics,
        "confidence": round(confidence, 2),
    }


@app.post("/")
async def execute_task(req: TaskRequest) -> TaskResponse:
    input_data = req.previousResult or {}
    analysis = analyze(req.task, input_data)

    return TaskResponse(
        result={"source": "compute-agent", "analysis": analysis},
        sessionId=req.sessionId,
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "3011"))
    uvicorn.run(app, host="0.0.0.0", port=port)
