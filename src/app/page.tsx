'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Files, Loader2, ScanSearch, UploadCloud, WandSparkles, X } from 'lucide-react';
import type { LabelAnalysis } from '@/lib/ttb';

type ReviewItem = {
  id: string;
  name: string;
  status: 'queued' | 'uploading' | 'done' | 'error';
  preview: string;
  analysis?: LabelAnalysis;
  error?: string;
};

const SAMPLE_LABELS = [
  {
    name: 'Old Tom Distillery - Bourbon',
    brand: 'OLD TOM DISTILLERY',
    classType: 'Kentucky Straight Bourbon Whiskey',
    alc: '45% Alc./Vol. (90 Proof)',
    contents: '750 mL',
    producer: 'Bottled by Old Tom Distilling Co.',
    address: 'Louisville, KY',
    warning: 'GOVERNMENT WARNING: According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects.',
  },
  {
    name: 'Seabird Gin',
    brand: 'SEABIRD',
    classType: 'London Dry Gin',
    alc: '40% Alc./Vol.',
    contents: '1 L',
    producer: 'Produced by Seabird Spirits',
    address: 'Portland, OR',
    warning: 'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.',
  },
  {
    name: 'Northfield Wine',
    brand: 'NORTHFIELD CELLARS',
    classType: 'California Red Wine',
    alc: '13.5% by volume',
    contents: '750 mL',
    producer: 'Bottled by Northfield Cellars, Inc.',
    address: 'Napa, CA',
    warning: 'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects.',
  },
];

