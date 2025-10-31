# Base Crypto Wallet App



A TypeScript crypto wallet application for Base blockchain that supports multiple wallet connection methods including Farcaster miniapps, BaseApp, and standard web3 wallets.

## Features

- 🔐 **Secure Wallet Connection** - Connect with MetaMask, WalletConnect, Coinbase Wallet, and more
- ⚡ **Base Blockchain** - Optimized for Base mainnet and testnet
- 🌐 **Multi-Platform Support** - Works with Farcaster miniapps, BaseApp, and standard websites
- 💎 **Modern UI** - Beautiful, responsive interface with Tailwind CSS
- 📱 **Mobile Friendly** - Responsive design for all devices

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Wallet Connection**: RainbowKit + Wagmi v2
- **Blockchain**: Viem + Base Network

## Getting Started

### Prerequisites

- Node.js 18+ installed
- A WalletConnect Project ID (get one at https://cloud.walletconnect.com)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
   - Copy `.env.local` and add your WalletConnect Project ID
   - Update `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` with your project ID

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Configuration

### WalletConnect Project ID

To get wallet connection working properly:

1. Visit https://cloud.walletconnect.com
2. Create a new project
3. Copy your Project ID
4. Add it to `.env.local`:
```
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_here
```

### Supported Networks

- Base Mainnet
- Base Sepolia (Testnet)

### Supported Wallets

- MetaMask
- WalletConnect
- Coinbase Wallet
- Rainbow
- Trust Wallet
- And many more via WalletConnect

## Usage

### Connect Wallet

1. Click "Connect Wallet" button
2. Choose your preferred wallet
3. Approve the connection in your wallet
4. Your wallet address and balance will be displayed

### Farcaster Integration

This app is compatible with Farcaster Frames and miniapps. The wallet connection flow works seamlessly within the Farcaster ecosystem.

### BaseApp Integration

The app supports BaseApp's wallet connection standards and can be integrated into BaseApp experiences.

## Project Structure

```
miniapp/
├── app/                    # Next.js app directory
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout with providers
│   ├── page.tsx           # Home page
│   └── providers.tsx      # Wagmi & RainbowKit providers
├── components/            # React components
│   ├── WalletConnect.tsx # Wallet connection button
│   └── WalletDisplay.tsx # Wallet info display
├── lib/                   # Configuration
│   └── wagmi.ts          # Wagmi & Base network config
└── public/               # Static assets
```

## Development

### Type Checking
```bash
npm run type-check
```

### Linting
```bash
npm run lint
```

### Build
```bash
npm run build
```

## Deployment

This app can be deployed to:
- Vercel (recommended for Next.js)
- Netlify
- Any platform supporting Node.js

Make sure to set environment variables in your deployment platform.

## Security Notes

- Never commit `.env.local` or expose private keys
- Always verify the network before transactions
- Use testnet (Base Sepolia) for development

## License

MIT

## Support

For issues or questions, please open an issue on GitHub.
