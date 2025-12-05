import { NextRequest } from 'next/server';

const API_BASE_URL = process.env.BACKEND_API_URL || 'https://api.applesnakes.com';

/**
 * GET /api/token-launcher/stream
 * Proxy for SSE progress stream
 *
 * Query params:
 *   - launchId: The launch ID to subscribe to
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const launchId = searchParams.get('launchId');

  if (!launchId) {
    return new Response(
      JSON.stringify({ error: 'Missing launchId parameter' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Create a readable stream to forward SSE events
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Connect to backend SSE stream
        const backendUrl = `${API_BASE_URL}/api/token-launcher/stream?launchId=${launchId}`;

        const response = await fetch(backendUrl, {
          headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
          },
        });

        if (!response.ok || !response.body) {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Failed to connect to backend stream' })}\n\n`)
          );
          controller.close();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // Send initial connected event
        controller.enqueue(
          encoder.encode(`event: connected\ndata: ${JSON.stringify({ launchId })}\n\n`)
        );

        // Forward all events from backend
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Forward the raw SSE data
          const chunk = decoder.decode(value, { stream: true });
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      } catch (error) {
        console.error('SSE proxy error:', error);
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Stream connection failed' })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
