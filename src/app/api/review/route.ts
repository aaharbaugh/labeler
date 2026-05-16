import { NextResponse } from 'next/server';
import { reviewLabelWithOpenAI } from '@/lib/openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 14 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image');
    const filename = String(formData.get('filename') ?? 'label');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing image file.' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are supported.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image is too large. Keep files under 14 MB.' }, { status: 413 });
    }

    const dataUrl = await toDataUrl(file);
    const analysis = await reviewLabelWithOpenAI({
      filename,
      mimeType: file.type,
      dataUrl,
    });

    return NextResponse.json({ analysis });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unexpected review error.' },
      { status: 500 },
    );
  }
}

async function toDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${buffer.toString('base64')}`;
}
