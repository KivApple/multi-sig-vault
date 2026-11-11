import { parseAbi } from "viem";

export const SAFE_ABI = parseAbi([
	"function VERSION() view returns (string)",
	"function getOwners() view returns (address[])",
	"function getThreshold() view returns (uint256)",
	"function nonce() view returns (uint256)",
	"function isOwner(address owner) view returns (bool)",
	"function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
	"function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
	"function addOwnerWithThreshold(address owner, uint256 _threshold)",
	"function removeOwner(address prevOwner, address owner, uint256 _threshold)",
	"function swapOwner(address prevOwner, address oldOwner, address newOwner)",
	"function changeThreshold(uint256 _threshold)",
	"function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
	"function simulate(address targetContract, bytes calldataPayload) returns (bytes response)",
	"function simulateAndRevert(address targetContract, bytes calldataPayload)",
	"function isValidSignature(bytes32 _dataHash, bytes _signature) view returns (bytes4)",
]);

export const PROXY_FACTORY_ABI = parseAbi([
	"function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
	"function proxyCreationCode() view returns (bytes)",
	"event ProxyCreation(address indexed proxy, address singleton)",
]);

export const MULTISEND_ABI = parseAbi(["function multiSend(bytes transactions) payable"]);

export const CREATE_CALL_ABI = parseAbi([
	"function performCreate(uint256 value, bytes deploymentData) returns (address newContract)",
	"function performCreate2(uint256 value, bytes deploymentData, bytes32 salt) returns (address newContract)",
	"event ContractCreation(address indexed newContract)",
]);

export const SIMULATE_ACCESSOR_ABI = parseAbi([
	"function simulate(address to, uint256 value, bytes data, uint8 operation) returns (uint256 estimate, bool success, bytes returnData)",
]);

export const ERC20_ABI = parseAbi([
	"function balanceOf(address owner) view returns (uint256)",
	"function decimals() view returns (uint8)",
	"function symbol() view returns (string)",
	"function name() view returns (string)",
	"function allowance(address owner, address spender) view returns (uint256)",
	"function transfer(address to, uint256 amount) returns (bool)",
	"function approve(address spender, uint256 amount) returns (bool)",
]);

export const MULTICALL_ABI = parseAbi([
	"struct Call3 { address target; bool allowFailure; bytes callData; }",
	"struct Result { bool success; bytes returnData; }",
	"function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
	"function getEthBalance(address addr) view returns (uint256 balance)",
]);
