'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CirclePlus,
  Camera,
  Pencil,
  Download,
  Files,
  Loader2,
  RotateCcw,
  Settings2,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { normalizeFieldChecks, normalizeText, type LabelAnalysis } from '@/lib/ttb';
import { reviewLabelWithApiKey } from '@/lib/openai';
import { clearSession, loadSession, saveSession, type PersistedSession, type ReviewItemRecord } from '@/lib/session-store';

type ReviewItem = {
  id: string;
  batchId: string;
  projectId: string;
  sourceFilename: string;
  name: string;
  status: 'queued' | 'uploading' | 'done' | 'error';
  preview: string;
  imageDataUrl: string;
  mimeType: string;
  analysis?: LabelAnalysis;
  originalAnalysis?: LabelAnalysis;
  applicationFacts?: Record<string, string>;
  error?: string;
};

type AnalysisField = Exclude<keyof LabelAnalysis, 'notes' | 'checks'>;
type ProjectRecord = {
  id: string;
  name: string;
};

type BatchManifestItem = {
  imageFilename: string;
  imageDataUrl?: string;
  applicationFacts: Record<string, string>;
  analysis?: LabelAnalysis;
};

const FIELD_LABELS: Record<AnalysisField, string> = {
  brandName: 'Brand name',
  classType: 'Class / type',
  alcoholContent: 'Alcohol content',
  netContents: 'Net contents',
  producerName: 'Producer / bottler',
  producerAddress: 'Producer address',
  countryOfOrigin: 'Country of origin',
  governmentWarning: 'Government warning',
  complianceScore: 'Compliance score',
  status: 'Status',
};

const CORE_FIELDS: Array<Exclude<AnalysisField, 'complianceScore' | 'status'>> = [
  'brandName',
  'classType',
  'alcoholContent',
  'netContents',
  'producerName',
  'producerAddress',
  'countryOfOrigin',
  'governmentWarning',
];

const SAMPLE_LABELS = [
  {
    name: 'Old Tom Distillery - Bourbon',
    brand: 'OLD TOM DISTILLERY',
    classType: 'Kentucky Straight Bourbon Whiskey',
    alc: '45% Alc./Vol. (90 Proof)',
    contents: '750 mL',
    producer: 'Bottled by Old Tom Distilling Co.',
    address: 'Louisville, KY',
    warning:
      'GOVERNMENT WARNING: According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects.',
  },
  {
    name: 'Seabird Gin',
    brand: 'SEABIRD',
    classType: 'London Dry Gin',
    alc: '40% Alc./Vol.',
    contents: '1 L',
    producer: 'Produced by Seabird Spirits',
    address: 'Portland, OR',
    warning:
      'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.',
  },
  {
    name: 'Northfield Wine',
    brand: 'NORTHFIELD CELLARS',
    classType: 'California Red Wine',
    alc: '13.5% by volume',
    contents: '750 mL',
    producer: 'Bottled by Northfield Cellars, Inc.',
    address: 'Napa, CA',
    warning:
      'GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects.',
  },
];

const REQUIREMENTS = [
  {
    label: 'What to compare',
    value: 'Check the imported application facts against the label output. Blank application fields mean the manifest did not provide data.',
  },
  {
    label: 'Fast review',
    value: 'New labels flash green when added. The queue stays local, and the browser keeps the session state.',
  },
  {
    label: 'Export packet',
    value: 'Exported ZIPs carry the reviewed application JSON and images so the packet can be re-imported later.',
  },
  {
    label: 'COLA reminder',
    value: 'Keep the prototype standalone and use TTB checks as guidance, not a COLA integration.',
  },
];

const DEFAULT_PROJECT: ProjectRecord = {
  id: 'project-1',
  name: 'First Project',
};