export default function Home() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef(Promise.resolve());

  const stats = useMemo(() => {
    const done = items.filter((item) => item.status === 'done').length;
    const pass = items.filter((item) => item.analysis?.status === 'pass').length;
    const review = items.filter((item) => item.analysis?.status === 'review').length;
    const fail = items.filter((item) => item.analysis?.status === 'fail').length;
    return { done, pass, review, fail };
  }, [items]);

  const busy = useMemo(
    () => items.some((item) => item.status === 'queued' || item.status === 'uploading'),
    [items],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem('ttb-label-verifier:v1');
  }, []);

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (list.length === 0) return;

    for (const file of list) {
      const id = crypto.randomUUID();
      const preview = await fileToPreview(file);
      setItems((prev) => [
        {
          id,
          name: file.name,
          status: 'queued',
          preview,
        },
        ...prev,
      ]);
      queueRef.current = queueRef.current.then(async () => {
        await processFile(file, id);
      });
    }
  };

  const processFile = async (file: File, id: string) => {
    setItems((prev) => prev.map((item) => (
      item.id === id ? { ...item, status: 'uploading' } : item
    )));

    try {
      const formData = new FormData();
      formData.set('image', file);
      formData.set('filename', file.name);

      const response = await fetch('/api/review', {
        method: 'POST',
        body: formData,
      });

      const payload = await response.json() as {
        analysis?: LabelAnalysis;
        error?: string;
      };

      if (!response.ok || !payload.analysis) {
        throw new Error(payload.error ?? `Review failed (${response.status})`);
      }

      setItems((prev) => prev.map((item) => (
        item.id === id
          ? { ...item, status: 'done', analysis: payload.analysis }
          : item
      )));
    } catch (error) {
      setItems((prev) => prev.map((item) => (
        item.id === id
          ? { ...item, status: 'error', error: error instanceof Error ? error.message : 'Review failed' }
          : item
        )));
    }
  };

  const loadSamples = async () => {
    const files = await Promise.all(SAMPLE_LABELS.map((sample) => svgToFile(sample)));
    await handleFiles(files);
  };

  return (
    <main className="page">
      <div className="shell">
        <section className="hero">
          <div className="hero-card">
            <div className="eyebrow">
              <ScanSearch size={14} />
              TTB label verification
            </div>
            <h1 className="title">Batch review alcohol labels with OpenAI vision.</h1>
            <p className="lede">
              Drop in label images, process them in batches, and get a structured extraction of the
              fields compliance agents actually care about: brand, class/type, ABV, contents,
              producer details, and the government warning.
            </p>
            <div className="hero-actions">
              <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
                <UploadCloud size={16} />
                Upload labels
              </button>
              <button className="btn btn-secondary" onClick={loadSamples}>
                <WandSparkles size={16} />
                Load sample labels
              </button>
            </div>
            <div className="chip-row">
              <span className="chip">OpenAI vision-backed extraction</span>
              <span className="chip">Batch upload queue</span>
              <span className="chip">TTB rule checks</span>
              <span className="chip">Simple layout for non-technical agents</span>
            </div>
          </div>

          <div className="metrics">
            <div className="metric">
              <div className="metric-label">Reviewed</div>
              <div className="metric-value">{stats.done}</div>
              <div className="metric-note">Images processed in this session.</div>
            </div>
            <div className="metric">
              <div className="metric-label">Outcomes</div>
              <div className="metric-value">{stats.pass}/{stats.review}/{stats.fail}</div>
              <div className="metric-note">Pass / needs review / fail.</div>
            </div>
            <div className="metric">
              <div className="metric-label">Setup</div>
              <div className="metric-value">1 key</div>
              <div className="metric-note">
                Configure <span className="inline-code">OPENAI_API_KEY</span> and deploy to a Node host.
              </div>
            </div>
          </div>
        </section>

        <section className="grid">
          <div>
            <div className="panel">
              <h2>Upload and review</h2>
              <p>
                Drag label photos onto the page or use the picker. The app queues files automatically
                and keeps the interface readable while it works.
              </p>

              <div
                className={`upload-area${dragging ? ' dragging' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={async (event) => {
                  event.preventDefault();
                  setDragging(false);
                  await handleFiles(event.dataTransfer.files);
                }}
                onClick={() => inputRef.current?.click()}
              >
                <div className="upload-copy">
                  <Files size={28} />
                  <h3>Drop label images here</h3>
                  <p>
                    JPG, PNG, or WebP. The review flow is optimized for quick visual inspection, so
                    one card per image keeps the queue understandable.
                  </p>
                </div>
              </div>

              <input
                ref={inputRef}
                className="file-input"
                type="file"
                accept="image/*"
                multiple
                onChange={async (event) => {
                  if (!event.target.files) return;
                  await handleFiles(event.target.files);
                  event.target.value = '';
                }}
              />

              <div className="sample-card">
                <h2 style={{ marginTop: 0 }}>Demo set</h2>
                <p>Use these to test the pipeline without sourcing images.</p>
                <div className="sample-grid">
                  {SAMPLE_LABELS.map((sample) => (
                    <div className="sample-item" key={sample.name}>
                      <div>
                        <strong>{sample.name}</strong>
                        <span>{sample.brand}</span>
                      </div>
                      <button
                        className="btn btn-tertiary"
                        onClick={async () => handleFiles([await svgToFile(sample)])}
                      >
                        Add sample
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="results">
            <div className="toolbar">
              <div>
                <h2>Review queue</h2>
                <p>{items.length} item{items.length === 1 ? '' : 's'} in the session.</p>
              </div>
              {busy && (
                <div className="badge review">
                  <Loader2 size={14} className="spinner" />
                  Processing
                </div>
              )}
            </div>

            <div className="results-grid">
              {items.length === 0 && (
                <div className="result-card" style={{ padding: 20 }}>
                  <p style={{ margin: 0, color: 'var(--muted)' }}>
                    No labels yet. Upload a batch or load the demo images to start.
                  </p>
                </div>
              )}

              {items.map((item) => (
                <article className="result-card" key={item.id}>
                  <header className="result-header">
                    <div className="result-title">
                      <h3>{item.name}</h3>
                      <p>
                        {item.status === 'queued' && 'Waiting for review'}
                        {item.status === 'uploading' && 'Sending to vision model'}
                        {item.status === 'done' && `Reviewed: ${item.analysis?.complianceScore ?? 0}% confidence score`}
                        {item.status === 'error' && 'Review failed'}
                      </p>
                    </div>
                    {item.status === 'done' && item.analysis && (
                      <div className={`badge ${item.analysis.status}`}>
                        {item.analysis.status === 'pass' && <CheckCircle2 size={14} />}
                        {item.analysis.status === 'review' && <AlertCircle size={14} />}
                        {item.analysis.status === 'fail' && <X size={14} />}
                        {item.analysis.status === 'pass' ? 'Pass' : item.analysis.status === 'review' ? 'Needs review' : 'Fail'}
                      </div>
                    )}
                    {item.status === 'uploading' && (
                      <div className="badge review">
                        <Loader2 size={14} className="spin-icon" />
                        In progress
                      </div>
                    )}
                    {item.status === 'error' && (
                      <div className="badge fail">
                        <AlertCircle size={14} />
                        Error
                      </div>
                    )}
                  </header>

                  <div className="result-body">
                    <div className="image-wrap">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="preview" src={item.preview} alt={item.name} />
                    </div>
                    <div className="details">
                      {item.status === 'done' && item.analysis ? (
                        <>
                          <div className="section">
                            <h4>Extracted fields</h4>
                            <div className="field-grid">
                              {[
                                ['Brand name', item.analysis.brandName],
                                ['Class / type', item.analysis.classType],
                                ['Alcohol content', item.analysis.alcoholContent],
                                ['Net contents', item.analysis.netContents],
                                ['Producer / bottler', item.analysis.producerName],
                                ['Producer address', item.analysis.producerAddress],
                                ['Country of origin', item.analysis.countryOfOrigin],
                                ['Government warning', item.analysis.governmentWarning],
                              ].map(([label, value]) => (
                                <div className="field" key={label}>
                                  <div className="field-label">{label}</div>
                                  <div className={`field-value${value ? '' : ' missing'}`}>
                                    {value ?? 'Not detected'}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="section">
                            <h4>Validation checks</h4>
                            <div className="checks">
                              {item.analysis.checks.map((check) => (
                                <div className="check" key={check.id}>
                                  <div className={`badge ${check.status}`}>
                                    {check.status}
                                  </div>
                                  <div>
                                    <strong>{check.label}</strong>
                                    <p>{check.detail}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="section">
                            <h4>Review notes</h4>
                            <div className="mini">
                              {item.analysis.notes.length > 0
                                ? item.analysis.notes.map((note, index) => <div key={`${note}-${index}`}>{note}</div>)
                                : 'No notes returned.'}
                          </div>
                        </div>
                        </>
                      ) : item.status === 'error' ? (
                        <div className="section">
                          <h4>Error</h4>
                          <p className="error">{item.error}</p>
                        </div>
                      ) : (
                        <div className="section">
                          <h4>Waiting</h4>
                          <p className="mini">This image will be reviewed automatically when it reaches the front of the queue.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

async function fileToPreview(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read image.'));
    reader.readAsDataURL(file);
  });
}

async function svgToFile(sample: {
  name: string;
  brand: string;
  classType: string;
  alc: string;
  contents: string;
  producer: string;
  address: string;
  warning: string;
}) {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
    <rect width="1200" height="1600" fill="#fbf7ef"/>
    <rect x="60" y="60" width="1080" height="1480" rx="34" fill="none" stroke="#2f2a24" stroke-width="8"/>
    <text x="600" y="210" text-anchor="middle" font-size="86" font-weight="800" fill="#241f1a" font-family="Georgia, serif">${escapeXml(sample.brand)}</text>
    <text x="600" y="330" text-anchor="middle" font-size="42" font-weight="600" fill="#5c513f" font-family="Arial, sans-serif">${escapeXml(sample.classType)}</text>
    <text x="600" y="470" text-anchor="middle" font-size="56" font-weight="800" fill="#241f1a" font-family="Arial, sans-serif">${escapeXml(sample.alc)}</text>
    <text x="600" y="560" text-anchor="middle" font-size="50" font-weight="700" fill="#241f1a" font-family="Arial, sans-serif">${escapeXml(sample.contents)}</text>
    <text x="600" y="760" text-anchor="middle" font-size="38" font-weight="600" fill="#3d3429" font-family="Arial, sans-serif">${escapeXml(sample.producer)}</text>
    <text x="600" y="820" text-anchor="middle" font-size="34" fill="#3d3429" font-family="Arial, sans-serif">${escapeXml(sample.address)}</text>
    <text x="600" y="1090" text-anchor="middle" font-size="28" font-weight="800" fill="#8a1c2f" font-family="Arial, sans-serif">${escapeXml(sample.warning)}</text>
  </svg>`;

  const blob = new Blob([svg], { type: 'image/svg+xml' });
  return new File([blob], `${sample.name.replace(/\s+/g, '-').toLowerCase()}.svg`, { type: 'image/svg+xml' });
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
