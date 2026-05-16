/**
 * Scenario Dialogue Storage - Persist scenario dialogue sessions to IndexedDB
 *
 * Independent from stage/scene storage cycle.
 * Handles serialization, truncation, and batch writes.
 */

import { db, type ScenarioDialogueSessionRecord, type ScenarioDialogueMessageRecord } from './database';
import { createLogger } from '@/lib/logger';

const log = createLogger('ScenarioDialogueStorage');

const MAX_MESSAGES_PER_SESSION = 200;

export interface ScenarioDialogueSessionData {
  id: string;
  stageId: string;
  sceneId: string;
  topic: string;
  historicalBackground: string;
  messages: ScenarioDialogueMessageRecord[];
}

/**
 * Save a scenario dialogue session to IndexedDB.
 * - Messages are truncated to MAX_MESSAGES_PER_SESSION
 * - Uses a compound key (stageId + sceneId) for lookup
 */
export async function saveScenarioDialogueSession(
  data: ScenarioDialogueSessionData,
): Promise<void> {
  if (!data.stageId || !data.sceneId) {
    log.warn('Cannot save scenario dialogue session: missing stageId or sceneId');
    return;
  }

  try {
    const now = Date.now();

    const record: ScenarioDialogueSessionRecord = {
      id: data.id || `${data.stageId}:${data.sceneId}`,
      stageId: data.stageId,
      sceneId: data.sceneId,
      topic: data.topic,
      historicalBackground: data.historicalBackground,
      messages: data.messages.slice(-MAX_MESSAGES_PER_SESSION),
      createdAt: data.messages[0]?.timestamp || now,
      updatedAt: now,
    };

    await db.scenarioDialogueSessions.put(record);
    log.info(`Saved scenario dialogue session: ${record.id}`);
  } catch (error) {
    log.error('Failed to save scenario dialogue session:', error);
    throw error;
  }
}

/**
 * Load a scenario dialogue session from IndexedDB by stageId and sceneId.
 * Returns null if no saved session exists.
 */
export async function loadScenarioDialogueSession(
  stageId: string,
  sceneId: string,
): Promise<ScenarioDialogueSessionData | null> {
  try {
    const id = `${stageId}:${sceneId}`;
    const record = await db.scenarioDialogueSessions.get(id);

    if (!record) {
      log.info(`No saved scenario dialogue session for: ${id}`);
      return null;
    }

    log.info(`Loaded scenario dialogue session: ${id}, messages: ${record.messages.length}`);

    return {
      id: record.id,
      stageId: record.stageId,
      sceneId: record.sceneId,
      topic: record.topic,
      historicalBackground: record.historicalBackground,
      messages: record.messages,
    };
  } catch (error) {
    log.error('Failed to load scenario dialogue session:', error);
    return null;
  }
}

/**
 * Delete a scenario dialogue session by stageId and sceneId.
 */
export async function deleteScenarioDialogueSession(
  stageId: string,
  sceneId: string,
): Promise<void> {
  try {
    const id = `${stageId}:${sceneId}`;
    await db.scenarioDialogueSessions.delete(id);
    log.info(`Deleted scenario dialogue session: ${id}`);
  } catch (error) {
    log.error('Failed to delete scenario dialogue session:', error);
  }
}

/**
 * Delete all scenario dialogue sessions for a stage.
 */
export async function deleteScenarioDialogueSessionsByStage(
  stageId: string,
): Promise<void> {
  try {
    await db.scenarioDialogueSessions.where('stageId').equals(stageId).delete();
    log.info(`Deleted all scenario dialogue sessions for stage: ${stageId}`);
  } catch (error) {
    log.error('Failed to delete scenario dialogue sessions for stage:', error);
  }
}