/**
 * Scenario Dialogue Chat API
 *
 * POST /api/scenario-dialogue/chat
 * Generates multi-round historical character dialogue (2-5 rounds)
 * Streams response as SSE with per-message text deltas.
 */

import { NextRequest } from 'next/server';
import { streamLLM } from '@/lib/ai/llm';
import { createLogger } from '@/lib/logger';
import { apiError } from '@/lib/server/api-response';
import { resolveModelFromRequest } from '@/lib/server/resolve-model';
import { loadPrompt, interpolateVariables } from '@/lib/prompts';

const log = createLogger('ScenarioDialogueChat');

export const maxDuration = 120;

interface DialogueAgent {
  id: string;
  name: string;
  role: string;
  persona: string;
  color: string;
}

interface ChatRequest {
  topic: string;
  historicalBackground: string;
  characters: DialogueAgent[];
  commentator: DialogueAgent;
  guide: DialogueAgent;
  messages: Array<{
    speakerId: string;
    speakerName: string;
    speakerRole: string;
    content: string;
  }>;
  userMessage: string;
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  try {
    const body = (await req.json()) as ChatRequest;
    const { topic, historicalBackground, characters, commentator, guide, messages, userMessage } =
      body;

    if (!userMessage?.trim()) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'userMessage is required');
    }

    const { model: languageModel, thinkingConfig } = await resolveModelFromRequest(req, body);

    const allAgents = [
      ...characters.map((c) => ({ ...c, speakerRole: 'character' as const })),
      { ...commentator, speakerRole: 'commentator' as const },
      { ...guide, speakerRole: 'guide' as const },
    ];
    const agentsDesc = allAgents
      .map(
        (a) =>
          `- ${a.name} (id: ${a.id}, speakerRole: ${a.speakerRole}, historicalRole: ${a.role}): ${a.persona || 'No persona specified'}`,
      )
      .join('\n');

    const nameToId = new Map<string, string>();
    allAgents.forEach((a) => nameToId.set(a.name, a.id));

    const resolveSpeakerId = (msg: Record<string, unknown>): string | undefined => {
      if (msg.speakerId && typeof msg.speakerId === 'string' && msg.speakerId.trim()) {
        return msg.speakerId;
      }
      if (msg.speakerName && typeof msg.speakerName === 'string') {
        const id = nameToId.get(msg.speakerName);
        if (id) {
          log.warn(`Message missing speakerId, resolved from speakerName: "${msg.speakerName}" -> "${id}"`);
          return id;
        }
      }
      return undefined;
    };

    const historyText =
      messages.length > 0
        ? messages
          .slice(-20)
          .map((m) => `${m.speakerName}(${m.speakerRole}): ${m.content}`)
          .join('\n')
        : '(对话尚未开始)';

    const prompt = loadPrompt('scenario-dialogue-chat');
    const systemPrompt = prompt
      ? interpolateVariables(prompt.systemPrompt, {
        topic,
        historicalBackground,
        agentsDesc,
        historyText,
      })
      : '';
    const userPrompt = prompt
      ? interpolateVariables(prompt.userPromptTemplate, { userMessage })
      : '';

    if (!systemPrompt) {
      return apiError('INTERNAL_ERROR', 500, 'Failed to load prompt template');
    }

    log.info(`Generating scenario dialogue: topic="${topic}", userMessage="${userMessage.slice(0, 50)}..."`);

    const result = streamLLM(
      {
        model: languageModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      'scenario-dialogue-chat',
      thinkingConfig,
    );

    const readable = new ReadableStream({
      async start(controller) {
        let buffer = '';
        let closed = false;
        const seenRoles = new Set<string>();
        let messageCount = 0;

        const safeEnqueue = (data: Uint8Array) => {
          if (!closed) {
            controller.enqueue(data);
          }
        };

        const trackMessage = (msg: Record<string, unknown>) => {
          messageCount++;
          if (msg.speakerRole && typeof msg.speakerRole === 'string') {
            seenRoles.add(msg.speakerRole);
          }
        };

        const safeClose = () => {
          if (!closed) {
            closed = true;
            controller.close();
          }
        };

        const extractCompleteJSONObjects = (text: string): { objects: string[]; remainder: string } => {
          const objects: string[] = [];
          let depth = 0;
          let start = -1;
          let inString = false;
          let escape = false;

          for (let i = 0; i < text.length; i++) {
            const ch = text[i];

            if (inString) {
              if (escape) {
                escape = false;
              } else if (ch === '\\') {
                escape = true;
              } else if (ch === '"') {
                inString = false;
              }
              continue;
            }

            if (ch === '"') {
              inString = true;
              continue;
            }

            if (ch === '{') {
              if (depth === 0) start = i;
              depth++;
            } else if (ch === '}') {
              depth--;
              if (depth === 0 && start >= 0) {
                objects.push(text.slice(start, i + 1));
                start = -1;
              }
            }
          }

          const remainder = start >= 0 ? text.slice(start) : '';
          return { objects, remainder };
        };

        try {
          for await (const chunk of result.textStream) {
            if (chunk) {
              buffer += chunk;

              const { objects, remainder } = extractCompleteJSONObjects(buffer);
              buffer = remainder;

              for (const obj of objects) {
                try {
                  const parsed = JSON.parse(obj);
                  const speakerId = resolveSpeakerId(parsed);
                  if (speakerId && parsed.content) {
                    trackMessage(parsed);
                    safeEnqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: 'message', speakerId, ...parsed })}\n\n`,
                      ),
                    );
                  } else if (parsed.content) {
                    log.warn('Dropping message: no speakerId and cannot resolve from speakerName', parsed);
                  }
                } catch {
                  log.warn('Failed to parse extracted JSON object:', obj.slice(0, 100));
                }
              }
            }
          }

          if (buffer.trim()) {
            try {
              const parsed = JSON.parse(buffer.trim());
              const messages = Array.isArray(parsed) ? parsed : [parsed];
              for (const msg of messages) {
                const speakerId = resolveSpeakerId(msg);
                if (speakerId && msg.content) {
                  trackMessage(msg);
                  safeEnqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: 'message', speakerId, ...msg })}\n\n`,
                    ),
                  );
                } else if (msg.content) {
                  log.warn('Dropping final message: no speakerId and cannot resolve from speakerName', msg);
                }
              }
            } catch {
              log.warn('Failed to parse final buffer:', buffer.slice(0, 200));
            }
          }

          const hasCharacter = seenRoles.has('character');
          const hasCommentator = seenRoles.has('commentator');
          const hasGuide = seenRoles.has('guide');
          if (!hasCharacter || !hasCommentator || !hasGuide) {
            log.warn(
              `Incomplete dialogue output: ${messageCount} messages, roles seen: [${[...seenRoles].join(', ')}]. ` +
              `Missing: ${!hasCharacter ? 'character ' : ''}${!hasCommentator ? 'commentator ' : ''}${!hasGuide ? 'guide ' : ''}`,
            );
          }

          safeEnqueue(encoder.encode('data: {"type":"done"}\n\n'));
          safeClose();
        } catch (error) {
          log.error('Stream error:', error);
          if (!closed) {
            safeEnqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) })}\n\n`,
              ),
            );
            safeClose();
          }
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    log.error('Scenario dialogue chat failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to generate dialogue',
    );
  }
}