export default function Home() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploadMode, setUploadMode] = useState<'images' | 'batch'>('images');
  const [codexApiKey, setCodexApiKey] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showControlPanel, setShowControlPanel] = useState(false);
  const [showAddLabelsForm, setShowAddLabelsForm] = useState(false);
  const [projects, setProjects] = useState<ProjectRecord[]>([DEFAULT_PROJECT]);
  const [selectedProjectId, setSelectedProjectId] = useState(DEFAULT_PROJECT.id);
  const [showManifestHelper, setShowManifestHelper] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [expandedPreview, setExpandedPreview] = useState(false);
  const [imageSourceMode, setImageSourceMode] = useState<'upload' | 'camera'>('upload');
  const [addToast, setAddToast] = useState<string | null>(null);
  const [newItemIds, setNewItemIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const batchImageInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const pendingBatchManifestRef = useRef<BatchManifestItem[]>([]);
  const pendingBatchImagesRef = useRef<File[]>([]);
  const batchUploadLockRef = useRef(false);
  const reviewQueueRef = useRef<Array<() => void>>([]);
  const activeReviewCountRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const addToastTimerRef = useRef<number | null>(null);
  const newItemTimerRef = useRef<number | null>(null);
  const apiKeyRef = useRef('');
  const lastClickedIndexRef = useRef<number | null>(null);
  const batchCounterRef = useRef(0);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? DEFAULT_PROJECT,
    [projects, selectedProjectId],
  );

  const projectItems = useMemo(
    () => items.filter((item) => item.projectId === activeProject.id),
    [activeProject.id, items],
  );

  const stats = useMemo(() => {
    const done = projectItems.filter((item) => item.status === 'done').length;
    const pass = projectItems.filter((item) => item.analysis?.status === 'pass').length;
    const review = projectItems.filter((item) => item.analysis?.status === 'review').length;
    const fail = projectItems.filter((item) => item.analysis?.status === 'fail').length;
    return { done, pass, review, fail };
  }, [projectItems]);

  const busy = useMemo(
    () => projectItems.some((item) => item.status === 'queued' || item.status === 'uploading'),
    [projectItems],
  );

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  const projectCounts = useMemo(
    () =>
      Object.fromEntries(
        projects.map((project) => [project.id, items.filter((item) => item.projectId === project.id).length]),
      ) as Record<string, number>,
    [items, projects],
  );

  useEffect(() => {
    setEditingTitle(false);
    setExpandedPreview(false);
  }, [selectedItemId]);

  useEffect(() => {
    setSelectedItemId(null);
    setSelectedIds([]);
    lastClickedIndexRef.current = null;
    setShowAddLabelsForm(false);
  }, [selectedProjectId]);

  useEffect(() => {
    return () => {
      if (addToastTimerRef.current) {
        window.clearTimeout(addToastTimerRef.current);
      }
      if (newItemTimerRef.current) {
        window.clearTimeout(newItemTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (uploadMode !== 'images' || imageSourceMode !== 'camera') {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;
      }
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = null;
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
        }
      } catch {
        setImageSourceMode('upload');
      }
    })();

    return () => {
      cancelled = true;
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;
      }
    };
  }, [imageSourceMode, uploadMode]);

  const selectedItems = useMemo(
    () => projectItems.filter((item) => selectedIds.includes(item.id)),
    [projectItems, selectedIds],
  );

  const allProjectSelected = projectItems.length > 0 && projectItems.every((item) => selectedIds.includes(item.id));
  const addSampleSet = async () => {
    const files = await Promise.all(SAMPLE_LABELS.map((sample) => svgToFile(sample)));
    await handleFiles(files);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    void (async () => {
      const session = await loadSession();
      if (session) {
        setCodexApiKey(session.codexApiKey ?? '');
        setUploadMode('images');
        setProjects(session.projects?.length ? session.projects : [DEFAULT_PROJECT]);
        setSelectedProjectId(session.currentProjectId ?? session.projects?.[0]?.id ?? DEFAULT_PROJECT.id);
        setItems((session.items ?? []).map((item) => normalizeItem(item)));
      }
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    apiKeyRef.current = codexApiKey;
  }, [codexApiKey]);

  useEffect(() => {
    if (typeof window === 'undefined' || !hydrated) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void saveSession({
        codexApiKey,
        outputFormat: 'json',
        currentProjectId: selectedProjectId,
        projects,
        items: items.map((item) => toPersistedItem(item)),
      });
    }, 250);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [codexApiKey, hydrated, items, projects, selectedProjectId]);

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (list.length === 0) return;
    const batchId = String(++batchCounterRef.current);
    const addedIds: string[] = [];

    for (const file of list) {
      const id = crypto.randomUUID();
      const reviewData = await prepareReviewImage(file);
      const compressedName = makeCompressedFilename(file.name);
      const queuedItem: ReviewItem = {
        id,
        batchId,
        projectId: activeProject.id,
        sourceFilename: compressedName,
        name: compressedName,
        status: 'queued',
        preview: reviewData.dataUrl,
        imageDataUrl: reviewData.dataUrl,
        mimeType: reviewData.mimeType,
      };
      addedIds.push(id);
      setItems((prev) => [queuedItem, ...prev]);
      scheduleReview(() => processFile(queuedItem));
    }

    announceAdded(list.length, addedIds);
  };

  const stageBatchImages = (files: FileList | File[]) => {
    const list = Array.from(files).filter((file) => file.type.startsWith('image/'));
    pendingBatchImagesRef.current = list;
    if (pendingBatchManifestRef.current.length > 0) {
      void uploadBatch();
    }
  };

  const uploadBatch = async () => {
    if (batchUploadLockRef.current) return;
    const manifestItems = pendingBatchManifestRef.current;
    const files = pendingBatchImagesRef.current;
    if (manifestItems.length === 0 || files.length === 0) return;

    batchUploadLockRef.current = true;
    const addedIds: string[] = [];

    const batchId = String(++batchCounterRef.current);
    const filesByName = new Map(
      files.map((file) => [file.name.toLowerCase(), file] as const),
    );

    const stagedFiles = manifestItems
      .map((manifestItem) => {
        const direct = filesByName.get(manifestItem.imageFilename.toLowerCase());
        if (direct) return { file: direct, manifestItem };

        const basename = manifestItem.imageFilename.replace(/\.[^.]+$/, '').toLowerCase();
        const fallback = files.find((file) => file.name.replace(/\.[^.]+$/, '').toLowerCase() === basename);
        if (!fallback) return null;
        return { file: fallback, manifestItem };
      })
      .filter((entry): entry is { file: File; manifestItem: BatchManifestItem } => Boolean(entry));

    if (stagedFiles.length === 0) {
      batchUploadLockRef.current = false;
      return;
    }

    for (const { file, manifestItem } of stagedFiles) {
      const id = crypto.randomUUID();
      const reviewData = await prepareReviewImage(file);
      const reviewAnalysis = manifestItem.analysis;
      const compressedName = makeCompressedFilename(manifestItem.imageFilename);
      const queuedItem: ReviewItem = {
        id,
        batchId,
        projectId: activeProject.id,
        sourceFilename: compressedName,
        name: reviewAnalysis ? buildReviewedName(reviewAnalysis, compressedName) : compressedName,
        status: reviewAnalysis ? 'done' : 'queued',
        preview: reviewData.dataUrl,
        imageDataUrl: reviewData.dataUrl,
        mimeType: reviewData.mimeType,
        applicationFacts: manifestItem.applicationFacts,
        analysis: reviewAnalysis,
        originalAnalysis: reviewAnalysis,
      };
      addedIds.push(id);
      setItems((prev) => [queuedItem, ...prev]);
      if (!reviewAnalysis) {
        scheduleReview(() => processFile(queuedItem));
      }
    }

    pendingBatchManifestRef.current = [];
    pendingBatchImagesRef.current = [];
    batchUploadLockRef.current = false;
    announceAdded(stagedFiles.length, addedIds);
  };

  const processFile = async (queuedItem: ReviewItem) => {
    setItems((prev) =>
      prev.map((entry) => (entry.id === queuedItem.id ? { ...entry, status: 'uploading' } : entry)),
    );

    try {
      if (!apiKeyRef.current) {
        throw new Error('Add your OpenAI API key first.');
      }

      const analysis = await reviewLabelWithApiKey(
        {
          filename: queuedItem.name,
          mimeType: queuedItem.mimeType,
          dataUrl: queuedItem.imageDataUrl,
        },
        apiKeyRef.current,
      );

      setItems((prev) =>
        prev.map((item) =>
          item.id === queuedItem.id
            ? {
                ...item,
                status: 'done',
                name: buildReviewedName(analysis, queuedItem.name),
                analysis,
                originalAnalysis: analysis,
              }
            : item,
        ),
      );
    } catch (error) {
      setItems((prev) =>
        prev.map((item) =>
          item.id === queuedItem.id
            ? { ...item, status: 'error', error: error instanceof Error ? error.message : 'Review failed' }
            : item,
        ),
      );
    }
  };

  const announceAdded = (count: number, ids: string[]) => {
    if (count <= 0) return;

    setAddToast(`${count} label${count === 1 ? '' : 's'} added`);
    setNewItemIds(ids);

    if (addToastTimerRef.current) {
      window.clearTimeout(addToastTimerRef.current);
    }
    if (newItemTimerRef.current) {
      window.clearTimeout(newItemTimerRef.current);
    }

    addToastTimerRef.current = window.setTimeout(() => {
      setAddToast(null);
    }, 2400);

    newItemTimerRef.current = window.setTimeout(() => {
      setNewItemIds([]);
    }, 2000);
  };

  const scheduleReview = (task: () => Promise<void>) => {
    const start = async () => {
      activeReviewCountRef.current += 1;
      try {
        await task();
      } finally {
        activeReviewCountRef.current = Math.max(0, activeReviewCountRef.current - 1);
        const next = reviewQueueRef.current.shift();
        if (next) {
          void next();
        }
      }
    };

    if (activeReviewCountRef.current < 2) {
      void start();
      return;
    }

    reviewQueueRef.current.push(start);
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.length === projectItems.length ? [] : projectItems.map((item) => item.id)));
  };

  const deleteItem = (itemId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== itemId));
    setSelectedIds((prev) => prev.filter((id) => id !== itemId));
    if (selectedItemId === itemId) {
      setSelectedItemId(null);
    }
    lastClickedIndexRef.current = null;
  };

  const toggleRowSelection = (itemId: string, index: number, shiftKey: boolean) => {
    setSelectedItemId(itemId);

    setSelectedIds((prev) => {
      if (shiftKey && lastClickedIndexRef.current !== null) {
        const start = Math.min(lastClickedIndexRef.current, index);
        const end = Math.max(lastClickedIndexRef.current, index);
        const rangeIds = projectItems.slice(start, end + 1).map((item) => item.id);
        return Array.from(new Set([...prev, ...rangeIds]));
      }

      if (prev.includes(itemId)) {
        return prev.filter((id) => id !== itemId);
      }

      return [...prev, itemId];
    });

    lastClickedIndexRef.current = index;
  };

  const handleRowClick = (event: { shiftKey: boolean }, itemId: string, index: number) => {
    toggleRowSelection(itemId, index, event.shiftKey);
  };

  const addProject = () => {
    const nextProject: ProjectRecord = {
      id: crypto.randomUUID(),
      name: `Project ${projects.length + 1}`,
    };
    setProjects((prev) => [...prev, nextProject]);
    setSelectedProjectId(nextProject.id);
    setSelectedItemId(null);
    setSelectedIds([]);
  };

  const importManifestFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as
        | Partial<PersistedSession>
        | Array<Record<string, unknown>>
        | {
            items?: Array<Record<string, unknown>>;
            labels?: Array<Record<string, unknown>>;
            application?: Record<string, string>;
          };
      const parsedSession = parsed as Partial<PersistedSession>;

      if (Array.isArray(parsedSession.projects)) {
        setProjects(parsedSession.projects.length ? parsedSession.projects : [DEFAULT_PROJECT]);
        setSelectedProjectId(parsedSession.currentProjectId ?? parsedSession.projects[0]?.id ?? DEFAULT_PROJECT.id);
      }

      if (typeof parsedSession.codexApiKey === 'string') {
        setCodexApiKey(parsedSession.codexApiKey);
      }

      const sourceItems = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { items?: unknown[] }).items)
          ? (parsed as { items?: unknown[] }).items
          : Array.isArray((parsed as { labels?: unknown[] }).labels)
            ? (parsed as { labels?: unknown[] }).labels
            : null;

      if (sourceItems) {
        const nextManifest = sourceItems.map((item) => {
          const manifestItem = isPlainObject(item) ? item : {};
          const applicationFacts = extractApplicationFacts(manifestItem);
          return {
            imageFilename: String(getManifestFilename(manifestItem) || 'untitled.png'),
            imageDataUrl: typeof manifestItem.imageDataUrl === 'string' ? manifestItem.imageDataUrl : undefined,
            applicationFacts,
            analysis: isPlainObject(manifestItem.analysis)
              ? (manifestItem.analysis as LabelAnalysis)
              : undefined,
          };
        });
        pendingBatchManifestRef.current = nextManifest;
      }

      setUploadMode('batch');
      setShowManifestHelper(false);
      if (pendingBatchImagesRef.current.length > 0) {
        void uploadBatch();
      }
    } catch {
      return;
    }
  };

  const importBatchPacket = async (file: File) => {
    try {
      const packet = await parseBatchPacket(file);
      pendingBatchManifestRef.current = packet.manifest;
      pendingBatchImagesRef.current = packet.images;
      setUploadMode('batch');
      setShowManifestHelper(false);
      void uploadBatch();
    } catch {
      return;
    }
  };

  const clearProjectItems = () => {
    setItems((prev) => prev.filter((item) => item.projectId !== activeProject.id));
    setSelectedIds([]);
    setSelectedItemId(null);
    lastClickedIndexRef.current = null;
  };

  const deleteProject = () => {
    if (projects.length <= 1 || activeProject.id === DEFAULT_PROJECT.id) return;

    const remainingProjects = projects.filter((project) => project.id !== activeProject.id);
    const nextProject = remainingProjects[0] ?? DEFAULT_PROJECT;

    setProjects(remainingProjects.length > 0 ? remainingProjects : [DEFAULT_PROJECT]);
    setSelectedProjectId(nextProject.id);
    setItems((prev) => prev.filter((item) => item.projectId !== activeProject.id));
    setSelectedIds([]);
    setSelectedItemId(null);
    lastClickedIndexRef.current = null;
  };

  const clearSavedState = () => {
    setItems([]);
    setCodexApiKey('');
    setUploadMode('images');
    setShowControlPanel(false);
    setShowManifestHelper(false);
    setSelectedItemId(null);
    setSelectedIds([]);
    setProjects([DEFAULT_PROJECT]);
    setSelectedProjectId(DEFAULT_PROJECT.id);
    setShowAddLabelsForm(false);
    apiKeyRef.current = '';
    activeReviewCountRef.current = 0;
    reviewQueueRef.current = [];
    batchCounterRef.current = 0;
    pendingBatchManifestRef.current = [];
    pendingBatchImagesRef.current = [];
    batchUploadLockRef.current = false;
    if (typeof window !== 'undefined') {
      void clearSession();
    }
  };

  const updateField = (itemId: string, field: AnalysisField, value: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId || !item.analysis) return item;
        const nextAnalysis = {
          ...item.analysis,
          [field]: field === 'status' ? (value as LabelAnalysis['status']) : field === 'complianceScore' ? Number(value || 0) : value,
        } as LabelAnalysis;

        return { ...item, analysis: nextAnalysis };
      }),
    );
  };

  const addNote = (itemId: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId || !item.analysis) return item;
        return {
          ...item,
          analysis: {
            ...item.analysis,
            notes: [...item.analysis.notes, ''],
          },
        };
      }),
    );
  };

  const updateNote = (itemId: string, index: number, value: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId || !item.analysis) return item;
        const notes = [...item.analysis.notes];
        notes[index] = value;
        return { ...item, analysis: { ...item.analysis, notes } };
      }),
    );
  };

  const removeNote = (itemId: string, index: number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId || !item.analysis) return item;
        const notes = item.analysis.notes.filter((_, noteIndex) => noteIndex !== index);
        return { ...item, analysis: { ...item.analysis, notes } };
      }),
    );
  };

  const resetAnalysis = (itemId: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId || !item.originalAnalysis) return item;
        return {
          ...item,
          analysis: {
            ...item.originalAnalysis,
            checks: normalizeFieldChecks(item.originalAnalysis),
          },
        };
      }),
    );
  };

  const getFieldCheck = (field: Exclude<AnalysisField, 'complianceScore' | 'status'>) => {
    const checks = selectedItem?.analysis?.checks ?? [];
    const fieldLabel = FIELD_LABELS[field];
    const normalizedFieldLabel = normalizeLabelKey(fieldLabel);
    const normalizedFieldKey = normalizeLabelKey(field);

    return (
      checks.find((check) => {
        const normalizedId = normalizeLabelKey(check.id);
        const normalizedLabel = normalizeLabelKey(check.label);
        return normalizedId === normalizedFieldKey || normalizedLabel === normalizedFieldLabel || normalizedLabel === normalizedFieldKey;
      }) ?? null
    );
  };

  const getFieldCheckState = (field: Exclude<AnalysisField, 'complianceScore' | 'status'>) => {
    const fieldCheck = getFieldCheck(field);
    if (fieldCheck) return fieldCheck;
    return {
      id: field,
      label: FIELD_LABELS[field],
      status: 'review' as const,
      detail: 'No explicit check returned. Mark pass or fail to continue.',
    };
  };

  const setFieldCheckStatus = (itemId: string, field: Exclude<AnalysisField, 'complianceScore' | 'status'>, status: 'pass' | 'fail') => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId || !item.analysis) return item;
        const nextChecks = item.analysis.checks.map((check) =>
          normalizeLabelKey(check.id) === normalizeLabelKey(field) ? { ...check, status } : check,
        );
        const updatedAnalysis = {
          ...item.analysis,
          checks: nextChecks,
        } as LabelAnalysis;
        if (field === 'countryOfOrigin' && status === 'pass') {
          updatedAnalysis.countryOfOrigin = updatedAnalysis.countryOfOrigin ?? null;
        }
        const score = nextChecks.reduce((acc, check) => {
          if (check.status === 'pass') return acc + 1;
          if (check.status === 'review') return acc + 0.45;
          return acc;
        }, 0);
        const complianceScore = Math.round((score / Math.max(1, nextChecks.length)) * 100);
        return {
          ...item,
          analysis: {
            ...updatedAnalysis,
            complianceScore,
            status: complianceScore >= 85 ? 'pass' : complianceScore >= 60 ? 'review' : 'fail',
          },
        };
      }),
    );
  };

  const exportSelected = () => {
    if (selectedItems.length === 0) return;
    void downloadBatchPacket(selectedItems);
  };

  const captureCameraFrame = async () => {
    const video = cameraVideoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    await handleFiles([new File([blob], `camera-${Date.now()}.png`, { type: 'image/png' })]);
  };

  return (
    <main className="page">
      {addToast && <div className="add-toast">{addToast}</div>}
      <div className="page-layout">
        <section className="container main-column">
          <header className="header">
            <h1>TTB Label Verifier</h1>
          </header>

          <div className="actions">
            <button className="btn btn-secondary" onClick={() => setShowControlPanel((prev) => !prev)}>
              <Settings2 size={16} />
              Control
            </button>
            <button className="btn btn-secondary" onClick={addSampleSet}>
              <WandSparkles size={16} />
              Add Samples
            </button>
          </div>

          <div className="project-bar">
            <div className="project-pills">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className={`project-pill${project.id === activeProject.id ? ' active' : ''}`}
                  onClick={() => {
                    setSelectedProjectId(project.id);
                    setSelectedItemId(null);
                    setSelectedIds([]);
                    lastClickedIndexRef.current = null;
                  }}
                >
                  <span className="project-pill-name">{project.name}</span>
                  <span className="project-pill-count">{projectCounts[project.id] ?? 0}</span>
                </button>
            ))}
              <button type="button" className="project-pill project-pill-add" onClick={addProject} aria-label="Add folder">
                +
              </button>
            </div>
            <div className="project-bar-actions">
              <button
                type="button"
                className="project-pill action clear"
                onClick={clearProjectItems}
                aria-label="Clear folder"
                disabled={projectItems.length === 0}
              >
                Clear folder
              </button>
              <button
                type="button"
                className="project-pill action clear"
                onClick={deleteProject}
                aria-label="Delete folder"
                disabled={projects.length <= 1 || activeProject.id === DEFAULT_PROJECT.id}
              >
                Delete folder
              </button>
            </div>
          </div>

          <div className="project-shell">
            {showAddLabelsForm && (
              <section className="upload-panel" aria-label="Queue form">
                <div className="upload-panel-head">
                  <div>
                    <strong>Add to Queue</strong>
                    <p>{uploadMode === 'images' ? 'Queue images for a single run.' : 'Queue images plus a batch manifest.'}</p>
                  </div>
                  <div className="segmented">
                    <button type="button" className={uploadMode === 'images' ? 'active' : ''} onClick={() => setUploadMode('images')}>
                      Image
                    </button>
                    <button type="button" className={uploadMode === 'batch' ? 'active' : ''} onClick={() => setUploadMode('batch')}>
                      Batch
                    </button>
                  </div>
                </div>

                {uploadMode === 'images' ? (
                  <form
                    className="upload-form"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (!inputRef.current?.files) return;
                      await handleFiles(inputRef.current.files);
                      inputRef.current.value = '';
                    }}
                  >
                    <div className="source-toggle segmented">
                      <button type="button" className={imageSourceMode === 'upload' ? 'active' : ''} onClick={() => setImageSourceMode('upload')}>
                        Image
                      </button>
                      <button type="button" className={imageSourceMode === 'camera' ? 'active' : ''} onClick={() => setImageSourceMode('camera')}>
                        <Camera size={14} />
                        Webcam
                      </button>
                    </div>
                    {imageSourceMode === 'upload' ? (
                      <label
                        className={`upload-area${dragging ? ' dragging' : ''}`}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={async (event) => {
                          event.preventDefault();
                          setDragging(false);
                          const dropped = Array.from(event.dataTransfer.files);
                          const zipFile = dropped.find((file) => isZipFile(file));
                          if (zipFile) {
                            await importBatchPacket(zipFile);
                            return;
                          }
                          stageBatchImages(dropped);
                        }}
                      >
                        <Files size={22} />
                        <div>
                          <strong>Choose images</strong>
                          <p>JPG, PNG, or WebP.</p>
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
                      </label>
                    ) : (
                      <div
                        className={`upload-area camera-area${dragging ? ' dragging' : ''}`}
                        onDragOver={(event) => {
                          event.preventDefault();
                        }}
                      >
                        <div className="camera-stage">
                          <video ref={cameraVideoRef} autoPlay playsInline muted />
                        </div>
                        <div className="camera-actions">
                          <button className="btn btn-secondary btn-small" type="button" onClick={() => setImageSourceMode('upload')}>
                            Back to upload
                          </button>
                          <button className="btn btn-primary btn-small" type="button" onClick={captureCameraFrame}>
                            Capture photo
                          </button>
                        </div>
                      </div>
                    )}
              </form>
                ) : (
                  <form className="upload-form">
                    <label
                      className={`upload-area${dragging ? ' dragging' : ''}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={async (event) => {
                        event.preventDefault();
                        setDragging(false);
                        const dropped = Array.from(event.dataTransfer.files);
                        const zipFile = dropped.find((file) => isZipFile(file));
                        if (zipFile) {
                          await importBatchPacket(zipFile);
                          return;
                        }
                        const manifestFile = dropped.find((file) => file.name.toLowerCase().endsWith('.json'));
                        if (manifestFile) {
                          const images = dropped.filter((file) => file !== manifestFile);
                          if (images.length > 0) {
                            stageBatchImages(images);
                          }
                          await importManifestFile(manifestFile);
                          return;
                        }
                        stageBatchImages(dropped);
                      }}
                    >
                      <Files size={22} />
                      <div>
                        <strong>Choose batch images</strong>
                        <p>Drop images, a manifest, or a ZIP packet.</p>
                      </div>
                      <input
                        ref={batchImageInputRef}
                        className="file-input"
                        type="file"
                        accept=".zip,.json,image/*"
                        multiple
                        onChange={async (event) => {
                          const files = Array.from(event.target.files ?? []);
                          if (files.length === 0) return;
                          const zipFile = files.find((file) => isZipFile(file));
                          if (zipFile) {
                            await importBatchPacket(zipFile);
                          } else {
                            const manifestFile = files.find((file) => file.name.toLowerCase().endsWith('.json'));
                            if (manifestFile) {
                              const images = files.filter((file) => file !== manifestFile);
                              if (images.length > 0) {
                                stageBatchImages(images);
                              }
                              await importManifestFile(manifestFile);
                            } else {
                              stageBatchImages(files);
                            }
                          }
                          event.target.value = '';
                        }}
                      />
                    </label>
                    <div className="control-actions">
                      <button className="btn btn-secondary btn-small" type="button" onClick={() => setShowManifestHelper(true)}>
                        <Files size={14} />
                        Batch Help
                      </button>
                      <button className="btn btn-primary btn-full" type="button" onClick={() => batchImageInputRef.current?.click()}>
                        Upload batch
                      </button>
                    </div>
                  </form>
                )}
              </section>
            )}

            <div className="summary">
              <span className="summary-badge pass">{stats.pass} pass</span>
              <span className="summary-badge review">{stats.review} review</span>
              <span className="summary-badge fail">{stats.fail} fail</span>
              {busy && (
                <span className="summary-busy">
                  <Loader2 size={14} className="spin-icon" />
                  Processing
                </span>
              )}
              <div className="summary-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small summary-action-btn"
                  onClick={() => setShowAddLabelsForm((prev) => !prev)}
                >
                  <Files size={14} />
                  Add Labels
                </button>
                <button
                  className="btn btn-secondary btn-small summary-action-btn"
                  onClick={exportSelected}
                  disabled={selectedItems.length === 0}
                  title={selectedItems.length === 0 ? 'Select one or more rows to export' : `Export ${selectedItems.length} selected rows`}
                >
                  <Download size={14} />
                  Export Information
                </button>
              </div>
            </div>

            <div className="queue">
              {projectItems.length === 0 ? (
                <p className="empty">No labels yet. Upload images or load the sample set.</p>
              ) : (
                <div className="table-wrap">
                  <table className="queue-table">
                  <thead>
                    <tr>
                      <th className="select-col">
                        <input type="checkbox" checked={allProjectSelected} onChange={toggleSelectAll} aria-label="Select all rows" />
                      </th>
                      <th>File</th>
                      <th>Status</th>
                      <th className="actions-col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectItems.map((item, index) => {
                      const analysis = item.analysis;
                      const score = item.status === 'done' && analysis ? analysis.complianceScore : null;
                      return (
                        <tr
                          key={item.id}
                          className={`${selectedIds.includes(item.id) ? 'selected' : ''} ${newItemIds.includes(item.id) ? 'newly-added' : ''} ${item.status === 'done' ? '' : item.status}`}
                          onClick={(event) => handleRowClick(event, item.id, index)}
                        >
                          <td className="select-col">
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(item.id)}
                                onChange={() => toggleRowSelection(item.id, index, false)}
                                onClick={(event) => event.stopPropagation()}
                                aria-label={`Select ${item.name}`}
                              />
                          </td>
                          <td>
                            <div className="file-cell">
                              <span className="file-name">{item.name}</span>
                              {item.status === 'uploading' ? (
                                <span className="file-subtle">Uploading</span>
                              ) : item.status === 'done' ? (
                                <span className="file-subtle">Ready for review</span>
                              ) : item.status === 'error' ? (
                                <span className="file-subtle error">{item.error}</span>
                              ) : (
                                <span className="file-subtle">Queued</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="status-cell">
                              {score !== null ? <span className="score-bubble">{score}</span> : null}
                              {item.status === 'done' && item.analysis ? (
                                <Badge status={item.analysis.status} />
                              ) : item.status === 'uploading' ? (
                                <span className="badge review">
                                  <Loader2 size={14} className="spin-icon" />
                                  In progress
                                </span>
                              ) : item.status === 'error' ? (
                                <span className="badge fail">
                                  <AlertCircle size={14} />
                                  Error
                                </span>
                              ) : (
                                <span className="badge review">
                                  <AlertCircle size={14} />
                                  Queued
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="actions-col">
                            <button
                              className="icon-btn delete-row-btn"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteItem(item.id);
                              }}
                              aria-label={`Delete ${item.name}`}
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {selectedItem && (
        <>
          <div className="drawer-backdrop" onClick={() => setSelectedItemId(null)} />
          <aside className={`drawer open${expandedPreview ? ' preview-open' : ''}`} onClick={(event) => event.stopPropagation()}>
            <div className="drawer-inner">
              <div className="drawer-head">
                <div className="drawer-title-wrap">
                  {editingTitle ? (
                    <input
                      className="drawer-title-input"
                      value={selectedItem.name}
                      onChange={(event) => {
                        const value = event.target.value;
                        setItems((prev) => prev.map((item) => (item.id === selectedItem.id ? { ...item, name: value } : item)));
                      }}
                      onBlur={() => setEditingTitle(false)}
                      autoFocus
                    />
                  ) : (
                    <h2>{selectedItem.name}</h2>
                  )}
                </div>
                <div className="drawer-head-actions">
                  <button className="icon-btn" type="button" onClick={() => setEditingTitle((prev) => !prev)} aria-label="Edit title" title="Edit title">
                    <Pencil size={14} />
                  </button>
                  <button className="icon-btn" type="button" onClick={() => resetAnalysis(selectedItem.id)} aria-label="Rescan" title="Rescan">
                    <RotateCcw size={14} />
                  </button>
                  <button className="icon-btn" type="button" onClick={() => deleteItem(selectedItem.id)} aria-label="Delete" title="Delete">
                    <Trash2 size={14} />
                  </button>
                  <button className="icon-btn" type="button" onClick={() => setSelectedItemId(null)} aria-label="Close">
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className={`drawer-preview${expandedPreview ? ' expanded' : ''}`} onClick={() => setExpandedPreview((prev) => !prev)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selectedItem.preview} alt={selectedItem.name} />
              </div>
              {expandedPreview && (
                <div className="preview-backdrop" onClick={() => setExpandedPreview(false)}>
                  <div className="preview-stage" onClick={(event) => event.stopPropagation()}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={selectedItem.preview} alt={selectedItem.name} />
                  </div>
                </div>
              )}

              {selectedItem.applicationFacts && Object.keys(selectedItem.applicationFacts).length > 0 && (
                <div className="drawer-application">
                  <div className="drawer-section-head">
                    <h3>Application facts</h3>
                  </div>
                  <table className="application-table">
                    <tbody>
                      {Object.entries(selectedItem.applicationFacts).map(([key, value]) => (
                        <tr key={key}>
                          <th>{key.replace(/[_-]+/g, ' ')}</th>
                          <td>{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedItem.status === 'done' && selectedItem.analysis ? (
                <>
                  <div className="drawer-output">
                    <div className="drawer-section-head">
                      <h3>Label : Output</h3>
                    </div>
                    <table className="detail-table">
                      <tbody>
                        {CORE_FIELDS.map((field) => (
                          <tr key={field} className="detail-full-row">
                            <td colSpan={2}>
                              {(() => {
                                const fieldCheck = getFieldCheckState(field);
                                const applicationValue = getApplicationFieldValue(field, selectedItem.applicationFacts);
                                return (
                                  <div className="detail-field-card">
                                    <span className="field-label">{FIELD_LABELS[field]}</span>
                                    <div className="field-stack">
                                      <div className="field-compare-row application">
                                        <span className="field-compare-label">Application</span>
                                        <div className="field-compare-value">{applicationValue || '-'}</div>
                                      </div>
                                      <div className="field-compare-row output">
                                        <span className="field-compare-label">Output</span>
                                        {(() => {
                                          const status = fieldCheck?.status ?? 'review';
                                          return (
                                            <input
                                              className={`field-value-input ${status}`}
                                              value={formatFieldValue(field, selectedItem.analysis?.[field] ?? '')}
                                              onChange={(event) => updateField(selectedItem.id, field, event.target.value)}
                                            />
                                          );
                                        })()}
                                      </div>
                                    </div>
                                    {fieldCheck && (
                                      <div className={`field-check detached ${fieldCheck.status}`}>
                                        <button
                                          type="button"
                                          className={`check-pill compact ${fieldCheck.status}`}
                                          aria-label={`${FIELD_LABELS[field]} ${fieldCheck.status}`}
                                        >
                                          {fieldCheck.status === 'pass' ? (
                                            <CheckCircle2 size={12} />
                                          ) : fieldCheck.status === 'review' ? (
                                            <AlertCircle size={12} />
                                          ) : (
                                            <X size={12} />
                                          )}
                                          <span>{fieldCheck.status === 'pass' ? 'Pass' : fieldCheck.status === 'review' ? 'Review' : 'Fail'}</span>
                                        </button>
                                        <div className="field-check-actions">
                                          <button type="button" onClick={() => setFieldCheckStatus(selectedItem.id, field, fieldCheck.status === 'pass' ? 'fail' : 'pass')}>
                                            {fieldCheck.status === 'pass' ? 'Fail' : 'Pass'}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                          </tr>
                        ))}
                        <tr className="detail-full-row">
                          <td colSpan={2}>
                            <div className="detail-field-card">
                              <span className="field-label">{FIELD_LABELS.complianceScore}</span>
                              <div className="score-row">
                                <span className="score-bubble">{selectedItem.analysis.complianceScore}</span>
                                <span className="score-static">Static</span>
                              </div>
                            </div>
                          </td>
                        </tr>
                        <tr className="detail-full-row">
                          <td colSpan={2}>
                            {(() => {
                              const analysis = selectedItem.analysis;
                              if (!analysis) return null;
                              return (
                                <div className="detail-field-card">
                                  <span className="field-label">{FIELD_LABELS.status}</span>
                                  <div className="detail-control-row">
                                    <div className={`field-check status-check ${analysis.status}`}>
                                      <button type="button" className="badge-control" aria-label={`Status ${analysis.status}`}>
                                        <Badge status={analysis.status} />
                                      </button>
                                      <div className="field-check-actions">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updateField(
                                              selectedItem.id,
                                              'status',
                                              analysis.status === 'pass' ? 'fail' : 'pass',
                                            )
                                          }
                                        >
                                          {analysis.status === 'pass' ? 'Fail' : 'Pass'}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="drawer-notes">
                    <div className="drawer-section-head">
                      <h3>Notes</h3>
                      <button className="btn btn-secondary btn-small" onClick={() => addNote(selectedItem.id)}>
                        <CirclePlus size={14} />
                        Add note
                      </button>
                    </div>
                    <div className="stack-list">
                      {selectedItem.analysis.notes.length === 0 ? (
                        <p className="muted">No notes yet.</p>
                      ) : (
                        selectedItem.analysis.notes.map((note, index) => (
                          <div className="stack-row" key={`${selectedItem.id}-note-${index}`}>
                            <input value={note} onChange={(event) => updateNote(selectedItem.id, index, event.target.value)} />
                            <button className="icon-btn detail-clear-btn" type="button" onClick={() => removeNote(selectedItem.id, index)}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="drawer-footer">
                    <button className="btn btn-secondary btn-small" onClick={() => resetAnalysis(selectedItem.id)}>
                      <RotateCcw size={14} />
                      Rescan
                    </button>
                  </div>
                </>
              ) : selectedItem.status === 'error' ? (
                <p className="error">{selectedItem.error}</p>
              ) : (
                <div className="drawer-footer">
                  <div className="drawer-mini-status">
                    <span className="badge review">
                      {selectedItem.status === 'uploading' ? <Loader2 size={14} className="spin-icon" /> : <AlertCircle size={14} />}
                      {selectedItem.status === 'uploading' ? 'In progress' : 'Queued'}
                    </span>
                  </div>
                  <button className="btn btn-secondary btn-small" onClick={() => resetAnalysis(selectedItem.id)}>
                    <RotateCcw size={14} />
                    Rescan
                  </button>
                </div>
              )}
            </div>
          </aside>
        </>
      )}

      {showControlPanel && (
        <div className="modal-backdrop" onClick={() => setShowControlPanel(false)}>
          <section className="modal-panel" onClick={(event) => event.stopPropagation()} aria-label="Control panel">
            <div className="control-header">
              <div>
                <div className="control-label">
                  <Settings2 size={14} />
                  Control panel
                </div>
                <p>Browser-only session state and local key storage.</p>
              </div>
              <button className="icon-btn" type="button" onClick={() => setShowControlPanel(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="control-grid">
              <label className="control-field">
                <span>Codex API key</span>
                <input
                  className="secret-input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={codexApiKey}
                  onChange={(event) => setCodexApiKey(event.target.value)}
                  placeholder="sk-..."
                  aria-label="Codex API key"
                />
              </label>
              <label className="control-field">
                <span>Saved state</span>
                <input value={`${items.length} items`} readOnly />
              </label>
            </div>

            <div className="control-actions">
              <button className="btn btn-secondary" type="button" onClick={clearSavedState}>
                <Trash2 size={14} />
                Clear saved state
              </button>
            </div>

            <div className="requirements">
              <div className="requirements-head">
                <strong>TTB / COLA reminders</strong>
                <span>Stand-alone prototype</span>
              </div>
              {REQUIREMENTS.map((requirement) => (
                <div className="requirement-item" key={requirement.label}>
                  <div className="requirement-label">{requirement.label}</div>
                  <div className="requirement-value">{requirement.value}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {showManifestHelper && (
        <div className="modal-backdrop" onClick={() => setShowManifestHelper(false)}>
          <section className="modal-panel manifest-helper" onClick={(event) => event.stopPropagation()} aria-label="Batch format example">
            <div className="control-header">
              <div>
                <div className="control-label">
                  <Files size={14} />
                  Batch file example
                </div>
                <p>Each item should include the image filename and application facts.</p>
              </div>
              <button className="icon-btn" type="button" onClick={() => setShowManifestHelper(false)}>
                <X size={14} />
              </button>
            </div>
            <pre className="json-example">{`[
  {
    "imageFilename": "maple-ridge.png",
    "applicationFacts": {
      "brand_name": "Maple Ridge",
      "class_type": "Bourbon Whiskey",
      "abv": "40% Alc./Vol.",
      "net_contents": "750 mL",
      "bottler_name": "Ridge Distilling",
      "bottler_address": "Burlington, VT",
      "beverage_type": "distilled spirits",
      "is_import": "false"
    }
  }
]`}</pre>
          </section>
        </div>
      )}
    </main>
  );
}

function Badge({ status }: { status: 'pass' | 'review' | 'fail' }) {
  return (
    <span className={`badge ${status}`}>
      {status === 'pass' && <CheckCircle2 size={14} />}
      {status === 'review' && <AlertCircle size={14} />}
      {status === 'fail' && <X size={14} />}
      {status === 'pass' ? 'Pass' : status === 'review' ? 'Needs review' : 'Fail'}
    </span>
  );
}

function normalizeItem(item: ReviewItemRecord, batchIdOverride?: string): ReviewItem {
  const analysis = item.analysis ? { ...item.analysis, checks: normalizeFieldChecks(item.analysis) } : item.analysis;
  const originalAnalysis = item.originalAnalysis ? { ...item.originalAnalysis, checks: normalizeFieldChecks(item.originalAnalysis) } : item.originalAnalysis;
  return {
    id: item.id,
    batchId: batchIdOverride ?? item.batchId ?? '1',
    projectId: item.projectId ?? DEFAULT_PROJECT.id,
    sourceFilename: item.sourceFilename ?? item.name,
    name: item.name,
    status: item.status,
    preview: item.preview || item.imageDataUrl,
    imageDataUrl: item.imageDataUrl || item.preview,
    mimeType: item.mimeType || 'image/png',
    analysis,
    originalAnalysis,
    applicationFacts: item.applicationFacts,
    error: item.error,
  };
}

function buildReviewedName(analysis: LabelAnalysis, fallback: string) {
  const parts = [analysis.brandName, analysis.classType, analysis.netContents]
    .map((value) => normalizeFilePart(value))
    .filter(Boolean) as string[];

  if (parts.length === 0) {
    return fallback;
  }

  return parts.join(' - ');
}

function normalizeFilePart(value: string | null | undefined) {
  const text = normalizeText(value);
  if (!text) return '';
  return text.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeLabelKey(value: string) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function formatFieldValue(field: AnalysisField, value: string) {
  if (!value) return '';
  if (field === 'netContents') {
    return value.replace(/\b([mM])[lL]\b/g, 'ml');
  }
  return value;
}

function getApplicationFieldValue(
  field: Exclude<AnalysisField, 'complianceScore' | 'status'>,
  facts?: Record<string, string>,
) {
  if (!facts) return '';
  const keyMap: Record<Exclude<AnalysisField, 'complianceScore' | 'status'>, string[]> = {
    brandName: ['brand_name', 'brandname', 'brand'],
    classType: ['class_type', 'classtype', 'class/type', 'class', 'type', 'beverage_type'],
    alcoholContent: ['abv', 'alcohol_content', 'alcoholcontent', 'proof', 'alcvol', 'alcoholbyvolume'],
    netContents: ['net_contents', 'netcontents', 'contents', 'volume'],
    producerName: ['bottler_name', 'producer_name', 'producername', 'bottler', 'producer', 'distiller'],
    producerAddress: ['bottler_address', 'producer_address', 'produceraddress', 'address', 'location'],
    countryOfOrigin: ['country_of_origin', 'countryoforigin', 'origin', 'import', 'imports'],
    governmentWarning: ['government_warning', 'governmentwarning', 'warning', 'healthwarning', 'health_warning'],
  };

  for (const key of keyMap[field]) {
    const raw = facts[key];
    if (typeof raw === 'string' && raw.trim()) {
      return formatFieldValue(field, raw.trim());
    }
  }

  const normalizedTargets = keyMap[field].map((key) => normalizeLabelKey(key));
  for (const [key, raw] of Object.entries(facts)) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    if (normalizedTargets.includes(normalizeLabelKey(key))) {
      return formatFieldValue(field, raw.trim());
    }
  }

  const broadHints: Record<Exclude<AnalysisField, 'complianceScore' | 'status'>, string[]> = {
    brandName: ['brand'],
    classType: ['class', 'type', 'beverage'],
    alcoholContent: ['abv', 'alcohol', 'proof'],
    netContents: ['net', 'content', 'volume'],
    producerName: ['bottler', 'producer', 'distiller'],
    producerAddress: ['address', 'location'],
    countryOfOrigin: ['origin', 'country', 'import'],
    governmentWarning: ['warning', 'health'],
  };

  const hints = broadHints[field];
  for (const [key, raw] of Object.entries(facts)) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const normalizedKey = normalizeLabelKey(key);
    if (hints.some((hint) => normalizedKey.includes(hint))) {
      return formatFieldValue(field, raw.trim());
    }
  }

  return '';
}

function extractApplicationFacts(source: Record<string, unknown>) {
  const facts: Record<string, string> = {};
  const reservedKeys = new Set([
    'imageFilename',
    'imageDataUrl',
    'applicationFacts',
    'application',
    'name',
    'id',
    'projectId',
    'batchId',
    'status',
    'preview',
    'mimeType',
    'analysis',
    'originalAnalysis',
    'error',
    'sourceFilename',
    'complianceScore',
  ]);

  const collect = (value: unknown) => {
    if (!isPlainObject(value)) return;
    for (const [key, raw] of Object.entries(value)) {
      if (reservedKeys.has(key)) {
        if ((key === 'applicationFacts' || key === 'application') && isPlainObject(raw)) {
          collect(raw);
        }
        continue;
      }
      if (typeof raw === 'string') {
        const text = raw.trim();
        if (text) facts[key] = text;
      } else if (typeof raw === 'number' || typeof raw === 'boolean') {
        facts[key] = String(raw);
      } else if (isPlainObject(raw)) {
        collect(raw);
      }
    }
  };

  collect(source);

  return facts;
}

function getManifestFilename(source: Record<string, unknown>) {
  const candidates = [
    source.imageFilename,
    source.name,
    isPlainObject(source.applicationFacts) ? source.applicationFacts.imageFilename : undefined,
    isPlainObject(source.application) ? source.application.imageFilename : undefined,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function rasterizeSvgDataUrl(dataUrl: string) {
  const image = await loadImageFromDataUrl(dataUrl);
  const width = image.naturalWidth || 1200;
  const height = image.naturalHeight || 1600;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is not available.');
  }

  context.drawImage(image, 0, 0, width, height);

  return {
    dataUrl: canvas.toDataURL('image/png'),
    mimeType: 'image/png',
  };
}

async function prepareReviewImage(file: File) {
  const dataUrl = await fileToDataUrl(file);
  const sourceDataUrl = file.type === 'image/svg+xml' ? (await rasterizeSvgDataUrl(dataUrl)).dataUrl : dataUrl;
  return compressImageDataUrl(sourceDataUrl);
}

async function compressImageDataUrl(
  dataUrl: string,
  options = { maxWidth: 768, maxHeight: 768, quality: 0.82 },
) {
  const image = await loadImageFromDataUrl(dataUrl);
  const width = image.naturalWidth || 1;
  const height = image.naturalHeight || 1;
  const scale = Math.min(options.maxWidth / width, options.maxHeight / height, 1);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is not available.');
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  return {
    dataUrl: canvas.toDataURL('image/jpeg', options.quality),
    mimeType: 'image/jpeg',
  };
}

async function loadImageFromDataUrl(dataUrl: string) {
  const image = new Image();
  image.decoding = 'async';

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to load image.'));
    image.src = dataUrl;
  });

  return image;
}

function toPersistedItem(item: ReviewItem): ReviewItemRecord {
  return {
    id: item.id,
    batchId: item.batchId,
    projectId: item.projectId,
    sourceFilename: item.sourceFilename,
    name: item.name,
    status: item.status,
    preview: item.preview,
    imageDataUrl: item.imageDataUrl,
    mimeType: item.mimeType,
    analysis: item.analysis,
    originalAnalysis: item.originalAnalysis,
    applicationFacts: item.applicationFacts,
    error: item.error,
  };
}

async function downloadBatchPacket(items: ReviewItem[]) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const manifest = buildBatchManifest(items);
  const files = [
    {
      name: 'manifest.json',
      data: textToBytes(JSON.stringify(manifest, null, 2)),
    },
    ...items
      .filter((item) => Boolean(item.imageDataUrl))
      .map((item) => ({
        name: safeZipFilename(item.sourceFilename || item.name || `${item.id}.${mimeToExtension(item.mimeType)}`),
        data: dataUrlToBytes(item.imageDataUrl),
      })),
  ];

  const blob = createZipBlob(files);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ttb-label-verifier-${timestamp}.zip`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildBatchManifest(items: ReviewItem[]) {
  return items.map((item) => ({
    imageFilename: safeZipFilename(item.sourceFilename || item.name || `${item.id}.${mimeToExtension(item.mimeType)}`),
    applicationFacts: buildExportApplicationFacts(item),
    analysis: item.analysis
      ? {
          ...item.analysis,
          complianceScore: item.analysis.complianceScore,
          status: item.analysis.status,
        }
      : undefined,
  }));
}

function buildExportApplicationFacts(item: ReviewItem) {
  const facts: Record<string, string> = {
    ...(item.applicationFacts ?? {}),
  };

  const analysis = item.analysis;
  if (!analysis) {
    return facts;
  }

  const reviewFacts: Record<string, string> = {};
  const setIfPresent = (key: string, value: string | null) => {
    if (typeof value !== 'string') return;
    const text = normalizeText(value);
    if (text) {
      reviewFacts[key] = text;
    }
  };

  setIfPresent('brand_name', analysis.brandName);
  setIfPresent('class_type', analysis.classType);
  setIfPresent('abv', analysis.alcoholContent);
  setIfPresent('net_contents', analysis.netContents);
  setIfPresent('bottler_name', analysis.producerName);
  setIfPresent('bottler_address', analysis.producerAddress);
  setIfPresent('country_of_origin', analysis.countryOfOrigin);
  setIfPresent('government_warning', analysis.governmentWarning);

  return {
    ...facts,
    ...reviewFacts,
  };
}

function safeZipFilename(value: string) {
  const normalized = value.replace(/\\/g, '/').trim();
  const filename = normalized.split('/').filter(Boolean).pop() ?? normalized;
  return filename.replace(/[<>:"|?*\u0000]/g, '_');
}

function isSafeZipEntryName(value: string) {
  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return false;
  if (normalized.includes('..') || normalized.includes(':')) return false;
  const segments = normalized.split('/').filter(Boolean);
  return segments.length === 1 && segments[0] === normalized;
}

function mimeToExtension(mimeType: string | undefined) {
  if (!mimeType) return 'bin';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/svg+xml') return 'png';
  return 'bin';
}

function dataUrlToBytes(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function textToBytes(value: string) {
  return new TextEncoder().encode(value);
}

function createZipBlob(files: Array<{ name: string; data: Uint8Array }>) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const [dosTime, dosDate] = toDosDateTime(new Date());

  for (const file of files) {
    const nameBytes = textToBytes(file.name);
    const crc = crc32(file.data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, dosTime);
    writeUint16(localView, 12, dosDate);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, file.data.length);
    writeUint32(localView, 22, file.data.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, file.data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, dosTime);
    writeUint16(centralView, 14, dosDate);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, file.data.length);
    writeUint32(centralView, 24, file.data.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + file.data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const centralOffset = localParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralSize);
  writeUint32(endView, 16, centralOffset);
  writeUint16(endView, 20, 0);

  const blobParts: BlobPart[] = [
    ...localParts.map(toArrayBufferPart),
    ...centralParts.map(toArrayBufferPart),
    toArrayBufferPart(endRecord),
  ];

  return new Blob(blobParts, { type: 'application/zip' });
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

function toArrayBufferPart(part: Uint8Array) {
  return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    (Math.floor(date.getSeconds() / 2) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return [dosTime, dosDate] as const;
}

async function parseBatchPacket(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const manifest: BatchManifestItem[] = [];
  const images: File[] = [];
  const maxEntries = 500;
  let entryCount = 0;

  let offset = 0;
  while (offset + 30 <= bytes.length) {
    if (entryCount >= maxEntries) {
      throw new Error('ZIP packet contains too many files.');
    }
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;

    const compression = view.getUint16(offset + 8, true);
    if (compression !== 0) {
      throw new Error('Unsupported ZIP compression method.');
    }

    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    if (dataStart + compressedSize > bytes.length) {
      throw new Error('ZIP packet is malformed.');
    }
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength)).replace(/\\/g, '/').trim();
    if (!isSafeZipEntryName(name)) {
      throw new Error('ZIP packet contains an unsafe file path.');
    }
    const data = bytes.slice(dataStart, dataStart + compressedSize);

    if (name.toLowerCase() === 'manifest.json') {
      const parsed = JSON.parse(decoder.decode(data)) as
        | Array<{
            imageFilename: string;
            applicationFacts?: Record<string, unknown>;
            application?: Record<string, unknown>;
            analysis?: Record<string, unknown>;
          }>
        | {
          items?: Array<{
            imageFilename: string;
            applicationFacts?: Record<string, unknown>;
            application?: Record<string, unknown>;
            analysis?: Record<string, unknown>;
          }>;
          labels?: Array<{
            imageFilename: string;
            applicationFacts?: Record<string, unknown>;
            application?: Record<string, unknown>;
            analysis?: Record<string, unknown>;
          }>;
        };
      const packetItems = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.items)
          ? parsed.items
          : Array.isArray(parsed.labels)
            ? parsed.labels
            : [];
      manifest.push(
        ...packetItems.map((item) => ({
          imageFilename: safeZipFilename(getManifestFilename(item as Record<string, unknown>) || 'untitled.png'),
          applicationFacts: extractApplicationFacts(item as Record<string, unknown>),
          analysis: isPlainObject(item) && isPlainObject(item.analysis)
            ? (item.analysis as LabelAnalysis)
            : undefined,
        })),
      );
    } else if (data.length > 0 || uncompressedSize > 0) {
      const mimeType = mimeFromFilename(name);
      images.push(new File([data], safeZipFilename(name), { type: mimeType }));
    }

    entryCount += 1;
    offset = dataStart + compressedSize;
  }

  if (manifest.length === 0) {
    throw new Error('manifest.json not found in ZIP packet.');
  }

  return { manifest, images };
}

function mimeFromFilename(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function isZipFile(file: File) {
  return file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip');
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read image.'));
    reader.readAsDataURL(file);
  });
}

function makeCompressedFilename(filename: string) {
  const base = filename.replace(/\.[^.]+$/, '');
  const cleaned = normalizeFilePart(base) || 'label';
  return `${cleaned}.jpg`;
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
