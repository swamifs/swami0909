/**
 * Cloudflare Workers AI Image Generator
 * Integrates with AI image generation and public storage services
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // Add CORS headers and 2025 security headers to all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json',
      // 2025 Security Headers - Required for compliance
      'X-XSS-Protection': '1; mode=block',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; object-src 'none';",
    };

    try {
      // 2025 Compliance: Validate environment variables
      const requiredEnvVars = ['AI_SERVICE_URL', 'STORAGE_SERVICE_URL', 'STORAGE_FILES_URL_PREFIX'];
      for (const envVar of requiredEnvVars) {
        if (!env[envVar]) {
          return new Response(JSON.stringify({
            success: false,
            error: `Configuration error: Missing required environment variable: ${envVar}`
          }), {
            status: 500,
            headers: corsHeaders,
          });
        }
      }

      const url = new URL(request.url);
      
      // Health check endpoint
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response(JSON.stringify({
          success: true,
          message: 'AI Image Generator API is running',
          endpoints: {
            'POST /generate-image': 'Generate AI image and store on public storage service'
          }
        }), {
          headers: corsHeaders,
        });
      }

      // Main image generation endpoint
      if (url.pathname === '/generate-image' && request.method === 'POST') {
        // 2025 Compliance: Request size validation
        const contentLength = request.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > 1048576) { // 1MB limit
          return new Response(JSON.stringify({
            success: false,
            error: 'Request body too large. Maximum size is 1MB.'
          }), {
            status: 413,
            headers: corsHeaders,
          });
        }

        // 2025 Compliance: JSON parsing error handling
        let body;
        try {
          body = await request.json();
        } catch (error) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Invalid JSON in request body',
            details: error.message
          }), {
            status: 400,
            headers: corsHeaders,
          });
        }
        
        // 2025 Compliance: Comprehensive input validation
        const validationErrors = [];
        
        // Validate prompt
        if (!body.prompt || typeof body.prompt !== 'string') {
          validationErrors.push('Prompt is required and must be a string');
        } else if (body.prompt.length > 1000) {
          validationErrors.push('Prompt must be 1000 characters or less');
        } else if (body.prompt.trim().length === 0) {
          validationErrors.push('Prompt cannot be empty');
        }
        
        // Validate width and height
        if (body.width !== undefined) {
          if (!Number.isInteger(body.width) || body.width < 64 || body.width > 2048) {
            validationErrors.push('Width must be an integer between 64 and 2048');
          }
        }
        if (body.height !== undefined) {
          if (!Number.isInteger(body.height) || body.height < 64 || body.height > 2048) {
            validationErrors.push('Height must be an integer between 64 and 2048');
          }
        }
        
        // Validate model parameter
        const allowedModels = ['flux', 'kontext', 'turbo', 'nanobanana'];
        if (body.model !== undefined && !allowedModels.includes(body.model)) {
          validationErrors.push(`Model must be one of: ${allowedModels.join(', ')}`);
        }
        
        // Validate seed parameter
        if (body.seed !== undefined && (!Number.isInteger(body.seed) || body.seed < 0)) {
          validationErrors.push('Seed must be a non-negative integer');
        }
        
        // Validate enhance parameter
        if (body.enhance !== undefined && typeof body.enhance !== 'boolean') {
          validationErrors.push('Enhance must be a boolean');
        }
        
        if (validationErrors.length > 0) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Validation failed',
            details: validationErrors
          }), {
            status: 400,
            headers: corsHeaders,
          });
        }
        
        // Sanitize prompt for XSS prevention
        const sanitizedPrompt = body.prompt
          .replace(/[<>]/g, '') // Remove angle brackets
          .replace(/javascript:/gi, '') // Remove javascript: protocol
          .replace(/on\w+=/gi, '') // Remove event handlers
          .trim();

        // Extract parameters with defaults (using sanitized prompt)
        const {
          width = 1024,
          height = 1024,
          model = 'flux',
          seed,
          enhance = false
        } = body;
        const prompt = sanitizedPrompt;

        // Generate image using AI service
        const imageResponse = await generateImageFromAI(env, prompt, {
          width,
          height,
          model,
          seed,
          enhance,
          nologo: true // Always remove logo
        });

        if (!imageResponse.success) {
          return new Response(JSON.stringify(imageResponse), {
            status: 500,
            headers: corsHeaders,
          });
        }

        // Upload to public storage service with fallback handling
        const uploadResponse = await uploadToStorage(env, imageResponse.imageData, imageResponse.contentType);

        // Prepare response data - always include base64, conditionally include publicUrl
        const responseData = {
          base64: imageResponse.base64,
          parameters: {
            prompt,
            width,
            height,
            model
          }
        };
        
        // Only include optional parameters if they were actually provided
        if (body.seed !== undefined) {
          responseData.parameters.seed = seed;
        }
        if (body.enhance !== undefined) {
          responseData.parameters.enhance = enhance;
        }

        // If storage upload succeeded, include the public URL
        if (uploadResponse.success) {
          responseData.publicUrl = uploadResponse.url;
          console.log('Image generated and uploaded successfully');
          
          return new Response(JSON.stringify({
            success: true,
            data: responseData
          }), {
            headers: corsHeaders,
          });
        } else {
          // If storage upload failed, still return base64 but with warning
          console.warn('Storage upload failed, returning base64 only:', uploadResponse.error);
          responseData.warning = 'Public URL upload failed - image available as base64 only';
          responseData.uploadError = uploadResponse.error;
          
          return new Response(JSON.stringify({
            success: true,
            data: responseData,
            warnings: ['Failed to upload to public storage service - base64 image still available']
          }), {
            headers: corsHeaders,
          });
        }
      }

      // 404 for unknown endpoints
      return new Response(JSON.stringify({
        success: false,
        error: 'Endpoint not found'
      }), {
        status: 404,
        headers: corsHeaders,
      });

    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Internal server error',
        details: error.message
      }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};

/**
 * Generate image using AI service
 */
