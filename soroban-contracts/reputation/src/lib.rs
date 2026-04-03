#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec, vec};

#[contracttype]
#[derive(Clone, Debug)]
pub struct ScoreEntry {
    pub caller: Address,
    pub latency_ms: u64,
    pub success: bool,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct AgentReputation {
    pub total_calls: u32,
    pub successful_calls: u32,
    pub total_latency_ms: u64,
    pub score: i128, // scaled 0–10000
    pub history: Vec<ScoreEntry>,
}

#[contracttype]
enum DataKey {
    Agent(Address),
}

const MAX_HISTORY: u32 = 50;

#[contract]
pub struct ReputationRegistryContract;

#[contractimpl]
impl ReputationRegistryContract {
    /// Record a call result for an agent.
    /// Score = (accuracy * 0.7 + speed_score * 0.3) * 10000
    /// Speed score: 10000 if <100ms, 0 if >10000ms, linear between.
    pub fn record(env: Env, agent: Address, caller: Address, latency_ms: u64, success: bool) {
        caller.require_auth();

        let key = DataKey::Agent(agent.clone());
        let mut rep: AgentReputation = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(AgentReputation {
                total_calls: 0,
                successful_calls: 0,
                total_latency_ms: 0,
                score: 0,
                history: vec![&env],
            });

        rep.total_calls += 1;
        if success {
            rep.successful_calls += 1;
        }
        rep.total_latency_ms += latency_ms;

        // Calculate score
        let accuracy: i128 = if rep.total_calls > 0 {
            (rep.successful_calls as i128 * 10000) / rep.total_calls as i128
        } else {
            0
        };

        let avg_latency = rep.total_latency_ms / rep.total_calls as u64;
        let speed_score: i128 = if avg_latency <= 100 {
            10000
        } else if avg_latency >= 10000 {
            0
        } else {
            ((10000 - avg_latency as i128) * 10000) / 9900
        };

        // Weighted: accuracy * 0.7 + speed * 0.3
        rep.score = (accuracy * 7000 + speed_score * 3000) / 10000;

        // Add to history, trim if needed
        let entry = ScoreEntry {
            caller,
            latency_ms,
            success,
            timestamp: env.ledger().timestamp(),
        };
        rep.history.push_back(entry);

        // Keep only last MAX_HISTORY entries
        while rep.history.len() > MAX_HISTORY {
            rep.history.pop_front();
        }

        env.storage().persistent().set(&key, &rep);
    }

    /// Get the current reputation score for an agent (0–10000).
    pub fn get_score(env: Env, agent: Address) -> i128 {
        let key = DataKey::Agent(agent);
        let rep: AgentReputation = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(AgentReputation {
                total_calls: 0,
                successful_calls: 0,
                total_latency_ms: 0,
                score: 0,
                history: Vec::new(&env),
            });
        rep.score
    }

    /// Get the call history for an agent, limited to the last `limit` entries.
    pub fn get_history(env: Env, agent: Address, limit: u32) -> Vec<ScoreEntry> {
        let key = DataKey::Agent(agent);
        let rep: AgentReputation = match env.storage().persistent().get(&key) {
            Some(r) => r,
            None => return Vec::new(&env),
        };

        let len = rep.history.len();
        if limit >= len {
            return rep.history;
        }

        let start = len - limit;
        let mut result = Vec::new(&env);
        for i in start..len {
            result.push_back(rep.history.get(i).unwrap());
        }
        result
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_record_and_score() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ReputationRegistryContract);
        let client = ReputationRegistryContractClient::new(&env, &contract_id);

        let agent = Address::generate(&env);
        let caller = Address::generate(&env);

        // Record a successful fast call
        client.record(&agent, &caller, &50, &true);

        let score = client.get_score(&agent);
        // accuracy=10000, speed=10000 → score = (10000*7000+10000*3000)/10000 = 10000
        assert_eq!(score, 10000);
    }

    #[test]
    fn test_mixed_results() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ReputationRegistryContract);
        let client = ReputationRegistryContractClient::new(&env, &contract_id);

        let agent = Address::generate(&env);
        let caller = Address::generate(&env);

        // 1 success, 1 failure
        client.record(&agent, &caller, &500, &true);
        client.record(&agent, &caller, &500, &false);

        let score = client.get_score(&agent);
        // accuracy = 5000 (50%), avg_latency=500, speed_score=~9595
        // score = (5000*7000 + 9595*3000) / 10000 = (35000000 + 28785000) / 10000 = 6378
        assert!(score > 6000 && score < 7000);
    }

    #[test]
    fn test_history() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ReputationRegistryContract);
        let client = ReputationRegistryContractClient::new(&env, &contract_id);

        let agent = Address::generate(&env);
        let caller = Address::generate(&env);

        client.record(&agent, &caller, &100, &true);
        client.record(&agent, &caller, &200, &false);
        client.record(&agent, &caller, &150, &true);

        let history = client.get_history(&agent, &10);
        assert_eq!(history.len(), 3);

        // Limit to 2
        let limited = client.get_history(&agent, &2);
        assert_eq!(limited.len(), 2);
    }

    #[test]
    fn test_no_history() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ReputationRegistryContract);
        let client = ReputationRegistryContractClient::new(&env, &contract_id);

        let agent = Address::generate(&env);

        let score = client.get_score(&agent);
        assert_eq!(score, 0);

        let history = client.get_history(&agent, &10);
        assert_eq!(history.len(), 0);
    }
}
