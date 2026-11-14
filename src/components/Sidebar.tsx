import React from 'react';
import type { HealthResponse, IndexQuote, NavTabId } from '../types/market';

interface SidebarProps {
  activeTab: NavTabId;
  onSelectTab: (tab: NavTabId) => void;
  health: HealthResponse | null;
  indices: IndexQuote[];
  liveEnabled: boolean;
  onToggleLive: () => void;
  onOpenAi: () => void;
  onRefreshData: () => void;
  onSelectStock: (code: string, name?: string) => void;
}

interface RailItem {
  id: NavTabId;
  short: string;
  label: string;
  accent?: 'alpha' | 'ext';
}

const RAIL_ITEMS: RailItem[] = [
  { id: 'dashboard', short: '看板', label: 'F1 市场全貌(看板)' },
  { id: 'watchlist', short: '自选', label: 'F2 自选报价' },
  { id: 'ladder', short: '连板', label: 'F3 连板复盘', accent: 'ext' },
  { id: 'concept', short: '概念', label: 'F4 概念轮动', accent: 'ext' },
  { id: 'industry', short: '行业', label: 'F5 行业矩阵', accent: 'ext' },
  { id: 'market-env', short: '周期', label: 'F6 市场周期' },
  { id: 'strategy', short: '策略', label: 'F7 策略选股' },
  { id: 'factor', short: '因子', label: 'F7 因子研究' },
  { id: 'backtest', short: '回测', label: 'F8 T+1回测系统' },
  { id: 'stock', short: '个股', label: 'F9 个股深度', accent: 'ext' },
  { id: 'finance', short: '财务', label: 'F9 财务F10分析', accent: 'ext' },
  { id: 'panda-pm', short: '跨市', label: 'F10 PandaAI x 期货PM', accent: 'alpha' },
  { id: 'consensus-cpo', short: '认知', label: 'F12 超前认知定价与CPO传导', accent: 'alpha' },
  { id: 'fact-fupeng', short: '付鹏', label: '确定买点复盘 & 付鹏24h宏观FICC', accent: 'alpha' },
  { id: 'saas-desk', short: '实盘', label: '模拟实盘与SaaS中枢', accent: 'alpha' },
  { id: 'monitor', short: '监控', label: 'F11 监控中心', accent: 'ext' },
  { id: 'anomaly', short: '异动', label: 'F11 短线异动精灵', accent: 'ext' },
];

export default function Sidebar({
  activeTab,
  onSelectTab,
  liveEnabled,
  onToggleLive,
  onOpenAi,
  onRefreshData,
}: SidebarProps) {
  return (
    <aside className="w-[44px] shrink-0 bg-[#10141c] border-r border-[#222832] flex flex-col justify-between select-none z-20">
      {/* Vertical 2-char Module Switcher */}
      <div className="flex-1 overflow-y-auto py-0.5">
        {RAIL_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          const isAlpha = item.accent === 'alpha';
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              title={item.label}
              className={`w-full h-[32px] flex items-center justify-center text-[11px] border-b border-[#181d26] border-l-2 transition-colors ${
                isActive
                  ? 'border-l-[#ff8800] bg-[#19202d] text-[#ff9500] font-semibold'
                  : isAlpha
                  ? 'border-l-[#f0b90b] bg-[#141820] text-[#f0b90b] hover:bg-[#1b2230]'
                  : 'border-l-transparent text-[#8b95a5] hover:text-[#dfe6f0] hover:bg-[#161c26]'
              }`}
            >
              {item.short}
            </button>
          );
        })}
      </div>

      {/* Bottom Compact Utility Buttons */}
      <div className="border-t border-[#222832] bg-[#0c1017]">
        <button
          onClick={onRefreshData}
          title="强制刷新全盘数据"
          className="w-full h-[26px] flex items-center justify-center text-[10px] text-[#8b95a5] hover:text-[#dfe6f0] hover:bg-[#181f2c] border-b border-[#181d26]"
        >
          刷新
        </button>
        <button
          onClick={onOpenAi}
          title="打开 AI 研报终端"
          className="w-full h-[26px] flex items-center justify-center text-[10px] text-[#4da3ff] hover:text-white hover:bg-[#181f2c] border-b border-[#181d26]"
        >
          AI
        </button>
        <button
          onClick={onToggleLive}
          title={liveEnabled ? '实时轮询: 开启 (点击暂停)' : '实时轮询: 暂停 (点击开启)'}
          className={`w-full h-[26px] flex items-center justify-center gap-1 text-[10px] ${
            liveEnabled ? 'text-[#00c853] bg-[#111923]' : 'text-[#64748b]'
          } hover:bg-[#181f2c]`}
        >
          <span
            className={`w-1.5 h-1.5 ${liveEnabled ? 'bg-[#00c853]' : 'bg-[#475569]'}`}
          />
          <span>行情</span>
        </button>
      </div>
    </aside>
  );
}
