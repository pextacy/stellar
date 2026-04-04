"""
Tests for X402Middleware and the specialist agent endpoints.

Uses FastAPI's TestClient (sync) and httpx for async payment verification.
The middleware's Horizon call is patched so tests don't hit testnet.
"""

import sys
import os

# Ensure shared module is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import AsyncMock, patch, MagicMock
import pytest
from starlette.testclient import TestClient
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from shared.x402_middleware import X402Middleware, verify_payment

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FAKE_STELLAR_ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
FAKE_TX = "abc123txhash"
FAKE_RECIPIENT = FAKE_STELLAR_ADDR

# ---------------------------------------------------------------------------
# Autouse fixture — patches that must be active for the entire test
#
# X402Middleware.__init__ runs lazily (on the first request), so patches
# must stay active throughout the TestClient call, not just during make_app().
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _mock_stellar_sdk():
    """Prevent any real stellar-sdk calls in the test environment."""
    with patch("shared.x402_middleware._validate_startup", return_value=None), \
         patch("shared.x402_middleware.get_stellar_address", return_value=FAKE_STELLAR_ADDR):
        yield

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_app(price_usdc: str = "0.001") -> FastAPI:
    """Build a minimal FastAPI app with the x402 middleware for testing."""
    os.environ["AGENT_PRICE_USDC"] = price_usdc
    os.environ["STELLAR_NETWORK"] = "testnet"

    app = FastAPI()
    app.add_middleware(X402Middleware, price_usdc=price_usdc)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.post("/")
    async def task():
        return {"result": "ok"}

    return app


# ---------------------------------------------------------------------------
# verify_payment unit tests
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_verify_payment_returns_true_on_matching_op():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "_embedded": {
            "records": [
                {
                    "type": "payment",
                    "asset_code": "USDC",
                    "to": FAKE_RECIPIENT,
                    "amount": "0.001",
                }
            ]
        }
    }

    with patch("shared.x402_middleware.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await verify_payment(
            tx_hash=FAKE_TX,
            expected_amount="0.001",
            expected_recipient=FAKE_RECIPIENT,
        )

    assert result is True


@pytest.mark.anyio
async def test_verify_payment_returns_false_when_amount_mismatch():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "_embedded": {
            "records": [
                {
                    "type": "payment",
                    "asset_code": "USDC",
                    "to": FAKE_RECIPIENT,
                    "amount": "9999",  # wrong amount
                }
            ]
        }
    }

    with patch("shared.x402_middleware.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await verify_payment(
            tx_hash=FAKE_TX,
            expected_amount="0.001",
            expected_recipient=FAKE_RECIPIENT,
        )

    assert result is False


@pytest.mark.anyio
async def test_verify_payment_returns_false_on_horizon_error():
    mock_response = MagicMock()
    mock_response.status_code = 404

    with patch("shared.x402_middleware.httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await verify_payment(
            tx_hash=FAKE_TX,
            expected_amount="0.001",
            expected_recipient=FAKE_RECIPIENT,
        )

    assert result is False


# ---------------------------------------------------------------------------
# Middleware integration tests (sync TestClient)
# ---------------------------------------------------------------------------

def test_health_endpoint_bypasses_payment():
    app = make_app()
    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_request_without_payment_returns_402():
    app = make_app()
    client = TestClient(app, raise_server_exceptions=False)
    response = client.post("/")
    assert response.status_code == 402
    body = response.json()
    assert body["currency"] == "USDC"
    assert "amount" in body
    assert "payTo" in body
    assert "stellar:testnet" in body["network"]


def test_request_with_invalid_payment_returns_402():
    app = make_app()

    with patch("shared.x402_middleware.verify_payment", new=AsyncMock(return_value=False)):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post("/", headers={"X-Payment": "badhash"})

    assert response.status_code == 402
    body = response.json()
    assert body.get("error") == "Payment verification failed"


def test_request_with_valid_payment_returns_200():
    app = make_app()

    with patch("shared.x402_middleware.verify_payment", new=AsyncMock(return_value=True)):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post("/", headers={"X-Payment": FAKE_TX})

    assert response.status_code == 200
    assert response.json()["result"] == "ok"


def test_wrong_network_header_returns_400():
    app = make_app()

    with patch("shared.x402_middleware.verify_payment", new=AsyncMock(return_value=True)):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            "/",
            headers={"X-Payment": FAKE_TX, "X-Payment-Network": "stellar:mainnet"},
        )

    assert response.status_code == 400
    assert "Unsupported network" in response.json()["error"]


def test_correct_network_header_passes():
    app = make_app()

    with patch("shared.x402_middleware.verify_payment", new=AsyncMock(return_value=True)):
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post(
            "/",
            headers={"X-Payment": FAKE_TX, "X-Payment-Network": "stellar:testnet"},
        )

    assert response.status_code == 200


def test_402_response_contains_memo():
    app = make_app()
    client = TestClient(app, raise_server_exceptions=False)
    response = client.post("/")
    body = response.json()
    assert "memo" in body


# ---------------------------------------------------------------------------
# Compute agent logic unit tests
# ---------------------------------------------------------------------------

def test_compute_analyze_with_full_data():
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../compute-agent"))
    from main import analyze

    previous = {
        "records_fetched": 3,
        "data": {
            "latest_ledger": {
                "sequence": 50000,
                "successful_transaction_count": 90,
                "failed_transaction_count": 10,
                "operation_count": 200,
            },
            "usdc_asset": {
                "accounts_authorized": 1000,
                "amount": "5000000.0",
            },
            "fee_stats": {
                "fee_charged_p50": "100",
                "fee_charged_p99": "500",
                "ledger_capacity_usage": "0.15",
            },
        },
    }

    result = analyze("test task", previous)
    assert result["records_analyzed"] == 3
    assert len(result["insights"]) == 3
    assert result["metrics"]["tx_success_rate_pct"] == 90.0
    assert result["metrics"]["usdc_authorized_accounts"] == 1000
    assert result["confidence"] > 0.6


def test_compute_analyze_empty_data():
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../compute-agent"))
    from main import analyze

    result = analyze("empty task", {})
    assert result["insights"] == []
    assert result["metrics"] == {}
    assert result["confidence"] >= 0.6
