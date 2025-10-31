// Applesnakes NFT Contract ABI - Minimal for swapMint function
export const NFT_ABI = [
  {
    "inputs": [],
    "name": "swapMint",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "user",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "ethIn",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "tokenOut",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "nftsMinted",
        "type": "uint256"
      }
    ],
    "name": "SwapMint",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "totalSwapMinted",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "u",
        "type": "address"
      }
    ],
    "name": "claimable",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "vesting",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "vestBalance",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "lastMint",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "lastClaim",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "claimVested",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
