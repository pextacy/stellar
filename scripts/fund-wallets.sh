#!/usr/bin/env bash
set -euo pipefail

# Fund agent wallets on Stellar testnet via Friendbot and add USDC trustlines.
#
# Required env vars (addresses):
#   COORDINATOR_ADDRESS, DATA_AGENT_ADDRESS, COMPUTE_AGENT_ADDRESS, ACTION_AGENT_ADDRESS
#
# Required env vars (secrets, for trustline setup):
#   COORDINATOR_SECRET, DATA_AGENT_SECRET, COMPUTE_AGENT_SECRET, ACTION_AGENT_SECRET

HORIZON_URL="${HORIZON_URL:-https://horizon-testnet.stellar.org}"
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
# USDC on Stellar testnet
USDC_ISSUER="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"

echo "[fund] Funding wallets on testnet..."

fund_wallet() {
  local name="$1"
  local address="$2"
  echo "[fund] Funding $name ($address)..."
  local resp
  resp=$(curl -sf "https://friendbot.stellar.org?addr=${address}" 2>&1) || {
    echo "[fund] Warning: Friendbot may have already funded $name"
  }
  echo "[fund] $name XLM funded."
}

add_usdc_trustline() {
  local name="$1"
  local secret="$2"
  echo "[fund] Adding USDC trustline for $name..."
  node - <<JS
const sdk = require('@stellar/stellar-sdk');
(async () => {
  const keypair = sdk.Keypair.fromSecret('${secret}');
  const server = new sdk.Horizon.Server('${HORIZON_URL}');
  const account = await server.loadAccount(keypair.publicKey());
  const tx = new sdk.TransactionBuilder(account, {
    fee: sdk.BASE_FEE,
    networkPassphrase: '${NETWORK_PASSPHRASE}',
  })
    .addOperation(sdk.Operation.changeTrust({
      asset: new sdk.Asset('USDC', '${USDC_ISSUER}'),
    }))
    .setTimeout(30)
    .build();
  tx.sign(keypair);
  await server.submitTransaction(tx);
  console.log('[fund] USDC trustline added for ${name}');
})().catch(err => {
  if (err.response && JSON.stringify(err.response.data).includes('op_already_exists')) {
    console.log('[fund] USDC trustline already exists for ${name}');
  } else {
    console.error('[fund] Trustline error for ${name}:', err.message || err);
    process.exit(1);
  }
});
JS
}

if [ -n "${COORDINATOR_ADDRESS:-}" ]; then
  fund_wallet "Coordinator" "$COORDINATOR_ADDRESS"
fi
if [ -n "${DATA_AGENT_ADDRESS:-}" ]; then
  fund_wallet "Data Agent" "$DATA_AGENT_ADDRESS"
fi
if [ -n "${COMPUTE_AGENT_ADDRESS:-}" ]; then
  fund_wallet "Compute Agent" "$COMPUTE_AGENT_ADDRESS"
fi
if [ -n "${ACTION_AGENT_ADDRESS:-}" ]; then
  fund_wallet "Action Agent" "$ACTION_AGENT_ADDRESS"
fi

echo ""
echo "[fund] Adding USDC trustlines..."

if [ -n "${COORDINATOR_SECRET:-}" ]; then
  add_usdc_trustline "Coordinator" "$COORDINATOR_SECRET"
fi
if [ -n "${DATA_AGENT_SECRET:-}" ]; then
  add_usdc_trustline "Data Agent" "$DATA_AGENT_SECRET"
fi
if [ -n "${COMPUTE_AGENT_SECRET:-}" ]; then
  add_usdc_trustline "Compute Agent" "$COMPUTE_AGENT_SECRET"
fi
if [ -n "${ACTION_AGENT_SECRET:-}" ]; then
  add_usdc_trustline "Action Agent" "$ACTION_AGENT_SECRET"
fi

echo "[fund] Done. All wallets funded and USDC trustlines added."
