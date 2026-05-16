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

  const model = process.env.OPENAI_MODEL ?? 'gpt-5.5';
  const instruction = [
    'You are reviewing a U.S. alcohol label for TTB-style compliance.',
    'Read the image carefully and extract the visible text fields.',
    'Return exact text when visible, but use null if the field is absent or unreadable.',
    'Focus on these fields: brand name, class/type, alcohol content, net contents, producer/bottler name, producer address, country of origin, and government warning.',
    'The government warning should be copied exactly if it is present.',
    'Do not invent text that is not clearly visible.',
  ].join(' ');

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: instruction },
              {
                type: 'input_image',
                image_url: input.dataUrl,
                detail: 'high',
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
      }),
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

    const parsed = responseSchema.parse(JSON.parse(text));
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
      error instanceof Error ? error.message : 'Unknown error',
    ];
    return fallback;
  }
}
