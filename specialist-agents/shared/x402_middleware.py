"""
x402 payment middleware for FastAPI specialist agents.

Applied at the router level. On unauthenticated requests, returns 402
with Stellar payment instructions. On requests with X-Payment header,
verifies the payment on-chain before proceeding.
"""

import os
import httpx
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

HORIZON_URL = os.getenv("HORIZON_URL", "https://horizon-testnet.stellar.org")
AGENT_SECRET = os.getenv("AGENT_SECRET", "")
AGENT_PRICE_USDC = os.getenv("AGENT_PRICE_USDC", "0.001")
STELLAR_NETWORK = os.getenv("STELLAR_NETWORK", "testnet")


async def verify_payment(
    tx_hash: str, expected_amount: str, expected_recipient: str
) -> bool:
    """Query Horizon for the transaction and verify payment details."""
    async with httpx.AsyncClient() as client:
        # Get transaction operations
        resp = await client.get(
            f"{HORIZON_URL}/transactions/{tx_hash}/operations"
        )
        if resp.status_code != 200:
            return False

        data = resp.json()
        records = data.get("_embedded", {}).get("records", [])

        for op in records:
            if (
                op.get("type") == "payment"
                and op.get("asset_code") == "USDC"
                and op.get("to") == expected_recipient
                and op.get("amount") == expected_amount
            ):
                return True

    return False


def get_stellar_address() -> str:
    """Derive the public key from the agent's secret key."""
    try:
        from stellar_sdk import Keypair

        return Keypair.from_secret(AGENT_SECRET).public_key
    except Exception:
        return ""


class X402Middleware(BaseHTTPMiddleware):
    """FastAPI middleware that enforces x402 payments on all routes."""

    def __init__(self, app, price_usdc: str | None = None):
        super().__init__(app)
        self.price_usdc = price_usdc or AGENT_PRICE_USDC
        self.stellar_address = get_stellar_address()

    async def dispatch(self, request: Request, call_next):
        # Skip payment for health checks
        if request.url.path == "/health":
            return await call_next(request)

        # Check for payment proof
        payment_tx = request.headers.get("X-Payment")
        payment_network = request.headers.get("X-Payment-Network")

        if not payment_tx:
            # Return 402 with payment instructions
            return JSONResponse(
                status_code=402,
                content={
                    "amount": self.price_usdc,
                    "currency": "USDC",
                    "network": f"stellar:{STELLAR_NETWORK}",
                    "payTo": self.stellar_address,
                    "memo": f"agent-{request.url.path}-{id(request)}",
                },
            )

        if payment_network and payment_network != f"stellar:{STELLAR_NETWORK}":
            return JSONResponse(
                status_code=400,
                content={"error": f"Unsupported network: {payment_network}"},
            )

        # Verify payment on-chain
        verified = await verify_payment(
            tx_hash=payment_tx,
            expected_amount=self.price_usdc,
            expected_recipient=self.stellar_address,
        )

        if not verified:
            return JSONResponse(
                status_code=402,
                content={
                    "error": "Payment verification failed",
                    "amount": self.price_usdc,
                    "currency": "USDC",
                    "network": f"stellar:{STELLAR_NETWORK}",
                    "payTo": self.stellar_address,
                    "memo": f"retry-{id(request)}",
                },
            )

        # Payment verified — proceed
        response = await call_next(request)
        return response
