import { z } from 'zod';
import { buildComplianceChecks, localFallbackAnalysis, normalizeText, type LabelAnalysis } from './ttb';

const responseSchema = z.object({
  brandName: z.string().nullable(),
  classType: z.string().nullable(),
  alcoholContent: z.string().nullable(),
  netContents: z.string().nullable(),
  producerName: z.string().nullable(),
  producerAddress: z.string().nullable(),
  countryOfOrigin: z.string().nullable(),
  governmentWarning: z.string().nullable(),
  notes: z.array(z.string()).default([]),
  checks: z.array(z.object({
    id: z.string(),
    label: z.string(),
    status: z.enum(['pass', 'review', 'fail']),
    detail: z.string(),
  })),
});

type ReviewInput = {
  filename: string;
  mimeType: string;
  dataUrl: string;
};

export async function reviewLabelWithOpenAI(input: ReviewInput): Promise<LabelAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const fallback = localFallbackAnalysis('');
    fallback.notes.unshift('OPENAI_API_KEY is not set. Using local fallback analysis only.');
    return fallback;
  }

  const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-nano';
  return reviewLabelWithApiKey(input, apiKey, model);
}

export async function reviewLabelWithApiKey(
  input: ReviewInput,
  apiKey: string,
  model = 'gpt-4.1-nano',
): Promise<LabelAnalysis> {
  if (!apiKey) {
    const fallback = localFallbackAnalysis('');
    fallback.notes.unshift('Missing API key. Using local fallback analysis only.');
    return fallback;
  }

  const instruction = [
    'Extract the visible fields from this U.S. alcohol label.',
    'Return only JSON that matches the schema.',
    'Use null when unreadable. Do not add prose.',
  ].join(' ');

  const requestBody: Record<string, unknown> = {
    model,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: instruction },
          {
            type: 'input_image',
            image_url: input.dataUrl,
            detail: 'low',
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'ttb_label_analysis',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            brandName: { type: ['string', 'null'] },
            classType: { type: ['string', 'null'] },
            alcoholContent: { type: ['string', 'null'] },
            netContents: { type: ['string', 'null'] },
            producerName: { type: ['string', 'null'] },
            producerAddress: { type: ['string', 'null'] },
            countryOfOrigin: { type: ['string', 'null'] },
            governmentWarning: { type: ['string', 'null'] },
            notes: { type: 'array', items: { type: 'string' } },
            checks: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  status: { type: 'string', enum: ['pass', 'review', 'fail'] },
                  detail: { type: 'string' },
                },
                required: ['id', 'label', 'status', 'detail'],
              },
            },
          },
          required: [
            'brandName',
            'classType',
            'alcoholContent',
            'netContents',
            'producerName',
            'producerAddress',
            'countryOfOrigin',
            'governmentWarning',
            'notes',
            'checks',
          ],
        },
      },
    },
    max_output_tokens: 240,
  };

  if (model.startsWith('gpt-5') || /^o\d/.test(model)) {
    requestBody.reasoning = { effort: 'low' };
  }

  const timeoutMs = Number(process.env.VISION_TIMEOUT_MS ?? 9000);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed (${response.status})`);
    }

    const json = await response.json() as {
      output_text?: string;
      output?: Array<{
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      }>;
    };

    const text = typeof json.output_text === 'string'
      ? json.output_text
      : json.output?.flatMap((item) => item.content ?? [])
          .find((item) => item.type === 'output_text')?.text ?? '';

    const parsed = responseSchema.parse(parseJsonResponseText(text));
    return buildComplianceChecks({
      brandName: normalizeText(parsed.brandName) || null,
      classType: normalizeText(parsed.classType) || null,
      alcoholContent: normalizeText(parsed.alcoholContent) || null,
      netContents: normalizeText(parsed.netContents) || null,
      producerName: normalizeText(parsed.producerName) || null,
      producerAddress: normalizeText(parsed.producerAddress) || null,
      countryOfOrigin: normalizeText(parsed.countryOfOrigin) || null,
      governmentWarning: normalizeText(parsed.governmentWarning) || null,
      notes: parsed.notes.length > 0 ? parsed.notes : [`Reviewed ${input.filename} via ${model}.`],
      checks: parsed.checks,
      complianceScore: 0,
      status: 'review',
    });
  } catch (error) {
    const fallback = localFallbackAnalysis('');
    fallback.notes = [
      'OpenAI vision request failed. Using local fallback analysis only.',
      `OpenAI review failed for ${input.filename}.`,
      error instanceof Error && error.name === 'AbortError'
        ? `Vision request timed out after ${timeoutMs} ms.`
        : error instanceof Error
          ? error.message
          : 'Unknown error',
    ];
    return fallback;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function parseJsonResponseText(text: string) {
  const raw = text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error('OpenAI response did not contain JSON.');
  }
}
