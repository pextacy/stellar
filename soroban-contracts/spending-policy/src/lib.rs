#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, vec, Address, Bytes, Env, Symbol, Vec,
};

#[contracttype]
#[derive(Clone, Debug)]
pub struct SpendEntry {
    pub agent: Address,
    pub amount: i128,
    pub tx_hash: Bytes,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Session {
    pub coordinator: Address,
    pub budget: i128,
    pub spent: i128,
    pub per_agent_cap: i128,
    pub entries: Vec<SpendEntry>,
    pub active: bool,
}

#[contracttype]
enum DataKey {
    Session(Symbol),
}

#[contract]
pub struct SpendingPolicyContract;

#[contractimpl]
impl SpendingPolicyContract {
    /// Lock a USDC budget for a session. The coordinator sets the total budget
    /// and a per-agent cap (defaults to budget / 10 if not specified).
    pub fn lock_budget(env: Env, coordinator: Address, amount: i128, session_id: Symbol) {
        coordinator.require_auth();

        if amount <= 0 {
            panic!("Budget must be positive");
        }

        let key = DataKey::Session(session_id.clone());
        if env.storage().persistent().has(&key) {
            panic!("Session already exists");
        }

        let per_agent_cap = amount / 10;

        let session = Session {
            coordinator: coordinator.clone(),
            budget: amount,
            spent: 0,
            per_agent_cap,
            entries: vec![&env],
            active: true,
        };

        env.storage().persistent().set(&key, &session);
    }

    /// Check if a spend is allowed under the session's policy.
    /// Returns true if: session is active, amount + agent's prior spend <= per_agent_cap,
    /// and total spend + amount <= budget.
    pub fn can_spend(env: Env, session_id: Symbol, agent: Address, amount: i128) -> bool {
        let key = DataKey::Session(session_id);
        let session: Session = match env.storage().persistent().get(&key) {
            Some(s) => s,
            None => return false,
        };

        if !session.active {
            return false;
        }

        if session.spent + amount > session.budget {
            return false;
        }

        // Check per-agent cap
        let mut agent_spent: i128 = 0;
        for entry in session.entries.iter() {
            if entry.agent == agent {
                agent_spent += entry.amount;
            }
        }

        agent_spent + amount <= session.per_agent_cap
    }

    /// Record a spend after a verified on-chain payment.
    /// Only the session coordinator can call this.
    pub fn record_spend(
        env: Env,
        session_id: Symbol,
        agent: Address,
        amount: i128,
        tx_hash: Bytes,
    ) {
        let key = DataKey::Session(session_id);
        let mut session: Session = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Session not found");

        session.coordinator.require_auth();

        if !session.active {
            panic!("Session is not active");
        }

        if session.spent + amount > session.budget {
            panic!("Spend exceeds budget");
        }

        let entry = SpendEntry {
            agent,
            amount,
            tx_hash,
            timestamp: env.ledger().timestamp(),
        };

        session.entries.push_back(entry);
        session.spent += amount;

        env.storage().persistent().set(&key, &session);
    }

    /// Release the unspent remainder back to the recipient.
    /// Only the session coordinator can call this. Marks session inactive.
    pub fn release_remainder(env: Env, session_id: Symbol, recipient: Address) {
        let key = DataKey::Session(session_id);
        let mut session: Session = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Session not found");

        session.coordinator.require_auth();

        if !session.active {
            panic!("Session already closed");
        }

        session.active = false;
        env.storage().persistent().set(&key, &session);

        let remainder = session.budget - session.spent;
        if remainder > 0 {
            // In a real implementation, this would trigger a token transfer.
            // For the hackathon, the coordinator handles the actual USDC transfer
            // off-contract after reading the remainder.
            env.events().publish(
                (symbol_short!("release"),),
                (recipient, remainder),
            );
        }
    }

    /// Get the full session ledger including all spend entries.
    pub fn get_session_ledger(env: Env, session_id: Symbol) -> Session {
        let key = DataKey::Session(session_id);
        env.storage()
            .persistent()
            .get(&key)
            .expect("Session not found")
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_lock_and_spend() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SpendingPolicyContract);
        let client = SpendingPolicyContractClient::new(&env, &contract_id);

        let coordinator = Address::generate(&env);
        let agent = Address::generate(&env);
        let session_id = Symbol::new(&env, "test_session");

        // Lock budget of 1_000_000 (0.1 USDC in stroops)
        client.lock_budget(&coordinator, &1_000_000, &session_id);

        // Can spend within cap
        assert!(client.can_spend(&session_id, &agent, &50_000));

        // Record spend
        let tx_hash = Bytes::from_slice(&env, &[1, 2, 3, 4]);
        client.record_spend(&session_id, &agent, &50_000, &tx_hash);

        // Verify ledger
        let ledger = client.get_session_ledger(&session_id);
        assert_eq!(ledger.spent, 50_000);
        assert_eq!(ledger.entries.len(), 1);
    }

    #[test]
    fn test_spend_exceeds_cap() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SpendingPolicyContract);
        let client = SpendingPolicyContractClient::new(&env, &contract_id);

        let coordinator = Address::generate(&env);
        let agent = Address::generate(&env);
        let session_id = Symbol::new(&env, "cap_test");

        // Budget = 1_000_000, per_agent_cap = 100_000
        client.lock_budget(&coordinator, &1_000_000, &session_id);

        // Can spend within cap
        assert!(client.can_spend(&session_id, &agent, &100_000));

        // Cannot exceed per-agent cap
        assert!(!client.can_spend(&session_id, &agent, &100_001));
    }

    #[test]
    fn test_spend_exceeds_budget() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SpendingPolicyContract);
        let client = SpendingPolicyContractClient::new(&env, &contract_id);

        let coordinator = Address::generate(&env);
        let agent = Address::generate(&env);
        let session_id = Symbol::new(&env, "budget_test");

        client.lock_budget(&coordinator, &100, &session_id);

        // Cannot exceed total budget
        assert!(!client.can_spend(&session_id, &agent, &101));
    }

    #[test]
    fn test_release_remainder() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SpendingPolicyContract);
        let client = SpendingPolicyContractClient::new(&env, &contract_id);

        let coordinator = Address::generate(&env);
        let agent = Address::generate(&env);
        let recipient = Address::generate(&env);
        let session_id = Symbol::new(&env, "release_test");

        client.lock_budget(&coordinator, &1_000_000, &session_id);

        let tx_hash = Bytes::from_slice(&env, &[5, 6, 7, 8]);
        client.record_spend(&session_id, &agent, &300_000, &tx_hash);

        // Release remainder
        client.release_remainder(&session_id, &recipient);

        // Session now inactive
        let ledger = client.get_session_ledger(&session_id);
        assert!(!ledger.active);
        assert_eq!(ledger.spent, 300_000);
    }

    #[test]
    #[should_panic(expected = "Session already closed")]
    fn test_double_release() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, SpendingPolicyContract);
        let client = SpendingPolicyContractClient::new(&env, &contract_id);

        let coordinator = Address::generate(&env);
        let recipient = Address::generate(&env);
        let session_id = Symbol::new(&env, "double_release");

        client.lock_budget(&coordinator, &1_000_000, &session_id);
        client.release_remainder(&session_id, &recipient);
        client.release_remainder(&session_id, &recipient); // should panic
    }
}
