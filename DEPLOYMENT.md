# Deployment Instructions

This guide will help you deploy your AI Image Generator to Cloudflare Workers and prepare it for RapidAPI integration.

## Prerequisites

- Cloudflare account
- Node.js 16.17.0 or later
- Git (for GitHub deployment)

## 1. GitHub Deployment

### Upload to GitHub Repository

1. **Initialize Git repository** (if not already done):
   ```bash
   git init
   git add .
   git commit -m "Initial commit - AI Image Generator for Cloudflare Workers"
   ```

2. **Create GitHub repository**:
   - Go to GitHub and create a new repository
   - Name it something like `ai-image-generator-worker`
   - Don't initialize with README, .gitignore, or license (since you already have files)

3. **Push to GitHub**:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY_NAME.git
   git branch -M main
   git push -u origin main
   ```

## 2. Cloudflare Workers Deployment

### Method 1: Direct Deploy with Wrangler

1. **Install Wrangler globally** (if not already installed):
   ```bash
   npm install -g wrangler
   ```

2. **Authenticate with Cloudflare**:
   ```bash
   wrangler auth login
   ```

3. **Deploy to production**:
   ```bash
   npm run deploy
   ```
   or
   ```bash
   wrangler deploy
   ```

### Method 2: Deploy from GitHub with CI/CD (Recommended for production)

1. **Set up GitHub Actions** for automated deployment:
   
   Create `.github/workflows/deploy.yml`:
   ```yaml
   name: Deploy to Cloudflare Workers
   
   on:
     push:
       branches: [ main ]
   
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3
         - uses: actions/setup-node@v3
           with:
             node-version: '18'
         - run: npm install -g wrangler
         - run: wrangler deploy
           env:
             CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
   ```

2. **Configure Secrets**:
   - Go to your GitHub repository Settings > Secrets and variables > Actions
   - Add `CLOUDFLARE_API_TOKEN` with your Cloudflare API token
   - Get the token from Cloudflare Dashboard > My Profile > API Tokens

3. **Alternative: Workers Deploy from Git**:
   - In Cloudflare Dashboard, go to Workers > Create a Service
   - Choose "Deploy from Git" option
   - Connect your GitHub repository
   - Cloudflare will automatically deploy on git pushes

## 3. Production Configuration

### Verify Deployment

1. **Test the API endpoints**:
   ```bash
   # Health check
   curl https://YOUR_WORKER_SUBDOMAIN.workers.dev/

   # Image generation test
   curl -X POST https://YOUR_WORKER_SUBDOMAIN.workers.dev/generate-image \
     -H "Content-Type: application/json" \
     -d '{"prompt": "test image", "width": 512, "height": 512}'
   ```

2. **Check response format**:
   - Health check should return API status and available endpoints
   - Image generation should return JSON with `base64` field
   - `publicUrl` field is included when storage upload succeeds
   - If storage upload fails, response includes `warnings` array and no `publicUrl`

### Domain Configuration (Optional)

1. **Custom Domain Setup**:
   - In Cloudflare Workers dashboard, go to your worker
   - Navigate to "Settings" > "Triggers"
   - Add custom domain if you have one

## 4. RapidAPI Integration Preparation

### API Documentation Format

Your API is ready for RapidAPI with these endpoints:

**Base URL**: `https://YOUR_WORKER_SUBDOMAIN.workers.dev`

#### Endpoints

1. **GET /** - Health Check
   - Returns API status and available endpoints
   - Response: `200 OK` with JSON status

2. **POST /generate-image** - Generate AI Image
   - **Request Body**:
     ```json
     {
       "prompt": "string (required) - Description of image to generate",
       "width": "number (optional, default: 1024) - Image width in pixels",
       "height": "number (optional, default: 1024) - Image height in pixels", 
       "model": "string (optional, default: 'flux') - AI model to use",
       "seed": "number (optional) - Random seed for reproducible results",
       "enhance": "boolean (optional, default: false) - Enable image enhancement"
     }
     ```
   - **Response (Success with storage upload)**:
     ```json
     {
       "success": true,
       "data": {
         "base64": "data:image/jpeg;base64,/9j/4AAQ...",
         "publicUrl": "https://files.example.com/abc123.jpg",
         "parameters": {
           "prompt": "...",
           "width": 1024,
           "height": 1024,
           "model": "flux",
           "seed": null,
           "enhance": false
         }
       }
     }
     ```

   - **Response (Success with storage upload failure)**:
     ```json
     {
       "success": true,
       "data": {
         "base64": "data:image/jpeg;base64,/9j/4AAQ...",
         "parameters": {
           "prompt": "...",
           "width": 1024,
           "height": 1024,
           "model": "flux",
           "seed": null,
           "enhance": false
         },
         "warnings": [
           "Failed to upload image to public storage service"
         ],
         "uploadError": "Network timeout after 3 retry attempts"
       }
     }
     ```

### RapidAPI Publishing Steps

1. **Create RapidAPI Provider Account**:
   - Go to RapidAPI Provider Dashboard
   - Register as an API provider

2. **Submit Your API**:
   - API Base URL: Your Cloudflare Workers URL
   - Upload API documentation
   - Set pricing tiers (free tier recommended for initial launch)

3. **API Verification**:
   - RapidAPI will test your endpoints
   - Ensure your API handles CORS properly (already implemented)
   - Verify error handling returns proper HTTP status codes
   - **Important**: Document that `publicUrl` may be missing in responses when storage upload fails
   - Clients should always check for `publicUrl` existence before using it

## 5. Monitoring and Maintenance

### Cloudflare Analytics

- Monitor usage in Cloudflare Workers dashboard
- Track response times and error rates
- Set up alerts for high error rates

### Logs and Debugging

- View real-time logs: `wrangler tail` (for deployment monitoring)
- Check Cloudflare dashboard for analytics
- Monitor external service uptime for AI generation and storage services
- Use `wrangler tail` after deployment to confirm successful responses

## 6. Rate Limiting and Scaling

### Current Limits

- No built-in rate limiting (add if needed for production)
- Cloudflare Workers auto-scales globally
- External API dependencies: AI generation and storage services

### Adding Rate Limiting (Optional)

If you need rate limiting for RapidAPI:

1. Use Cloudflare's Rate Limiting rules
2. Or implement in-worker rate limiting using KV storage
3. Consider implementing API key authentication

## Troubleshooting

### Common Issues

1. **Deployment fails**: Check wrangler.toml configuration
2. **CORS errors**: Already handled in the worker
3. **Image generation timeouts**: Already handled with retry logic
4. **Storage upload fails**: API has fallback to return base64 only

### Support

- Cloudflare Workers documentation: https://developers.cloudflare.com/workers/
- AI image generation service documentation
- Public storage service documentation

---

Your AI Image Generator is now ready for production deployment and RapidAPI integration!