'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, Users, MessageSquare, BookOpen, Lightbulb } from 'lucide-react';
import type { ScenarioDialogueContent } from '@/lib/types/stage';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';

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

export function ScenarioDialogueRenderer({ content, sceneId: _sceneId }: ScenarioDialogueRendererProps) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<DialogueMessage[]>(() =>
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
  );
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const allAgents = [...content.characters, content.commentator, content.guide];

  const getAgentIcon = (role: string) => {
    if (role === 'commentator') return <BookOpen className="w-4 h-4" />;
    if (role === 'guide') return <Lightbulb className="w-4 h-4" />;
    return <Users className="w-4 h-4" />;
  };

  const getRoleLabel = (role: string) => {
    if (role === 'commentator') return '历史评论员';
    if (role === 'guide') return '学习引导员';
    return role;
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Historical Background Header */}
      <div className="px-6 py-4 border-b bg-gradient-to-r from-rose-50 to-amber-50 dark:from-rose-950/30 dark:to-amber-950/30">
        <h2 className="text-lg font-bold text-rose-700 dark:text-rose-300">
          {content.topic}
        </h2>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-h-24 overflow-y-auto">
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
              title={getRoleLabel(agent.role)}
            >
              <AgentAvatar name={agent.name} color={agent.color} role={agent.role} size="sm" />
              <div className="text-xs font-medium whitespace-nowrap">{agent.name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Dialogue Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t('scenarioDialogue.waitingForDialogue')}</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              'flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300',
              msg.speakerRole === 'guide' && 'justify-end',
            )}
          >
            {msg.speakerRole !== 'guide' && (
              <AgentAvatar
                name={msg.speakerName}
                color={msg.speakerColor}
                role={getRoleLabel(msg.speakerRole)}
                size="md"
              />
            )}
            <div
              className={cn(
                'flex-1 max-w-[80%]',
              )}
            >
              <div className={cn(
                'flex items-center gap-2 mb-1',
                msg.speakerRole === 'guide' && 'justify-end',
              )}>
                <span className="text-xs font-semibold">{msg.speakerName}</span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full text-white"
                  style={{ backgroundColor: msg.speakerColor }}
                >
                  {getRoleLabel(msg.speakerRole)}
                </span>
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
                {msg.content}
              </div>
            </div>
            {msg.speakerRole === 'guide' && (
              <AgentAvatar
                name={msg.speakerName}
                color={msg.speakerColor}
                role={getRoleLabel(msg.speakerRole)}
                size="md"
              />
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm px-3">
            <div className="flex gap-1">
              <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="px-6 py-3 border-t bg-muted/30">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <textarea
              className="w-full resize-none rounded-xl border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-rose-500/30 min-h-[40px] max-h-[120px]"
              placeholder={t('scenarioDialogue.inputPlaceholder')}
              rows={1}
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                }
              }}
            />
          </div>
          <button
            className="shrink-0 w-10 h-10 rounded-xl bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 disabled:opacity-50 transition-colors"
            disabled={isLoading}
          >
            <ArrowUp className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}