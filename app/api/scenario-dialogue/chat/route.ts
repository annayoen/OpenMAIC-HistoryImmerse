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

    const allAgents = [...characters, commentator, guide];
    const agentsDesc = allAgents
      .map(
        (a) =>
          `- ${a.name} (${a.id}, role: ${a.role}): ${a.persona || 'No persona specified'}`,
      )
      .join('\n');

    const historyText =
      messages.length > 0
        ? messages
          .slice(-20)
          .map((m) => `${m.speakerName}(${m.speakerRole}): ${m.content}`)
          .join('\n')
        : '(对话尚未开始)';

    const systemPrompt = `你是一个专业的历史情境对话生成器。你需要根据用户的问题，生成2-5轮多角色历史讨论对话。

## 场景信息
主题：${topic}
历史背景：${historicalBackground}

## 角色信息
${agentsDesc}

## 对话历史
${historyText}

## 规则
1. 生成2-5轮讨论（由你根据话题复杂度自行决定），每轮1-3个角色发言
2. 角色必须基于其 persona 以第一人称发言，语言风格要符合其历史身份和性格
3. 评论员(commentator)应提供客观分析和历史背景补充
4. 引导员(guide)应适时提出启发性问题，引导讨论深入
5. 必须直接回应用户的问题或观点
6. 讨论要有深度，展现不同视角的碰撞

## 输出格式
严格按照以下JSON数组格式输出，每个元素是一条消息：
[
  {"speakerId": "角色ID", "speakerName": "角色名", "speakerRole": "角色类型", "content": "发言内容"},
  ...
]

注意：
- speakerId 必须使用上面角色信息中列出的 id
- speakerRole 为 character、commentator 或 guide
- 每轮讨论之间要有逻辑递进关系
- 最后一条消息由引导员总结并邀请用户继续参与`;

    const userPrompt = `用户说：${userMessage}\n\n请生成多轮讨论对话。`;

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

        const safeEnqueue = (data: Uint8Array) => {
          if (!closed) {
            controller.enqueue(data);
          }
        };

        const safeClose = () => {
          if (!closed) {
            closed = true;
            controller.close();
          }
        };

        try {
          for await (const chunk of result.textStream) {
            if (chunk) {
              buffer += chunk;

              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                try {
                  const parsed = JSON.parse(trimmed);
                  if (Array.isArray(parsed)) {
                    for (const msg of parsed) {
                      if (msg.speakerId && msg.content) {
                        safeEnqueue(
                          encoder.encode(
                            `data: ${JSON.stringify({ type: 'message', ...msg })}\n\n`,
                          ),
                        );
                      }
                    }
                  } else if (parsed.speakerId && parsed.content) {
                    safeEnqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: 'message', ...parsed })}\n\n`,
                      ),
                    );
                  }
                } catch {
                  // Partial JSON, continue buffering
                }
              }
            }
          }

          // Try to parse remaining buffer
          if (buffer.trim()) {
            try {
              const parsed = JSON.parse(buffer.trim());
              const messages = Array.isArray(parsed) ? parsed : [parsed];
              for (const msg of messages) {
                if (msg.speakerId && msg.content) {
                  safeEnqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: 'message', ...msg })}\n\n`,
                    ),
                  );
                }
              }
            } catch {
              log.warn('Failed to parse final buffer:', buffer.slice(0, 200));
            }
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