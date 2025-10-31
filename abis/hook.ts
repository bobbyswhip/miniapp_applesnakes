// Hook Contract ABI for getting PoolKey
export const HOOK_VIEW_ABI = [
  {
    "inputs": [
      {
        "internalType": "PoolId",
        "name": "id",
        "type": "bytes32"
      }
    ],
    "name": "getPoolKey",
    "outputs": [
      {
        "components": [
          {
            "internalType": "Currency",
            "name": "currency0",
            "type": "address"
          },
          {
            "internalType": "Currency",
            "name": "currency1",
            "type": "address"
          },
          {
            "internalType": "uint24",
            "name": "fee",
            "type": "uint24"
          },
          {
            "internalType": "int24",
            "name": "tickSpacing",
            "type": "int24"
          },
          {
            "internalType": "contract IHooks",
            "name": "hooks",
            "type": "address"
          }
        ],
        "internalType": "struct PoolKey",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
