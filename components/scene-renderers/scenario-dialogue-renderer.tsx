'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ArrowUp, MessageSquare, Volume2, VolumeX } from 'lucide-react';
import type { ScenarioDialogueContent } from '@/lib/types/stage';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStreamingText } from '@/lib/hooks/use-streaming-text';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { useSettingsStore } from '@/lib/store/settings';
import { useStageStore } from '@/lib/store/stage';
import { TTS_PROVIDERS } from '@/lib/audio/constants';
import type { TTSProviderId } from '@/lib/audio/types';
import { cn } from '@/lib/utils';
import {
  saveScenarioDialogueSession,
  loadScenarioDialogueSession,
} from '@/lib/utils/scenario-dialogue-storage';

interface ScenarioDialogueRendererProps {
  readonly content: ScenarioDialogueContent;
  readonly sceneId: string;
}

interface DialogueMessage {
  id: string;
  speakerId: string;
  speakerName: string;
  speakerRole: string;
  speakerColor: string;
  content: string;
  timestamp: number;
}

function AgentAvatar({
  name,
  color,
  role,
  size = 'md',
}: {
  name: string;
  color: string;
  role: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-base',
  };

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-bold text-white shrink-0',
        sizeClasses[size],
      )}
      style={{ backgroundColor: color }}
      title={`${name} - ${role}`}
    >
      {name.charAt(0)}
    </div>
  );
}

function DialogueBubble({
  msg,
  isNew,
  onStreamComplete,
  getRoleLabel,
}: {
  msg: DialogueMessage;
  isNew: boolean;
  onStreamComplete: (id: string) => void;
  getRoleLabel: (speakerId: string, speakerRole: string) => string;
}) {
  const onCompleteRef = useRef(onStreamComplete);
  // eslint-disable-next-line react-hooks/refs -- syncing ref with latest callback is the recommended pattern
  onCompleteRef.current = onStreamComplete;

  const stableOnComplete = useCallback(() => {
    if (isNew) {
      onCompleteRef.current(msg.id);
    }
  }, [isNew, msg.id]);

  const { displayedText, isStreaming } = useStreamingText({
    text: msg.content,
    speed: 50,
    enabled: isNew,
    onComplete: stableOnComplete,
  });

  const displayContent = isNew ? displayedText : msg.content;

  return (
    <div
      className={cn(
        'flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300',
        msg.speakerRole === 'guide' && 'justify-end',
      )}
    >
      {msg.speakerRole !== 'guide' && (
        <AgentAvatar
          name={msg.speakerName}
          color={msg.speakerColor}
          role={getRoleLabel(msg.speakerId, msg.speakerRole)}
          size="md"
        />
      )}
      <div className={cn('flex-1 max-w-[80%]')}>
        <div
          className={cn(
            'flex items-center gap-2 mb-1',
            msg.speakerRole === 'guide' && 'justify-end',
          )}
        >
          <span className="text-xs font-semibold">{msg.speakerName}</span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full text-white"
            style={{ backgroundColor: msg.speakerColor }}
          >
            {getRoleLabel(msg.speakerId, msg.speakerRole)}
          </span>
          {isStreaming && (
            <span className="text-[10px] text-muted-foreground animate-pulse">输入中...</span>
          )}
        </div>
        <div
          className={cn(
            'rounded-2xl px-4 py-3 text-sm leading-relaxed text-left',
            msg.speakerRole === 'commentator'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800'
              : msg.speakerRole === 'guide'
                ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800'
                : 'bg-background border shadow-sm',
          )}
        >
          {displayContent}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse align-middle" />
          )}
        </div>
      </div>
      {msg.speakerRole === 'guide' && (
        <AgentAvatar
          name={msg.speakerName}
          color={msg.speakerColor}
          role={getRoleLabel(msg.speakerId, msg.speakerRole)}
          size="md"
        />
      )}
    </div>
  );
}

