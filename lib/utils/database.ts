import Dexie, { type EntityTable } from 'dexie';
import type { Scene, SceneType, SceneContent, Whiteboard, VideoManifest } from '@/lib/types/stage';
import type { Action } from '@/lib/types/action';
import type {
  SessionType,
  SessionStatus,
  SessionConfig,
  ToolCallRecord,
  ToolCallRequest,
} from '@/lib/types/chat';
import type { SceneOutline } from '@/lib/types/generation';
import type { UIMessage } from 'ai';
import type { QuestionResult } from '@/lib/quiz/grading';
import {
  DRAFT_KEY_PREFIX,
  ANSWERS_KEY_PREFIX,
  RESULTS_KEY_PREFIX,
} from '@/lib/quiz/persistence';
import { createLogger } from '@/lib/logger';

const log = createLogger('Database');

/**
 * Legacy Snapshot type for undo/redo functionality
 * Used by useSnapshotStore
 */
export interface Snapshot {
  id?: number;
  index: number;
  slides: Scene[];
}

/**
 * MAIC Local Database
 *
 * Uses IndexedDB to store all user data locally
 * - Does not delete expired data; all data is stored permanently
 * - Uses a fixed database name
 * - Supports multi-course management
 */

// ==================== Database Table Type Definitions ====================

/**
 * Stage table - Course basic info
 */
export interface StageRecord {
  id: string; // Primary key
  name: string;
  description?: string;
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
  languageDirective?: string;
  style?: string;
  currentSceneId?: string;
  agentIds?: string[]; // Agent IDs selected at creation time
  videoManifest?: VideoManifest; // Generated video request manifest; non-indexed
  interactiveMode?: boolean; // Interactive Mode flag; non-indexed
}

/**
 * Scene table - Scene/page data
 */
export interface SceneRecord {
  id: string; // Primary key
  stageId: string; // Foreign key -> stages.id
  type: SceneType;
  title: string;
  order: number; // Display order
  content: SceneContent; // Stored as JSON
  actions?: Action[]; // Stored as JSON
  whiteboard?: Whiteboard[]; // Stored as JSON
  createdAt: number;
  updatedAt: number;
}

/**
 * AudioFile table - Audio files (TTS)
 */
export interface AudioFileRecord {
  id: string; // Primary key (audioId)
  blob: Blob; // Audio binary data
  duration?: number; // Duration (seconds)
  format: string; // mp3, wav, etc.
  text?: string; // Corresponding text content
  voice?: string; // Voice used
  createdAt: number;
  ossKey?: string; // Full CDN URL for this audio blob
}

/**
 * ImageFile table - Image files
 */
export interface ImageFileRecord {
  id: string; // Primary key
  blob: Blob; // Image binary data
  filename: string; // Original filename
  mimeType: string; // image/png, image/jpeg, etc.
  size: number; // File size (bytes)
  createdAt: number;
}

/**
 * ChatSession table - Chat session data
 */
export interface ChatSessionRecord {
  id: string; // PK (session id)
  stageId: string; // FK -> stages.id
  type: SessionType;
  title: string;
  status: SessionStatus;
  messages: UIMessage[]; // JSON-safe serialized messages
  config: SessionConfig;
  toolCalls: ToolCallRecord[];
  pendingToolCalls: ToolCallRequest[];
  createdAt: number;
  updatedAt: number;
  sceneId?: string;
  lastActionIndex?: number;
}

/**
 * PlaybackState table - Playback state snapshot (at most one per stage)
 */
export interface PlaybackStateRecord {
  stageId: string; // PK
  sceneIndex: number;
  actionIndex: number;
  consumedDiscussions: string[];
  updatedAt: number;
}

/**
 * StageOutlines table - Persisted outlines for resume-on-refresh
 */
export interface StageOutlinesRecord {
  stageId: string; // Primary key (FK -> stages.id)
  outlines: SceneOutline[];
  createdAt: number;
  updatedAt: number;
}

/**
 * MediaFile table - AI-generated media files (images/videos)
 */
export interface MediaFileRecord {
  id: string; // Compound key: `${stageId}:${elementId}`
  stageId: string; // FK → stages.id
  type: 'image' | 'video';
  blob: Blob; // Media binary
  mimeType: string; // image/png, video/mp4
  size: number;
  poster?: Blob; // Video thumbnail blob
  prompt: string; // Original prompt (for retry)
  params: string; // JSON-serialized generation params
  error?: string; // If set, this is a failed task (blob is empty placeholder)
  errorCode?: string; // Structured error code (e.g. 'CONTENT_SENSITIVE')
  ossKey?: string; // Full CDN URL for this media blob
  posterOssKey?: string; // Full CDN URL for the poster blob
  createdAt: number;
}