async function generateImageFromAI(env, prompt, options) {
  const maxRetries = 4;
  const baseDelay = 2000;
  const maxDelay = 15000;
  const timeoutMs = 45000;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`AI service request attempt ${attempt}/${maxRetries}`);
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('AI service timeout')), timeoutMs);
      });
      
      const aiRequestPromise = performAIRequest(env, prompt, options);
      
      const result = await Promise.race([aiRequestPromise, timeoutPromise]);
      
      console.log(`AI service request successful on attempt ${attempt}`);
      return result;
      
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      console.error(`AI service attempt ${attempt} failed:`, error.message);
      
      const shouldRetry = 
        error.message.includes('timeout') ||
        error.message.includes('5') ||
        error.message.includes('429') ||
        error.message.includes('403') ||
        error.message.includes('Forbidden') ||
        error.message.includes('Too Many Requests') ||
        error.message.includes('rate limit') ||
        error.message.includes('network') ||
        error.message.includes('fetch') ||
        error.message.includes('DNS') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('503') ||
        error.message.includes('502') ||
        error.message.includes('504');
      
      if (!shouldRetry && !error.message.includes('AI service error')) {
        return {
          success: false,
          error: 'Failed to generate image',
          details: error.message
        };
      }
      
      if (isLastAttempt) {
        return {
          success: false,
          error: 'Failed to generate image after multiple attempts. Pollinations.ai may be rate limiting your requests.',
          details: error.message,
          attempts: attempt
        };
      }
      
      let delay = baseDelay;
      if (error.message.includes('429') || error.message.includes('Too Many Requests')) {
        delay = 16000;
        console.log('Rate limited by pollinations.ai (Anonymous tier: 15s limit) - waiting 16 seconds...');
      } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
        delay = 16000;
        console.log('Access restricted by pollinations.ai - waiting 16 seconds before retry...');
      } else {
        const exponentialDelay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt - 1));
        const jitter = exponentialDelay * (0.5 + Math.random() * 0.5);
        delay = Math.floor(jitter);
      }
      
      console.log(`Retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function performAIRequest(env, prompt, options) {
  // Build URL with parameters
  const encodedPrompt = encodeURIComponent(prompt);
  const params = new URLSearchParams({
    width: options.width.toString(),
    height: options.height.toString(),
    model: options.model,
    nologo: 'true',
  });

  // Add optional parameters
  if (options.seed) {
    params.append('seed', options.seed.toString());
  }
  if (options.enhance) {
    params.append('enhance', 'true');
  }

  const aiServiceUrl = `${env.AI_SERVICE_URL}/prompt/${encodedPrompt}?${params.toString()}`;
  
  console.log('Requesting image from pollinations.ai...');

  const response = await fetch(aiServiceUrl, {
    method: 'GET',
    headers: {
      'User-Agent': 'CloudflareWorker-ImageGenerator/1.0',
      'Accept': 'image/*',
    },
  });

  if (!response.ok) {
    const statusText = response.statusText || 'Unknown error';
    if (response.status === 429) {
      throw new Error(`AI service error: 429 Too Many Requests (Anonymous tier: 15s rate limit)`);
    } else if (response.status === 403) {
      throw new Error(`AI service error: 403 Forbidden (May require authentication)`);
    }
    throw new Error(`AI service error: ${response.status} ${statusText}`);
  }

  // Detect actual image format from response headers
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  console.log('AI service returned content type:', contentType);
  
  // CRITICAL: Validate that we actually received an image, not an error message
  if (!contentType.startsWith('image/')) {
    const errorText = await response.text();
    console.error('Pollinations.ai returned non-image response:', errorText);
    throw new Error(`AI service error: Received ${contentType} instead of image. Response: ${errorText.substring(0, 200)}`);
  }
  
  const imageData = await response.arrayBuffer();
  
  // Use proper base64 conversion
  const base64 = arrayBufferToBase64(imageData);
  
  console.log('Image data size:', imageData.byteLength, 'bytes');
  console.log('Base64 length:', base64.length, 'characters');

  return {
    success: true,
    imageData,
    contentType,
    base64: `data:${contentType};base64,${base64}`
  };
}

/**
 * Upload image to public storage service with retry logic and timeout handling
 */
async function uploadToStorage(env, imageData, contentType = 'image/jpeg') {
  const maxRetries = 3;
  const baseDelay = 1000;
  const maxDelay = 8000;
  const timeoutMs = 20000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Storage upload attempt ${attempt}/${maxRetries}`);
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
      });

      const uploadPromise = performStorageUpload(env, imageData, contentType);

      const result = await Promise.race([uploadPromise, timeoutPromise]);
      
      console.log(`Storage upload successful on attempt ${attempt}`);
      return result;

    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      console.error(`Storage upload attempt ${attempt} failed:`, error.message);
      
      if (isLastAttempt) {
        console.error('All storage upload attempts failed, returning failure');
        return {
          success: false,
          error: 'Failed to upload image to public storage service after multiple retries',
          details: error.message,
          attempts: attempt
        };
      }

      const exponentialDelay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt - 1));
      const jitter = exponentialDelay * (0.5 + Math.random() * 0.5);
      const delay = Math.floor(jitter);
      
      console.log(`Retrying storage upload in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Convert ArrayBuffer to base64 string (robust conversion for large binary data)
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192; // Process in chunks to avoid stack overflow
  let binary = '';
  
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  return btoa(binary);
}

/**
 * Perform the actual storage service upload
 */
async function performStorageUpload(env, imageData, contentType = 'image/jpeg') {
  // Convert ArrayBuffer to Uint8Array for better Cloudflare Workers compatibility
  const uint8Array = new Uint8Array(imageData);
  
  console.log('Uploading to catbox with content type:', contentType);
  console.log('Upload data size:', uint8Array.length, 'bytes');
  
  // Create a Blob with the correct content type
  const blob = new Blob([uint8Array], { type: contentType });
  
  // Determine proper file extension based on content type
  const extension = contentType.includes('png') ? 'png' : 
                   contentType.includes('gif') ? 'gif' :
                   contentType.includes('webp') ? 'webp' : 'jpg';
  
  // Create FormData with improved handling
  const formData = new FormData();
  formData.append('reqtype', 'fileupload');
  formData.append('fileToUpload', blob, `generated-image.${extension}`);

  const response = await fetch(env.STORAGE_SERVICE_URL, {
    method: 'POST',
    body: formData,
    headers: {
      'User-Agent': 'CloudflareWorker/1.0',
      // Don't set Content-Type - let FormData handle it
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Storage service API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const responseText = await response.text();
  console.log('Raw catbox response:', responseText);
  
  const url = responseText.trim();
  
  // Validate URL format - catbox returns just the filename, we need to construct full URL
  if (!url || url.includes('error') || url.includes('fail')) {
    throw new Error(`Catbox upload failed: "${url}"`);
  }
  
  // Construct full catbox URL
  const fullUrl = url.startsWith('http') ? url : `${env.STORAGE_FILES_URL_PREFIX}${url}`;
  
  // Final validation
  if (!fullUrl.startsWith(env.STORAGE_FILES_URL_PREFIX)) {
    throw new Error(`Invalid catbox URL format: "${fullUrl}"`);
  }

  return {
    success: true,
    url: fullUrl
  };
}