function resolveVoiceForSpeaker(
  speakerId: string,
  speakerRole: string,
  speakerName: string,
  agentIndex: number,
  providerId: TTSProviderId,
): string {
  const provider = TTS_PROVIDERS[providerId as keyof typeof TTS_PROVIDERS];
  if (!provider || provider.voices.length === 0) {
    return 'default';
  }

  const voices = provider.voices;

  if (speakerRole === 'commentator') {
    const maleVoices = voices.filter((v) => v.gender === 'male');
    if (maleVoices.length > 0) return maleVoices[0].id;
    return voices[1]?.id || voices[0].id;
  }

  if (speakerRole === 'guide') {
    const femaleVoices = voices.filter((v) => v.gender === 'female');
    if (femaleVoices.length > 0) return femaleVoices[femaleVoices.length - 1].id;
    return voices[2]?.id || voices[0].id;
  }

  const isFemale =
    speakerName.includes('女') ||
    speakerName.includes('后') ||
    speakerName.includes('妃') ||
    speakerName.includes('夫人') ||
    speakerName.includes('娘');
  if (isFemale) {
    const femaleVoices = voices.filter((v) => v.gender === 'female');
    if (femaleVoices.length > 0) {
      return femaleVoices[agentIndex % femaleVoices.length].id;
    }
  }

  const maleVoices = voices.filter((v) => v.gender === 'male');
  if (maleVoices.length > 0) {
    return maleVoices[agentIndex % maleVoices.length].id;
  }

  return voices[agentIndex % voices.length].id;
}