/**
 * GeneratedAgent table - AI-generated agent profiles
 */
export interface GeneratedAgentRecord {
  id: string; // PK: agent ID (e.g. "gen-abc123")
  stageId: string; // FK -> stages.id
  name: string;
  role: string; // 'teacher' | 'assistant' | 'student'
  persona: string;
  avatar: string;
  color: string;
  priority: number;
  createdAt: number;
}

/**
 * VoiceProfile table - Browser-local TTS voice profiles
 */
export interface VoiceProfileRecord {
  id: string;
  providerId: string;
  kind: 'prompt' | 'clone';
  name: string;
  voicePrompt?: string;
  promptText?: string;
  referenceAudio?: Blob;
  referenceAudioName?: string;
  referenceAudioMimeType?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * ScenarioDialogueSession table - Scenario dialogue session data
 */
export interface ScenarioDialogueSessionRecord {
  id: string;
  stageId: string;
  sceneId: string;
  topic: string;
  historicalBackground: string;
  messages: ScenarioDialogueMessageRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface ScenarioDialogueMessageRecord {
  id: string;
  speakerId: string;
  speakerName: string;
  speakerRole: string;
  speakerColor: string;
  content: string;
  timestamp: number;
}

/** Build the compound primary key for mediaFiles: `${stageId}:${elementId}` */
export function mediaFileKey(stageId: string, elementId: string): string {
  return `${stageId}:${elementId}`;
}

// ==================== Database Definition ====================

const DATABASE_NAME = 'MAIC-Database';
const _DATABASE_VERSION = 11;

/**
 * MAIC Database Instance
 */
class MAICDatabase extends Dexie {
  // Table definitions
  stages!: EntityTable<StageRecord, 'id'>;
  scenes!: EntityTable<SceneRecord, 'id'>;
  audioFiles!: EntityTable<AudioFileRecord, 'id'>;
  imageFiles!: EntityTable<ImageFileRecord, 'id'>;
  snapshots!: EntityTable<Snapshot, 'id'>; // Undo/redo snapshots (legacy)
  chatSessions!: EntityTable<ChatSessionRecord, 'id'>;
  playbackState!: EntityTable<PlaybackStateRecord, 'stageId'>;
  stageOutlines!: EntityTable<StageOutlinesRecord, 'stageId'>;
  mediaFiles!: EntityTable<MediaFileRecord, 'id'>;
  generatedAgents!: EntityTable<GeneratedAgentRecord, 'id'>;
  voiceProfiles!: EntityTable<VoiceProfileRecord, 'id'>;
  scenarioDialogueSessions!: EntityTable<ScenarioDialogueSessionRecord, 'id'>;

  constructor() {
    super(DATABASE_NAME);

    // Version 1: Initial schema
    this.version(1).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      // Previously had: messages, participants, discussions, sceneSnapshots
    });

