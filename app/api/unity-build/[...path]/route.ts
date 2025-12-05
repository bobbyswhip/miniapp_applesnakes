import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// MIME types for Unity WebGL files
const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.br': 'application/octet-stream',
};

// Files that are Brotli compressed
const COMPRESSED_FILES = [
  'WebGLBuild.data.br',
  'WebGLBuild.framework.js.br',
  'WebGLBuild.wasm.br',
];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const requestedPath = path.join('/');

  // Security: only allow files from the Unity build directory
  if (requestedPath.includes('..') || requestedPath.includes('\\')) {
    return new NextResponse('Invalid path', { status: 400 });
  }

  // Build the file path
  const basePath = join(process.cwd(), 'public', 'unity', 'WebGLBuild');
  let filePath = join(basePath, requestedPath);

  // Check if requesting an uncompressed file that has a .br version
  const fileName = requestedPath.split('/').pop() || '';
  const brFileName = fileName + '.br';
  const isCompressedRequest = !fileName.endsWith('.br') && COMPRESSED_FILES.includes(brFileName);

  if (isCompressedRequest) {
    // Map to the compressed file
    filePath = join(basePath, requestedPath + '.br');
  }

  // Check if file exists
  if (!existsSync(filePath)) {
    console.log(`[Unity API] File not found: ${filePath}`);
    return new NextResponse('File not found', { status: 404 });
  }

  try {
    // Read the file
    const fileBuffer = readFileSync(filePath);

    // Determine content type
    let contentType = 'application/octet-stream';
    if (fileName.endsWith('.js') || fileName.endsWith('.js.br')) {
      contentType = 'application/javascript';
    } else if (fileName.endsWith('.wasm') || fileName.endsWith('.wasm.br')) {
      contentType = 'application/wasm';
    } else if (fileName.endsWith('.data') || fileName.endsWith('.data.br')) {
      contentType = 'application/octet-stream';
    }

    // Build response headers
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    };

    // Add Content-Encoding for compressed files
    if (isCompressedRequest || filePath.endsWith('.br')) {
      headers['Content-Encoding'] = 'br';
    }

    return new NextResponse(fileBuffer, { headers });

  } catch (error) {
    console.error(`[Unity API] Error reading file: ${filePath}`, error);
    return new NextResponse('Error reading file', { status: 500 });
  }
}