export function ScenarioDialogueRenderer({ content, sceneId }: ScenarioDialogueRendererProps) {
  const { t } = useI18n();

  const stageId = useStageStore((s) => s.stage?.id);

  const ttsProviderId = useSettingsStore((s) => s.ttsProviderId);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const ttsVolume = useSettingsStore((s) => s.ttsVolume);
  const ttsMuted = useSettingsStore((s) => s.ttsMuted);

  const buildOpeningMessages = useCallback(
    () =>
      content.openingDialogue.map((line, index) => {
        const speaker = [...content.characters, content.commentator, content.guide].find(
          (c) => c.id === line.speakerId,
        );
        return {
          id: `opening-${index}`,
          speakerId: line.speakerId,
          speakerName: line.speakerName,
          speakerRole: speaker?.role || '',
          speakerColor: speaker?.color || '#6b7280',
          content: line.content,
          timestamp: Date.now() + index,
        };
      }),
    [content],
  );

  const [messages, setMessages] = useState<DialogueMessage[]>(() => buildOpeningMessages());
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set());
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const ttsQueueRef = useRef<Array<{ messageId: string; text: string; voice: string; agentIndex: number; speakerId: string; speakerRole: string; speakerName: string }>>([]);
  const isPlayingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsEnabledRef = useRef(ttsEnabled);
  ttsEnabledRef.current = ttsEnabled;

  const pendingQueueRef = useRef<DialogueMessage[]>([]);
  const isProcessingQueueRef = useRef(false);
  const currentStreamingIdRef = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const allAgents = useMemo(
    () => [...content.characters, content.commentator, content.guide],
    [content.characters, content.commentator, content.guide],
  );

  const agentIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    allAgents.forEach((agent, i) => map.set(agent.id, i));
    return map;
  }, [allAgents]);

  const agentById = useMemo(() => {
    const map = new Map<string, (typeof allAgents)[number]>();
    allAgents.forEach((a) => map.set(a.id, a));
    return map;
  }, [allAgents]);

  const getRoleLabel = useCallback(
    (speakerId: string, speakerRole: string) => {
      if (speakerRole === 'commentator') return '历史评论员';
      if (speakerRole === 'guide') return '学习引导员';
      if (speakerRole === 'user') return '我';
      if (speakerRole === 'character') {
        const agent = agentById.get(speakerId);
        return agent?.role || '历史人物';
      }
      return speakerRole;
    },
    [agentById],
  );

  const scrollToBottom = useCallback(() => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const observer = new MutationObserver(() => {
      if (messagesContainerRef.current) {
        const el = messagesContainerRef.current;
        el.scrollTop = el.scrollHeight;
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!stageId || !sceneId || messagesLoaded) return;

    let cancelled = false;

    loadScenarioDialogueSession(stageId, sceneId).then((session) => {
      if (cancelled) return;
      if (session && session.messages.length > 0) {
        setMessages(session.messages);
      }
      setMessagesLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [stageId, sceneId, messagesLoaded]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!stageId || !sceneId || !messagesLoaded) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      saveScenarioDialogueSession({
        id: `${stageId}:${sceneId}`,
        stageId,
        sceneId,
        topic: content.topic,
        historicalBackground: content.historicalBackground,
        messages,
      });
    }, 2000);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [stageId, sceneId, messagesLoaded, messages, content.topic, content.historicalBackground]);

  const processTTSQueue = useCallback(async () => {
    if (isPlayingRef.current || ttsQueueRef.current.length === 0) return;
    if (!ttsEnabledRef.current || ttsMuted) {
      ttsQueueRef.current = [];
      return;
    }

    isPlayingRef.current = true;
    const item = ttsQueueRef.current.shift()!;

    const providerConfig = ttsProvidersConfig[ttsProviderId];
    const effectiveSpeed = Math.min(ttsSpeed * 1.3, 4.0);

    try {
      const res = await fetch('/api/generate/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: item.text,
          audioId: `scenario-${item.messageId}`,
          ttsProviderId,
          ttsModelId: providerConfig?.modelId,
          ttsVoice: item.voice,
          ttsSpeed: effectiveSpeed,
          ttsApiKey: providerConfig?.apiKey,
          ttsBaseUrl:
            providerConfig?.serverBaseUrl ||
            providerConfig?.baseUrl ||
            providerConfig?.customDefaultBaseUrl,
        }),
      });

      if (!res.ok) throw new Error(`TTS API error: ${res.status}`);

      const data = await res.json();
      if (!data.base64) throw new Error('No audio in response');

      const audioUrl = `data:audio/${data.format || 'mp3'};base64,${data.base64}`;
      const audio = new Audio(audioUrl);
      audio.volume = ttsMuted ? 0 : ttsVolume;
      audioRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        audio.addEventListener('ended', () => {
          audioRef.current = null;
          resolve();
        });
        audio.addEventListener('error', () => {
          audioRef.current = null;
          reject(new Error('Audio playback error'));
        });
        audio.play().catch(reject);
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[ScenarioDialogue] TTS failed:', err);
      }
      audioRef.current = null;
    } finally {
      isPlayingRef.current = false;
      processTTSQueue();
    }
  }, [ttsProviderId, ttsSpeed, ttsProvidersConfig, ttsVolume, ttsMuted]);

  const processTTSQueueRef = useRef(processTTSQueue);
  processTTSQueueRef.current = processTTSQueue;

  const enqueueTTS = useCallback(
    (messageId: string, text: string, speakerId: string, speakerRole: string, speakerName: string) => {
      if (!ttsEnabledRef.current || ttsMuted || !text.trim()) return;

      const agentIndex = agentIndexMap.get(speakerId) ?? 0;
      const voice = resolveVoiceForSpeaker(
        speakerId,
        speakerRole,
        speakerName,
        agentIndex,
        ttsProviderId,
      );

      ttsQueueRef.current.push({
        messageId,
        text,
        voice,
        agentIndex,
        speakerId,
        speakerRole,
        speakerName,
      });

      if (!isPlayingRef.current) {
        processTTSQueueRef.current();
      }
    },
    [ttsProviderId, ttsMuted, agentIndexMap],
  );

  const processMessageQueue = useCallback(() => {
    if (isProcessingQueueRef.current) return;
    if (pendingQueueRef.current.length === 0) return;

    isProcessingQueueRef.current = true;
    const nextMsg = pendingQueueRef.current.shift()!;
    currentStreamingIdRef.current = nextMsg.id;

    setNewMessageIds((prev) => {
      const next = new Set(prev);
      next.add(nextMsg.id);
      return next;
    });
    setMessages((prev) => [...prev, nextMsg]);
  }, []);

  const processMessageQueueRef = useRef(processMessageQueue);
  processMessageQueueRef.current = processMessageQueue;

  const handleStreamComplete = useCallback(
    (messageId: string) => {
      setNewMessageIds((prev) => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });

      if (ttsEnabled) {
        const msg = messagesRef.current.find((m) => m.id === messageId);
        if (msg && msg.speakerRole !== 'user') {
          enqueueTTS(messageId, msg.content, msg.speakerId, msg.speakerRole, msg.speakerName);
        }
      }

      if (currentStreamingIdRef.current === messageId) {
        currentStreamingIdRef.current = null;
        isProcessingQueueRef.current = false;

        setTimeout(() => {
          processMessageQueueRef.current();
        }, 1000);
      }
    },
    [ttsEnabled, enqueueTTS],
  );

  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading) return;

    pendingQueueRef.current = [];
    isProcessingQueueRef.current = false;
    currentStreamingIdRef.current = null;

    const userMsg: DialogueMessage = {
      id: `user-${Date.now()}`,
      speakerId: 'user',
      speakerName: '我',
      speakerRole: 'user',
      speakerColor: '#6b7280',
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);

    try {
      const modelConfig = getCurrentModelConfig();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-model': modelConfig.modelString,
        'x-api-key': modelConfig.apiKey,
      };
      if (modelConfig.baseUrl) headers['x-base-url'] = modelConfig.baseUrl;
      if (modelConfig.providerType) headers['x-provider-type'] = modelConfig.providerType;

      const response = await fetch('/api/scenario-dialogue/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          topic: content.topic,
          historicalBackground: content.historicalBackground,
          characters: content.characters,
          commentator: content.commentator,
          guide: content.guide,
          messages: messages.map((m) => ({
            speakerId: m.speakerId,
            speakerName: m.speakerName,
            speakerRole: m.speakerRole,
            content: m.content,
          })),
          userMessage: trimmed,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmedLine.slice(6));

            if (data.type === 'message') {
              const newMsg: DialogueMessage = {
                id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                speakerId: data.speakerId,
                speakerName: data.speakerName,
                speakerRole: data.speakerRole,
                speakerColor:
                  allAgents.find((a) => a.id === data.speakerId)?.color || '#6b7280',
                content: data.content,
                timestamp: Date.now(),
              };
              pendingQueueRef.current.push(newMsg);
              if (!isProcessingQueueRef.current) {
                processMessageQueueRef.current();
              }
            } else if (data.type === 'done') {
              // Stream complete
            } else if (data.type === 'error') {
              console.error('Dialogue generation error:', data.message);
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, content, messages, allAgents]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, []);

  const handleToggleTTS = useCallback(() => {
    setTtsEnabled((prev) => {
      if (prev) {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        ttsQueueRef.current = [];
        isPlayingRef.current = false;
      }
      return !prev;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      ttsQueueRef.current = [];
      isPlayingRef.current = false;
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Historical Background Header */}
      <div className="px-6 py-4 border-b bg-gradient-to-r from-rose-50 to-amber-50 dark:from-rose-950/30 dark:to-amber-950/30">
        <h2 className="text-lg font-bold text-rose-700 dark:text-rose-300">
          {content.topic}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed max-h-18 overflow-y-auto">
          {content.historicalBackground}
        </p>
      </div>

      {/* Agent Cards */}
      <div className="px-6 py-3 border-b bg-muted/30">
        <div className="flex flex-nowrap gap-3 overflow-x-auto justify-center">
          {allAgents.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border shadow-sm shrink-0"
              title={getRoleLabel(agent.id, agent.role)}
            >
              <AgentAvatar name={agent.name} color={agent.color} role={agent.role} size="sm" />
              <div className="text-xs font-medium whitespace-nowrap">{agent.name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Dialogue Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t('scenarioDialogue.waitingForDialogue')}</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <DialogueBubble
            key={msg.id}
            msg={msg}
            isNew={newMessageIds.has(msg.id)}
            onStreamComplete={handleStreamComplete}
            getRoleLabel={getRoleLabel}
          />
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm px-3">
            <div className="flex gap-1">
              <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
            </div>
            <span>角色们正在思考...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="px-6 py-3 border-t bg-muted/30">
        <div className="flex items-center gap-2">
          <button
            className={cn(
              'shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors',
              ttsEnabled
                ? 'bg-primary/10 text-primary hover:bg-primary/20'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
            onClick={handleToggleTTS}
            title={ttsEnabled ? '关闭语音播放' : '开启语音播放'}
          >
            {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              className="w-full resize-none rounded-xl border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-rose-500/30 min-h-[40px] max-h-[120px]"
              placeholder={t('scenarioDialogue.inputPlaceholder')}
              rows={1}
              disabled={isLoading}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                adjustTextareaHeight();
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          <button
            className="shrink-0 w-10 h-10 rounded-xl bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 disabled:opacity-50 transition-colors"
            disabled={isLoading || !inputValue.trim()}
            onClick={handleSend}
          >
            <ArrowUp className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}