    // Version 2: Remove unused tables
    this.version(2).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      // Delete removed tables
      messages: null,
      participants: null,
      discussions: null,
      sceneSnapshots: null,
    });

    // Version 3: Add chatSessions and playbackState tables
    this.version(3).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
    });

    // Version 4: Add stageOutlines table for resume-on-refresh
    this.version(4).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
    });

    // Version 5: Add mediaFiles table for async media generation
    this.version(5).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
    });

    // Version 6: Fix mediaFiles primary key — use compound key stageId:elementId
    // to prevent cross-course collisions (gen_img_1 is NOT globally unique)
    this.version(6)
      .stores({
        stages: 'id, updatedAt',
        scenes: 'id, stageId, order, [stageId+order]',
        audioFiles: 'id, createdAt',
        imageFiles: 'id, createdAt',
        snapshots: '++id',
        chatSessions: 'id, stageId, [stageId+createdAt]',
        playbackState: 'stageId',
        stageOutlines: 'stageId',
        mediaFiles: 'id, stageId, [stageId+type]',
      })
      .upgrade(async (tx) => {
        const table = tx.table('mediaFiles');
        const allRecords = await table.toArray();
        for (const rec of allRecords) {
          const newKey = `${rec.stageId}:${rec.id}`;
          // Skip if already migrated (idempotent)
          if (rec.id.includes(':')) continue;
          await table.delete(rec.id);
          await table.put({ ...rec, id: newKey });
        }
      });

    // Version 7: Add ossKey fields to mediaFiles and audioFiles for OSS storage plugin
    // Non-indexed optional fields — Dexie handles these transparently.
    this.version(7).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
    });

    // Version 8: Add generatedAgents table for AI-generated agent profiles
    this.version(8).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
      generatedAgents: 'id, stageId',
    });

    // Version 9: Migrate legacy `language` field to `languageDirective`
    // Old stages stored a BCP-47 locale code (e.g. "zh-CN"); new code expects a
    // natural-language directive. Convert known locales and drop the old field.
    const LOCALE_TO_DIRECTIVE: Record<string, string> = {
      'zh-CN': 'Deliver the entire course in Chinese (Simplified, zh-CN).',
      'en-US': 'Deliver the entire course in English (en-US).',
      'ja-JP': 'Deliver the entire course in Japanese (ja-JP).',
      'ru-RU': 'Deliver the entire course in Russian (ru-RU).',
    };
    this.version(9)
      .stores({
        stages: 'id, updatedAt',
        scenes: 'id, stageId, order, [stageId+order]',
        audioFiles: 'id, createdAt',
        imageFiles: 'id, createdAt',
        snapshots: '++id',
        chatSessions: 'id, stageId, [stageId+createdAt]',
        playbackState: 'stageId',
        stageOutlines: 'stageId',
        mediaFiles: 'id, stageId, [stageId+type]',
        generatedAgents: 'id, stageId',
      })
      .upgrade(async (tx) => {
        const table = tx.table('stages');
        await table.toCollection().modify((stage: Record<string, unknown>) => {
          const lang = stage.language as string | undefined;
          if (lang && !stage.languageDirective) {
            stage.languageDirective =
              LOCALE_TO_DIRECTIVE[lang] || `Deliver the entire course in ${lang}.`;
          }
          delete stage.language;
        });
      });

    // Version 10: Add browser-local voice profiles for serverless TTS voice storage.
    this.version(10).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
      generatedAgents: 'id, stageId',
      voiceProfiles: 'id, providerId, kind, updatedAt',
    });

    // Version 11: Add scenarioDialogueSessions table for scenario dialogue persistence
    this.version(11).stores({
      stages: 'id, updatedAt',
      scenes: 'id, stageId, order, [stageId+order]',
      audioFiles: 'id, createdAt',
      imageFiles: 'id, createdAt',
      snapshots: '++id',
      chatSessions: 'id, stageId, [stageId+createdAt]',
      playbackState: 'stageId',
      stageOutlines: 'stageId',
      mediaFiles: 'id, stageId, [stageId+type]',
      generatedAgents: 'id, stageId',
      voiceProfiles: 'id, providerId, kind, updatedAt',
      scenarioDialogueSessions: 'id, stageId, sceneId, [stageId+createdAt]',
    });
  }
}

// Create database instance
export const db = new MAICDatabase();

// ==================== Helper Functions ====================

/**
 * Initialize database
 * Call at application startup
 */
export async function initDatabase(): Promise<void> {
  try {
    await db.open();
    // Request persistent storage to prevent browser from evicting IndexedDB
    // under storage pressure (large media blobs can trigger LRU cleanup)
    void navigator.storage?.persist?.();
    log.info('Database initialized successfully');
  } catch (error) {
    log.error('Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Clear database (optional)
 * Use with caution: deletes all data
 */
export async function clearDatabase(): Promise<void> {
  await db.delete();
  log.info('Database cleared');
}

/**
 * Export database contents (for backup / data mining)
 *
 * Includes all tables relevant to classroom analysis:
 * stages, scenes, chatSessions, scenarioDialogueSessions,
 * stageOutlines, generatedAgents, playbackState
 */
export async function exportDatabase(): Promise<{
  stages: StageRecord[];
  scenes: SceneRecord[];
  chatSessions: ChatSessionRecord[];
  scenarioDialogueSessions: ScenarioDialogueSessionRecord[];
  stageOutlines: StageOutlinesRecord[];
  generatedAgents: GeneratedAgentRecord[];
  playbackState: PlaybackStateRecord[];
}> {
  return {
    stages: await db.stages.toArray(),
    scenes: await db.scenes.toArray(),
    chatSessions: await db.chatSessions.toArray(),
    scenarioDialogueSessions: await db.scenarioDialogueSessions.toArray(),
    stageOutlines: await db.stageOutlines.toArray(),
    generatedAgents: await db.generatedAgents.toArray(),
    playbackState: await db.playbackState.toArray(),
  };
}

/**
 * Import database contents (for restoring backups)
 */
export async function importDatabase(data: {
  stages?: StageRecord[];
  scenes?: SceneRecord[];
  chatSessions?: ChatSessionRecord[];
  scenarioDialogueSessions?: ScenarioDialogueSessionRecord[];
  stageOutlines?: StageOutlinesRecord[];
  generatedAgents?: GeneratedAgentRecord[];
  playbackState?: PlaybackStateRecord[];
}): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.stages,
      db.scenes,
      db.chatSessions,
      db.scenarioDialogueSessions,
      db.stageOutlines,
      db.generatedAgents,
      db.playbackState,
    ],
    async () => {
      if (data.stages) await db.stages.bulkPut(data.stages);
      if (data.scenes) await db.scenes.bulkPut(data.scenes);
      if (data.chatSessions) await db.chatSessions.bulkPut(data.chatSessions);
      if (data.scenarioDialogueSessions)
        await db.scenarioDialogueSessions.bulkPut(data.scenarioDialogueSessions);
      if (data.stageOutlines) await db.stageOutlines.bulkPut(data.stageOutlines);
      if (data.generatedAgents) await db.generatedAgents.bulkPut(data.generatedAgents);
      if (data.playbackState) await db.playbackState.bulkPut(data.playbackState);
    },
  );
  log.info('Database imported successfully');
}

