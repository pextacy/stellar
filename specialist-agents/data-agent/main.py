"""
Data Agent — fetches, cleans, and returns structured data.

x402 middleware applied at the app level. Every request requires
a verified Stellar USDC payment before the agent responds.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx
from fastapi import FastAPI
from pydantic import BaseModel
from shared.x402_middleware import X402Middleware

app = FastAPI(title="AgentMesh Data Agent")
app.add_middleware(X402Middleware, price_usdc=os.getenv("AGENT_PRICE_USDC", "0.001"))


class TaskRequest(BaseModel):
    task: str
    capability: str = "data"
    sessionId: str = ""
    previousResult: dict | None = None


class TaskResponse(BaseModel):
    agent: str = "data-agent"
    capability: str = "data"
    result: dict
    sessionId: str = ""


@app.get("/health")
async def health():
    return {"status": "ok", "agent": "data-agent"}


HORIZON_URL = os.getenv("HORIZON_URL", "https://horizon-testnet.stellar.org")
USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"


async def fetch_horizon_data(task: str) -> dict:
    """Fetch live data from Stellar Horizon based on task keywords."""
    data: dict = {}
    lower = task.lower()

    async with httpx.AsyncClient(timeout=10.0) as client:
        # Always fetch latest ledger stats
        ledger_resp = await client.get(
            f"{HORIZON_URL}/ledgers",
            params={"order": "desc", "limit": 1},
        )
        if ledger_resp.status_code == 200:
            records = ledger_resp.json().get("_embedded", {}).get("records", [])
            if records:
                l = records[0]
                data["latest_ledger"] = {
                    "sequence": l.get("sequence"),
                    "closed_at": l.get("closed_at"),
                    "successful_transaction_count": l.get("successful_transaction_count", 0),
                    "failed_transaction_count": l.get("failed_transaction_count", 0),
                    "operation_count": l.get("operation_count", 0),
                    "base_fee_in_stroops": l.get("base_fee_in_stroops", 100),
                }

        # Fetch USDC asset data when task is finance/defi related
        if any(kw in lower for kw in ("usdc", "defi", "stellar", "protocol", "tvl", "liquidity", "asset", "research")):
            asset_resp = await client.get(
                f"{HORIZON_URL}/assets",
                params={"asset_code": "USDC", "asset_issuer": USDC_ISSUER, "limit": 1},
            )
            if asset_resp.status_code == 200:
                records = asset_resp.json().get("_embedded", {}).get("records", [])
                if records:
                    r = records[0]
                    data["usdc_asset"] = {
                        "asset_code": r.get("asset_code"),
                        "asset_issuer": r.get("asset_issuer"),
                        "accounts_authorized": r.get("accounts", {}).get("authorized", 0),
                        "accounts_unauthorized": r.get("accounts", {}).get("unauthorized", 0),
                        "amount": r.get("amount", "0"),
                        "num_claimable_balances": r.get("num_claimable_balances", 0),
                        "claimable_balances_amount": r.get("claimable_balances_amount", "0"),
                    }

        # Fetch network fee statistics
        fee_resp = await client.get(f"{HORIZON_URL}/fee_stats")
        if fee_resp.status_code == 200:
            fee = fee_resp.json()
            data["fee_stats"] = {
                "last_ledger": fee.get("last_ledger"),
                "ledger_capacity_usage": fee.get("ledger_capacity_usage"),
                "fee_charged_p50": fee.get("fee_charged", {}).get("p50"),
                "fee_charged_p99": fee.get("fee_charged", {}).get("p99"),
                "max_fee_p50": fee.get("max_fee", {}).get("p50"),
            }

    return data


@app.post("/")
async def execute_task(req: TaskRequest) -> TaskResponse:
    horizon_data = await fetch_horizon_data(req.task)

    total_records = sum(
        1 if k in horizon_data else 0
        for k in ("latest_ledger", "usdc_asset", "fee_stats")
    )

    result = {
        "source": HORIZON_URL,
        "task": req.task,
        "records_fetched": total_records,
        "data": horizon_data,
    }

    return TaskResponse(
        result=result,
        sessionId=req.sessionId,
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "3010"))
    uvicorn.run(app, host="0.0.0.0", port=port)
