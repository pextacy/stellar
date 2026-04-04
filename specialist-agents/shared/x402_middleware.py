"""
x402 payment middleware for FastAPI specialist agents.

Applied at the router level. On unauthenticated requests, returns 402
with Stellar payment instructions. On requests with X-Payment header,
verifies the payment on-chain before proceeding.
"""

import logging
import os
import sys
import time
from typing import Optional

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

log = logging.getLogger("x402")

HORIZON_URL = os.getenv("HORIZON_URL", "https://horizon-testnet.stellar.org")
AGENT_SECRET = os.getenv("AGENT_SECRET", "")
AGENT_PRICE_USDC = os.getenv("AGENT_PRICE_USDC", "0.001")
STELLAR_NETWORK = os.getenv("STELLAR_NETWORK", "testnet")
HORIZON_TIMEOUT = float(os.getenv("HORIZON_TIMEOUT", "10"))


def _validate_startup() -> None:
    """Verify AGENT_SECRET is set and valid. Call from agent main(), not at import time."""
    if not AGENT_SECRET:
        print("[x402] FATAL: AGENT_SECRET environment variable is required", file=sys.stderr)
        sys.exit(1)
    try:
        from stellar_sdk import Keypair
        Keypair.from_secret(AGENT_SECRET)
    except Exception as exc:
        print(f"[x402] FATAL: AGENT_SECRET is not a valid Stellar secret key: {exc}", file=sys.stderr)
        sys.exit(1)


async def verify_payment(
    tx_hash: str, expected_amount: str, expected_recipient: str
) -> bool:
    """
    Query Horizon for the transaction and verify payment details.

    Returns False (not raises) on Horizon errors so the middleware
    can distinguish unavailability from a bad payment.
    """
    async with httpx.AsyncClient(timeout=HORIZON_TIMEOUT) as client:
        resp = await client.get(
            f"{HORIZON_URL}/transactions/{tx_hash}/operations"
        )
        if resp.status_code != 200:
            log.warning("Horizon returned %s for tx %s", resp.status_code, tx_hash)
            return False

        data = resp.json()
        records = data.get("_embedded", {}).get("records", [])

        for op in records:
            if (
                op.get("type") == "payment"
                and op.get("asset_code") == "USDC"
                and op.get("to") == expected_recipient
                and abs(float(op.get("amount", "0")) - float(expected_amount)) < 1e-7
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

    def __init__(self, app, price_usdc: Optional[str] = None):
        super().__init__(app)
        _validate_startup()  # fail fast even when run via `uvicorn main:app`
        self.price_usdc = price_usdc or AGENT_PRICE_USDC
        self.stellar_address = get_stellar_address()

    def _memo(self) -> str:
        # Timestamp-based memo, always <= 20 bytes, well within Stellar's 28-byte limit.
        return f"x402-{int(time.time() * 1000) % 10_000_000_000}"

    async def dispatch(self, request: Request, call_next):
        # Skip payment for health checks
        if request.url.path == "/health":
            return await call_next(request)

        # Check for payment proof
        payment_tx = request.headers.get("X-Payment")
        payment_network = request.headers.get("X-Payment-Network")

        if not payment_tx:
            return JSONResponse(
                status_code=402,
                content={
                    "amount": self.price_usdc,
                    "currency": "USDC",
                    "network": f"stellar:{STELLAR_NETWORK}",
                    "payTo": self.stellar_address,
                    "memo": self._memo(),
                },
            )

        if payment_network and payment_network != f"stellar:{STELLAR_NETWORK}":
            return JSONResponse(
                status_code=400,
                content={"error": f"Unsupported network: {payment_network}"},
            )

        # Verify payment on-chain
        try:
            verified = await verify_payment(
                tx_hash=payment_tx,
                expected_amount=self.price_usdc,
                expected_recipient=self.stellar_address,
            )
        except httpx.HTTPError as exc:
            log.error("Horizon unreachable during payment verification: %s", exc)
            return JSONResponse(
                status_code=502,
                content={"error": "Payment verification unavailable — Horizon unreachable"},
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
                    "memo": self._memo(),
                },
            )

        # Payment verified — proceed
        response = await call_next(request)
        return response