// ==================== Stage Data Export (for data mining) ====================

export interface QuizExportEntry {
  sceneId: string;
  draft: Record<string, string | string[]> | null;
  answers: Record<string, string | string[]> | null;
  results: QuestionResult[] | null;
}

export interface StageExportData {
  exportedAt: number;
  stage: StageRecord;
  scenes: SceneRecord[];
  stageOutlines: StageOutlinesRecord | null;
  chatSessions: ChatSessionRecord[];
  scenarioDialogueSessions: ScenarioDialogueSessionRecord[];
  generatedAgents: GeneratedAgentRecord[];
  quizData: QuizExportEntry[];
}

function safeGetJSON(key: string): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function exportStageData(stageId: string): Promise<StageExportData> {
  const [stage, scenes, outlines, chatSessions, scenarioSessions, agents] =
    await Promise.all([
      db.stages.get(stageId),
      db.scenes.where('stageId').equals(stageId).toArray(),
      db.stageOutlines.get(stageId),
      db.chatSessions.where('stageId').equals(stageId).toArray(),
      db.scenarioDialogueSessions.where('stageId').equals(stageId).toArray(),
      db.generatedAgents.where('stageId').equals(stageId).toArray(),
    ]);

  if (!stage) {
    throw new Error(`Stage ${stageId} not found`);
  }

  const quizData: QuizExportEntry[] = scenes
    .filter((s) => s.type === 'quiz')
    .map((s) => ({
      sceneId: s.id,
      draft: safeGetJSON(DRAFT_KEY_PREFIX + s.id) as Record<string, string | string[]> | null,
      answers: safeGetJSON(ANSWERS_KEY_PREFIX + s.id) as Record<string, string | string[]> | null,
      results: safeGetJSON(RESULTS_KEY_PREFIX + s.id) as QuestionResult[] | null,
    }));

  return {
    exportedAt: Date.now(),
    stage,
    scenes,
    stageOutlines: outlines ?? null,
    chatSessions,
    scenarioDialogueSessions: scenarioSessions,
    generatedAgents: agents,
    quizData,
  };
}

// ==================== Convenience Query Functions ====================

/**
 * Get all scenes for a course
 */
export async function getScenesByStageId(stageId: string): Promise<SceneRecord[]> {
  return db.scenes.where('stageId').equals(stageId).sortBy('order');
}

/**
 * Delete a course and all its related data
 */
export async function deleteStageWithRelatedData(stageId: string): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.stages,
      db.scenes,
      db.chatSessions,
      db.playbackState,
      db.stageOutlines,
      db.mediaFiles,
      db.generatedAgents,
      db.scenarioDialogueSessions,
    ],
    async () => {
      await db.stages.delete(stageId);
      await db.scenes.where('stageId').equals(stageId).delete();
      await db.chatSessions.where('stageId').equals(stageId).delete();
      await db.playbackState.delete(stageId);
      await db.stageOutlines.delete(stageId);
      await db.mediaFiles.where('stageId').equals(stageId).delete();
      await db.generatedAgents.where('stageId').equals(stageId).delete();
      await db.scenarioDialogueSessions.where('stageId').equals(stageId).delete();
    },
  );
}

/**
 * Get all generated agents for a course
 */
export async function getGeneratedAgentsByStageId(
  stageId: string,
): Promise<GeneratedAgentRecord[]> {
  return db.generatedAgents.where('stageId').equals(stageId).toArray();
}

/**
 * Get database statistics
 */
export async function getDatabaseStats() {
  return {
    stages: await db.stages.count(),
    scenes: await db.scenes.count(),
    audioFiles: await db.audioFiles.count(),
    imageFiles: await db.imageFiles.count(),
    snapshots: await db.snapshots.count(),
    chatSessions: await db.chatSessions.count(),
    playbackState: await db.playbackState.count(),
    stageOutlines: await db.stageOutlines.count(),
    mediaFiles: await db.mediaFiles.count(),
    generatedAgents: await db.generatedAgents.count(),
    scenarioDialogueSessions: await db.scenarioDialogueSessions.count(),
  };
}
