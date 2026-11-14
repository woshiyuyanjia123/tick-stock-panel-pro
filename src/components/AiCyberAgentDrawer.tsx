import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { AiChatMessage, AiConfig } from '../types/market';

interface AiCyberAgentDrawerProps {
  open: boolean;
  onClose: () => void;
  activeTab: string;
  selectedStock?: { code: string; name?: string } | null;
  onConfigSaved?: (model: string) => void;
}

const QUICK_PROMPTS = [
  '今日大盘承接与情绪周期复盘',
  '连板梯队最高标晋级率诊断',
  '主线概念龙头股筛选',
  '持仓与自选风险扫描',
];

export default function AiCyberAgentDrawer({
  open,
  onClose,
  activeTab,
  selectedStock,
  onConfigSaved,
}: AiCyberAgentDrawerProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<AiConfig>({
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
  });
  const [savingCfg, setSavingCfg] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const [messages, setMessages] = useState<AiChatMessage[]>([
    {
      role: 'assistant',
      content:
        'TSP 投研终端已连接实时大盘承接、连板梯队、主线概念及自选持仓上下文。\n点击下方预设指令或输入证券代码/策略问题即可生成量化复盘结论；点击右上角[模型配置]可接入 DeepSeek / OpenAI 兼容接口。',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    api
      .getAiConfig()
      .then((cfg) => {
        setConfig((prev) => ({
          ...prev,
          baseUrl: cfg.baseUrl || prev.baseUrl,
          model: cfg.model || prev.model,
          apiKey: '',
          hasKey: cfg.hasKey,
          maskedKey: cfg.maskedKey,
        }));
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCfg(true);
    setSavedOk(false);
    try {
      const saved = await api.saveAiConfig(config);
      setConfig((prev) => ({
        ...prev,
        baseUrl: saved.baseUrl,
        model: saved.model,
        hasKey: saved.hasKey,
        maskedKey: saved.maskedKey,
        apiKey: '',
      }));
      setSavedOk(true);
      onConfigSaved?.(saved.model);
      setTimeout(() => {
        setSavedOk(false);
        setShowSettings(false);
      }, 900);
    } catch {
      // ignore
    } finally {
      setSavingCfg(false);
    }
  };

  const sendPrompt = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const nextMsgs: AiChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMsgs);
    setInput('');
    setSending(true);
    try {
      const res = await api.chatAi(nextMsgs.slice(-10), {
        activeTab,
        selectedStock,
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply }]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `请求失败: ${err?.message || '请检查后端服务或 AI API 配置'}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/55"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex flex-col w-full max-w-[440px] h-full bg-[#0e1117] border-l border-[#2a3240] shadow-2xl">
        {/* Top 28px Wind Header */}
        <div className="h-[28px] shrink-0 bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between select-none">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-[2px] h-3 bg-[#ff8800] inline-block" />
            <span className="text-xs font-semibold text-[#dfe6f0]">AI 投研复盘终端</span>
            <span className="px-1.5 py-0.5 bg-[#0e1117] border border-[#252c38] text-[10px] font-mono text-[#e5b567] truncate">
              {config.model || 'deepseek-chat'}
            </span>
          </div>

          <div className="flex items-center h-full">
            <button
              onClick={() => setShowSettings((v) => !v)}
              className={`h-full px-2 text-[11px] border-l border-[#222832] ${
                showSettings ? 'bg-[#0e1117] text-[#ff9500]' : 'text-[#8b95a5] hover:text-white'
              }`}
            >
              模型配置
            </button>
            <button
              onClick={() => setMessages(messages.slice(0, 1))}
              className="h-full px-2 text-[11px] border-l border-[#222832] text-[#8b95a5] hover:text-white"
            >
              清空
            </button>
            <button
              onClick={onClose}
              className="h-full px-2.5 text-[11px] border-l border-[#222832] text-[#8b95a5] hover:bg-[#ff3535] hover:text-white"
            >
              关闭
            </button>
          </div>
        </div>

        {/* Sub Status Strip */}
        <div className="h-[22px] shrink-0 px-2.5 bg-[#11151d] border-b border-[#222832] flex items-center justify-between text-[10px] font-mono text-[#7d8796]">
          <span>
            {config.hasKey ? `API KEY: ${config.maskedKey || '已配置'}` : '引擎: 本地量化上下文模式'}
          </span>
          <span>当前视图: {activeTab.toUpperCase()}</span>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <form
            onSubmit={handleSaveConfig}
            className="p-2.5 bg-[#121720] border-b border-[#222832] space-y-2 text-[11px]"
          >
            <div className="text-[#dfe6f0] font-semibold">OpenAI / DeepSeek 兼容接口配置</div>
            <div>
              <label className="block text-[10px] text-[#8b95a5] mb-0.5">Base URL</label>
              <input
                type="text"
                value={config.baseUrl}
                onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
                className="w-full h-[26px] px-2 bg-[#090c10] border border-[#2a3240] text-[#dfe6f0] font-mono text-[11px] focus:border-[#ff8800] outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-[#8b95a5] mb-0.5">Model</label>
                <input
                  type="text"
                  value={config.model}
                  onChange={(e) => setConfig({ ...config, model: e.target.value })}
                  placeholder="deepseek-chat"
                  className="w-full h-[26px] px-2 bg-[#090c10] border border-[#2a3240] text-[#dfe6f0] font-mono text-[11px] focus:border-[#ff8800] outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#8b95a5] mb-0.5">
                  API Key {config.maskedKey ? `(${config.maskedKey})` : ''}
                </label>
                <input
                  type="password"
                  value={config.apiKey}
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full h-[26px] px-2 bg-[#090c10] border border-[#2a3240] text-[#dfe6f0] font-mono text-[11px] focus:border-[#ff8800] outline-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <div className="flex gap-1">
                {['deepseek-chat', 'deepseek-reasoner'].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setConfig({ ...config, model: m })}
                    className="px-1.5 py-0.5 bg-[#181f2c] border border-[#2a3240] hover:border-[#ff8800] text-[10px] text-[#dfe6f0] font-mono"
                  >
                    {m}
                  </button>
                ))}
              </div>
              <button
                type="submit"
                disabled={savingCfg}
                className="px-3 py-1 bg-[#ff8800] hover:bg-[#ff9922] text-[#090c10] text-[11px] font-semibold"
              >
                {savedOk ? '已保存' : savingCfg ? '保存中...' : '保存配置'}
              </button>
            </div>
          </form>
        )}

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2 bg-[#090c10]">
          {messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={idx}
                className={`border p-2 text-[12px] leading-relaxed whitespace-pre-wrap ${
                  isUser
                    ? 'bg-[#141c29] border-[#2e4366] text-[#e8edf5] ml-6'
                    : 'bg-[#0e1117] border-[#222832] text-[#cfd7e3] mr-2'
                }`}
              >
                <div className="text-[10px] font-mono mb-1 flex items-center justify-between text-[#7d8796]">
                  <span className={isUser ? 'text-[#4da3ff]' : 'text-[#ff9500]'}>
                    {isUser ? '[USER]' : '[TSP-RESEARCH]'}
                  </span>
                </div>
                {msg.content}
              </div>
            );
          })}
          {sending && (
            <div className="p-2 border border-[#222832] bg-[#0e1117] text-[11px] font-mono text-[#f0b90b]">
              正在检索盘面数据与因子上下文...
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Quick 1-Click Prompts */}
        <div className="p-2 border-t border-[#222832] bg-[#11151d] flex flex-wrap gap-1">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              onClick={() => sendPrompt(q)}
              disabled={sending}
              className="text-[11px] px-2 py-1 bg-[#161b24] hover:bg-[#1f2736] border border-[#252c38] hover:border-[#ff8800] text-[#cfd7e3]"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Input Box */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendPrompt(input);
          }}
          className="p-2 border-t border-[#222832] bg-[#141923] flex items-center gap-1.5"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入复盘指令或股票代码..."
            className="flex-1 h-[28px] px-2 bg-[#090c10] border border-[#2a3240] focus:border-[#ff8800] text-xs text-[#dfe6f0] placeholder-[#6d7787] outline-none"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="h-[28px] px-3 bg-[#ff8800] hover:bg-[#ff9922] disabled:opacity-40 text-[#090c10] text-xs font-semibold"
          >
            发送
          </button>
        </form>
      </div>
    </div>
  );
}
