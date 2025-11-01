# Vercel Deployment Guide

## Required Environment Variables

To deploy this application on Vercel, you need to set the following environment variables in your Vercel project settings:

### 1. Navigate to Vercel Dashboard
- Go to your project settings
- Click on "Environment Variables"

### 2. Add the following variables:

#### Required Variables

```
NEXT_PUBLIC_ALCHEMY_API_KEY=XXMfam2qTkDnjRNwlDvQaGkelOLSCVSu
```
- **Description**: Alchemy API key for Base blockchain RPC
- **Get it at**: https://www.alchemy.com/

```
NEXT_PUBLIC_COINBASE_RPC_KEY=MqDLrcGH5izdQyA86JD7JZDV233VA0Dp
```
- **Description**: Coinbase Developer Platform RPC key  
- **Get it at**: https://portal.cdp.coinbase.com/

#### Optional (but recommended) Variables

```
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_actual_project_id
```
- **Description**: WalletConnect Project ID for wallet connections
- **Get it at**: https://cloud.walletconnect.com/
- **Note**: The app will work without this but wallet connections may be degraded

```
NEXT_PUBLIC_IPFS_BASE_URI=your_ipfs_hash
```
- **Description**: IPFS base URI for NFT metadata
- **Note**: Only needed if using IPFS for NFT images

```
NEXT_PUBLIC_APP_NAME=AppleSnakes NFT
```
- **Description**: Application name

## Common Deployment Issues

### Issue: Images not loading
**Solution**: 
- Images in `/public/Images/` should work automatically
- Make sure all image files have correct casing (Images vs images)
- Check that all referenced images exist in the public folder

### Issue: Price calculation failing
**Solution**: 
- Ensure `NEXT_PUBLIC_ALCHEMY_API_KEY` and `NEXT_PUBLIC_COINBASE_RPC_KEY` are set
- Check that you're connected to Base mainnet
- The app now gracefully handles missing publicClient

### Issue: Wallet connection problems
**Solution**:
- Set a valid `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- Get a free project ID from https://cloud.walletconnect.com/

## Build Command
```
npm run build
```

## Deployment Checklist
- [ ] All environment variables set in Vercel dashboard
- [ ] Build succeeds locally with `npm run build`
- [ ] All Images exist in `/public/Images/` folder
- [ ] Contract addresses are correct in `/config/contracts.ts`
- [ ] RPC endpoints are working

## Troubleshooting

### Check Build Logs
1. Go to Vercel dashboard → Deployments
2. Click on the failed deployment
3. Check the build logs for specific errors

### Common Errors
- **Module not found**: Check imports and file paths (case-sensitive on Vercel)
- **API request failed**: Check RPC endpoint environment variables  
- **Image optimization error**: Check Next.js image configuration in `next.config.js`

### SSR Issues
The app uses 'use client' for interactive components, so most SSR issues should be avoided. If you encounter SSR errors:
- Check that `window` and `localStorage` access is guarded with `typeof window !== 'undefined'`
- Ensure wagmi config has `ssr: true` (already configured)

## Support
For deployment issues, check:
- [Next.js Vercel Deployment Docs](https://nextjs.org/docs/deployment)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
