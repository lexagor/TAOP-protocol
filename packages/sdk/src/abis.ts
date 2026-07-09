// Human-readable ABIs matching contracts/{ReputationOracleNetwork,CapabilityRegistry}.sol.
// Kept hand-written so the SDK is self-contained (no hardhat artifact coupling).

export const RON_ABI: string[] = [
  "function CHALLENGE_BOND() view returns (uint256)",
  "function completions(uint256) view returns (address agent, bytes32 taskType, string resultCID, uint64 timestamp, bool challenged, bool disputed)",
  "function challenges(uint256) view returns (address challenger, string evidenceCID, uint64 timestamp, bool resolved)",
  "function nextCompletionId() view returns (uint256)",
  "function completionCount(address) view returns (uint64)",
  "function disputeCount(address) view returns (uint64)",
  "function slashedEthPool() view returns (uint256)",
  "function attestCompletion(bytes32 taskType, string resultCID) returns (uint256)",
  "function challengeCompletion(uint256 completionId, string evidenceCID) payable returns ()",
  "function resolveChallenge(uint256 completionId, bool upheld) returns ()",
  "function withdrawEthPool(address payable to, uint256 amount) returns ()",
  "function getSelfAttestScore(address agent) view returns (uint64 completionCount_, uint64 disputeCount_, uint64 score)",
  "function getCompletion(uint256 completionId) view returns ((address agent, bytes32 taskType, string resultCID, uint64 timestamp, bool challenged, bool disputed))",
  "event SelfAttested(uint256 completionId, address agent, bytes32 taskType)",
  "event ChallengeSubmitted(uint256 completionId, address challenger)",
  "event ChallengeResolved(uint256 completionId, bool upheld)",
  "event EthPoolWithdrawn(address to, uint256 amount)",
];

export const CAPABILITY_REGISTRY_ABI: string[] = [
  "function certifier() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenByIndex(uint256 index) view returns (uint256)",
  "function slashedEthPool() view returns (uint256)",
  "function registerCapabilityEth(bytes32 capabilityType, string metadataCID) payable returns (uint256)",
  "function certifyCapability(uint256 capabilityId) returns (bool)",
  "function slashCapability(uint256 capabilityId, uint256 penalty) returns (bool)",
  "function withdrawBond(uint256 capabilityId) returns ()",
  "function withdrawEthPool(address payable to, uint256 amount) returns ()",
  "function getCapability(uint256 capabilityId) view returns ((address creator, uint256 bond, bytes32 capabilityType, string metadataCID, bool certified, bool slashed))",
  "function capabilityTypeOf(uint256 capabilityId) view returns (bytes32)",
  "event CapabilityRegistered(uint256 capabilityId, address creator)",
  "event CapabilityCertified(uint256 capabilityId, address certifier)",
  "event CapabilitySlashed(uint256 capabilityId, uint256 penalty)",
  "event BondWithdrawn(uint256 capabilityId, address to, uint256 amount)",
  "event EthPoolWithdrawn(address to, uint256 amount)",
];