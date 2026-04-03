"""
Action Agent — performs side effects: API calls, writes, notifications, formatting.

x402 middleware applied at the app level.
"""

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


@app.post("/")
async def execute_task(req: TaskRequest) -> TaskResponse:
    input_data = req.previousResult or {}

    result = {
        "source": "action-agent",
        "task": req.task,
        "action": {
            "description": f"Report formatted for: {req.task}",
            "input_insights": input_data.get("analysis", {}).get("insights", 0),
            "format": "markdown",
            "delivered": True,
        },
    }

    return TaskResponse(
        result=result,
        sessionId=req.sessionId,
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "3012"))
    uvicorn.run(app, host="0.0.0.0", port=port)
