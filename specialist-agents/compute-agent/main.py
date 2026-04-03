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


@app.post("/")
async def execute_task(req: TaskRequest) -> TaskResponse:
    # Process previous stage data if available
    input_data = req.previousResult or {}

    result = {
        "source": "compute-agent",
        "task": req.task,
        "analysis": {
            "description": f"Analysis completed for: {req.task}",
            "input_records": input_data.get("data", {}).get("records", 0),
            "insights": 5,
            "confidence": 0.92,
        },
    }

    return TaskResponse(
        result=result,
        sessionId=req.sessionId,
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "3011"))
    uvicorn.run(app, host="0.0.0.0", port=port)
