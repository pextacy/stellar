"""
Data Agent — fetches, cleans, and returns structured data.

x402 middleware applied at the app level. Every request requires
a verified Stellar USDC payment before the agent responds.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

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


@app.post("/")
async def execute_task(req: TaskRequest) -> TaskResponse:
    # In production this would call real data APIs.
    # For the hackathon demo, return structured data based on the task.
    result = {
        "source": "stellar-horizon",
        "task": req.task,
        "data": {
            "description": f"Data fetched for: {req.task}",
            "records": 42,
            "format": "json",
        },
    }

    return TaskResponse(
        result=result,
        sessionId=req.sessionId,
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "3010"))
    uvicorn.run(app, host="0.0.0.0", port=port)
