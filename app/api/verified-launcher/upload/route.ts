import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.BACKEND_API_URL || 'https://api.applesnakes.com';

/**
 * POST /api/verified-launcher/upload
 * Upload verified image to temp storage (requires verification token, no payment)
 *
 * Request: multipart/form-data with 'file', 'verificationToken', 'walletAddress'
 * OR JSON with 'base64', 'verificationToken', 'walletAddress', 'contentType'
 *
 * Response on success:
 * {
 *   success: true,
 *   message: "Verified image uploaded successfully",
 *   upload: { bucket, fileName, s3Url, size, contentType },
 *   verification: { confidence, verifiedAt },
 *   nextStep: "Launch your token..."
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';

    let backendResponse: Response;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      backendResponse = await fetch(`${API_BASE_URL}/api/verified-launcher/upload`, {
        method: 'POST',
        body: formData,
      });
    } else {
      const body = await request.json();
      backendResponse = await fetch(`${API_BASE_URL}/api/verified-launcher/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json().catch(() => ({}));
      return NextResponse.json(
        { success: false, error: `Backend returned ${backendResponse.status}`, ...errorData },
        { status: backendResponse.status }
      );
    }

    const data = await backendResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error proxying verified-launcher upload:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to connect to backend', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 502 }
    );
  }
}
