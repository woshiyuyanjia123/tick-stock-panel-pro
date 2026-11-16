import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatAmount, setSaasSession, subscribeRealtimeStream } from './api/client';
import Sidebar from './components/Sidebar';
import StockDetailModal from './components/StockDetailModal';
import AiCyberAgentDrawer from './components/AiCyberAgentDrawer';
import type {
  AlertTriggerEvent,
  GlobalCommandStripSummary,
  HealthResponse,
  IndexQuote,
  NavTabId,
  RealtimePulsePayload,
  SaasSystemDiagnostics,
  StockSearchItem,
} from './types/market';

const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
const LimitUpLadderPage = React.lazy(() => import('./pages/LimitUpLadderPage'));
const MarketEnvPage = React.lazy(() => import('./pages/MarketEnvPage'));
const ConceptAnalysisPage = React.lazy(() => import('./pages/ConceptAnalysisPage'));
const IndustryAnalysisPage = React.lazy(() => import('./pages/IndustryAnalysisPage'));
const WatchlistPage = React.lazy(() => import('./pages/WatchlistPage'));
const StrategyScreenerPage = React.lazy(() => import('./pages/StrategyScreenerPage'));
const BacktestPage = React.lazy(() => import('./pages/BacktestPage'));
const StockAnalysisPage = React.lazy(() => import('./pages/StockAnalysisPage'));
const MonitorCenterPage = React.lazy(() => import('./pages/MonitorCenterPage'));
const PandaPmCommandPage = React.lazy(() => import('./pages/PandaPmCommandPage'));
const ConsensusCpoPage = React.lazy(() => import('./pages/ConsensusCpoPage'));
const FactFupengPage = React.lazy(() => import('./pages/FactFupengPage'));
const SaasEnterprisePage = React.lazy(() => import('./pages/SaasEnterprisePage'));

const VALID_NAV_TABS = new Set<NavTabId>([
  'dashboard',
  'watchlist',
  'strategy',
  'factor',
  'backtest',
  'stock',
  'ladder',
  'concept',
  'industry',
  'finance',
  'monitor',
  'market-env',
  'anomaly',
  'panda-pm',
  'consensus-cpo',
  'fact-fupeng',
  'saas-desk',
]);

declare global {
  interface Window {
    tspDesktop?: {
      isElectron?: boolean;
      platform?: string;
      version?: string;
      toggleAlwaysOnTop?: () => Promise<boolean>;
      openExternal?: (url: string) => Promise<boolean>;
      navigateTab?: (tab: string) => void;
      openPopout?: (tab: string, alwaysOnTop?: boolean) => Promise<boolean>;
    };
  }
}

function getInitialTabFromUrl(): NavTabId {
  if (typeof window === 'undefined') return 'dashboard';
  const param = new URLSearchParams(window.location.search).get('tab') as NavTabId | null;
  if (param && VALID_NAV_TABS.has(param)) return param;
  return 'dashboard';
}

function getIsPopoutFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('popout') === '1';
}

interface TopRibbonTab {
  keyLabel: string;
  label: string;
  tabs: NavTabId[];
  primaryTab: NavTabId;
  isAlpha?: boolean;
}

const TOP_RIBBON_TABS: TopRibbonTab[] = [
  { keyLabel: 'F1', label: '市场全貌(看板)', tabs: ['dashboard'], primaryTab: 'dashboard' },
  { keyLabel: 'F2', label: '自选报价', tabs: ['watchlist'], primaryTab: 'watchlist' },
  { keyLabel: 'F3', label: '连板复盘', tabs: ['ladder'], primaryTab: 'ladder' },
  { keyLabel: 'F4', label: '概念轮动', tabs: ['concept'], primaryTab: 'concept' },
  { keyLabel: 'F5', label: '行业矩阵', tabs: ['industry'], primaryTab: 'industry' },
  { keyLabel: 'F6', label: '市场周期', tabs: ['market-env'], primaryTab: 'market-env' },
  { keyLabel: 'F7', label: '选股/因子', tabs: ['strategy', 'factor'], primaryTab: 'strategy' },
  { keyLabel: 'F8', label: '回测系统', tabs: ['backtest'], primaryTab: 'backtest' },
  { keyLabel: 'F9', label: '个股深度', tabs: ['stock', 'finance'], primaryTab: 'stock' },
  {
    keyLabel: 'F10',
    label: 'PandaAI×期货PM',
    tabs: ['panda-pm'],
    primaryTab: 'panda-pm',
    isAlpha: true,
  },
  { keyLabel: 'F11', label: '异动盯盘', tabs: ['monitor', 'anomaly'], primaryTab: 'monitor' },
  {
    keyLabel: 'F12',
    label: '认知定价/CPO传导',
    tabs: ['consensus-cpo'],
    primaryTab: 'consensus-cpo',
    isAlpha: true,
  },
  {
    keyLabel: '宏观',
    label: '确定买点/付鹏FICC',
    tabs: ['fact-fupeng'],
    primaryTab: 'fact-fupeng',
    isAlpha: true,
  },
  {
    keyLabel: '实盘',
    label: 'OMS实盘/SaaS',
    tabs: ['saas-desk'],
    primaryTab: 'saas-desk',
    isAlpha: true,
  },
];

interface FuturesSpriteItem {
  symbol: string;
  name: string;
  targetTab: NavTabId;
  note: string;
}

const FUTURES_SPRITE_DICT: FuturesSpriteItem[] = [
  { symbol: 'AU0', name: '沪金主力', targetTab: 'fact-fupeng', note: '确定买点 / 付鹏黄金锚' },
  { symbol: 'AG0', name: '沪银主力', targetTab: 'fact-fupeng', note: '确定买点 / 金银比空头腿' },
  { symbol: 'SC0', name: '上海原油', targetTab: 'fact-fupeng', note: '确定买点 / 油金比锚' },
  { symbol: 'EC0', name: '欧线集运', targetTab: 'fact-fupeng', note: '确定买点 / 航运Back溢价' },
  { symbol: 'MA0', name: '甲醇主力', targetTab: 'fact-fupeng', note: '确定买点 / 港口去库' },
  { symbol: 'CU0', name: '沪铜主力', targetTab: 'panda-pm', note: '铜金比需求锚 / F10 PM' },
  { symbol: 'LC0', name: '碳酸锂主力', targetTab: 'consensus-cpo', note: '期限结构 / 储能锚' },
  { symbol: 'TL0', name: '30年国债期指', targetTab: 'fact-fupeng', note: '付鹏哑铃左端利率锚' },
  { symbol: 'T0', name: '10年国债期指', targetTab: 'fact-fupeng', note: '付鹏哑铃左端国债' },
  { symbol: 'IC0', name: '中证500期指', targetTab: 'consensus-cpo', note: 'CPO五节点/FICC对冲' },
  { symbol: 'IM0', name: '中证1000期指', targetTab: 'consensus-cpo', note: '小盘拥挤波动对冲' },
  { symbol: 'IF0', name: '沪深300期指', targetTab: 'panda-pm', note: '股指主力跨市场映射' },
  { symbol: 'IH0', name: '上证50期指', targetTab: 'panda-pm', note: '权重红利期指对冲' },
  { symbol: 'RB0', name: '螺纹钢主力', targetTab: 'fact-fupeng', note: '付鹏地产黑色去杠杆' },
  { symbol: 'FG0', name: '玻璃主力', targetTab: 'fact-fupeng', note: '付鹏地产过剩对冲' },
  { symbol: 'I0', name: '铁矿石主力', targetTab: 'fact-fupeng', note: '黑色产业链估值锚' },
  { symbol: 'AL0', name: '沪铝主力', targetTab: 'panda-pm', note: '能源电解铝成本映射' },
  { symbol: 'SI0', name: '工业硅主力', targetTab: 'panda-pm', note: '多晶/光伏供需期限' },
  { symbol: 'M0', name: '豆粕主力', targetTab: 'panda-pm', note: '农产品气象库存PM' },
  { symbol: 'P0', name: '棕榈油主力', targetTab: 'panda-pm', note: '东南亚生柴与厄尔尼诺' },
  { symbol: 'FU0', name: '燃料油主力', targetTab: 'panda-pm', note: '高胜率中东航运能化' },
];

class PageErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey: string },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { children: React.ReactNode; resetKey: string }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error?.message || '模块渲染异常' };
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, errorMsg: '' });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-[#8b95a5] p-6 bg-[#0e1117]">
          <div className="text-[#ff3535] text-xs font-mono">模块异常: {this.state.errorMsg}</div>
          <button
            onClick={() => this.setState({ hasError: false, errorMsg: '' })}
            className="px-3 py-1 bg-[#1b2434] border border-[#2f3b4e] text-[#dfe6f0] text-xs hover:border-[#ff8800]"
          >
            重试加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTabId>(getInitialTabFromUrl);
  const [isPopout] = useState<boolean>(getIsPopoutFromUrl);
  const [selectedStock, setSelectedStock] = useState<{
    code: string;
    name?: string;
    date?: string;
  } | null>(null);
  const [analysisCode, setAnalysisCode] = useState<string>('600519');
  const [aiOpen, setAiOpen] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [streamConnected, setStreamConnected] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [breadthStat, setBreadthStat] = useState<{
    up: number;
    flat: number;
    down: number;
    limitUp: number;
    limitDown: number;
  } | null>(null);
  const [paperSummary, setPaperSummary] = useState<RealtimePulsePayload['paperSummary'] | null>(null);
  const [saasDiag, setSaasDiag] = useState<SaasSystemDiagnostics | null>(null);
  const [seatMenuOpen, setSeatMenuOpen] = useState(false);
  const [liveAlerts, setLiveAlerts] = useState<AlertTriggerEvent[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [apiLatencyMs, setApiLatencyMs] = useState<number | null>(null);
  const [commandStrip, setCommandStrip] = useState<GlobalCommandStripSummary | null>(null);
  const [showCommandStrip, setShowCommandStrip] = useState<boolean>(true);
  const [lastSyncClock, setLastSyncClock] = useState<string>(() =>
    new Date().toLocaleTimeString('zh-CN', { hour12: false })
  );
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [tenantNonce, setTenantNonce] = useState(0);

  const [clockText, setClockText] = useState(() =>
    new Date().toLocaleTimeString('zh-CN', { hour12: false })
  );

  // Global Keyboard Sprite (键盘精灵)
  const [spriteOpen, setSpriteOpen] = useState(false);
  const [spriteQuery, setSpriteQuery] = useState('');
  const [spriteStocks, setSpriteStocks] = useState<StockSearchItem[]>([]);
  const [spriteIndex, setSpriteIndex] = useState(0);
  const spriteInputRef = useRef<HTMLInputElement>(null);

  const fetchSaasAndPaper = useCallback(async () => {
    try {
      const [diag, paper, strip] = await Promise.all([
        api.getSaasDiagnostics().catch(() => null),
        api.getPaperDesk().catch(() => null),
        api.getCommandStrip().catch(() => null),
      ]);
      if (diag) {
        setSaasDiag(diag);
      }
      if (strip) {
        setCommandStrip(strip);
        setLastSyncClock(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      }
      if (paper?.activePortfolio) {
        setPaperSummary({
          portfolioName: paper.activePortfolio.name,
          totalEquity: paper.activePortfolio.totalEquity,
          totalReturnPct: paper.activePortfolio.totalReturnPct,
          unrealizedPnl: paper.activePortfolio.unrealizedPnl,
        });
      }
    } catch {
      // SaaS / Paper endpoints may still be booting
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    const t0 = performance.now();
    try {
      const res = await api.getHealth();
      setApiLatencyMs(Math.max(1, Math.round(performance.now() - t0)));
      setHealth(res);
      if (res.indices?.length) {
        setIndices(res.indices);
      }
      // Pull compact breadth numbers for bottom status bar
      api
        .getDashboard()
        .then((dash) => {
          if (dash?.breadth) {
            setBreadthStat({
              up: dash.breadth.up,
              flat: dash.breadth.flat,
              down: dash.breadth.down,
              limitUp: dash.breadth.limitUp,
              limitDown: dash.breadth.limitDown,
            });
          }
        })
        .catch(() => {});
    } catch {
      // Backend might still be booting
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchSaasAndPaper();
  }, [fetchStatus, fetchSaasAndPaper, refreshNonce, tenantNonce]);

  useEffect(() => {
    if (!liveEnabled) {
      setStreamConnected(false);
      return;
    }
    const unsub = subscribeRealtimeStream({
      onStatusChange: (connected) => setStreamConnected(connected),
      onPulse: (pulse) => {
        if (pulse.indices?.length) {
          setIndices(pulse.indices);
        }
        if (pulse.breadth) {
          setBreadthStat(pulse.breadth);
        }
        if (pulse.paperSummary) {
          setPaperSummary(pulse.paperSummary);
        }
        setLastSyncClock(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      },
      onJobTick: (tick) => {
        if (tick.commandStrip) {
          setCommandStrip(tick.commandStrip);
        }
        setLastSyncClock(
          tick.timestamp?.length >= 19
            ? tick.timestamp.slice(11, 19)
            : new Date().toLocaleTimeString('zh-CN', { hour12: false })
        );
      },
      onAlert: (evt) => {
        setLiveAlerts((prev) => [evt, ...prev].slice(0, 4));
      },
    });
    return () => {
      unsub();
      setStreamConnected(false);
    };
  }, [liveEnabled, tenantNonce]);

  useEffect(() => {
    if (!liveEnabled || streamConnected) return;
    const timer = setInterval(fetchStatus, 15000);
    return () => clearInterval(timer);
  }, [liveEnabled, streamConnected, fetchStatus]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  const handleSwitchSeat = useCallback(async (userId: string) => {
    try {
      const res = await api.switchDemoSeat(userId);
      setSaasSession(res.token, res.user.id);
      setSeatMenuOpen(false);
      setTenantNonce((n) => n + 1);
      setRefreshNonce((n) => n + 1);
    } catch {
      setSeatMenuOpen(false);
    }
  }, []);

  const handleTenantChanged = useCallback(() => {
    setTenantNonce((n) => n + 1);
    setRefreshNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setClockText(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Matching shortcuts for Keyboard Sprite
  const matchedShortcuts = useMemo(() => {
    const q = spriteQuery.trim().toLowerCase();
    if (!q) return TOP_RIBBON_TABS.slice(0, 6);
    return TOP_RIBBON_TABS.filter(
      (t) => t.keyLabel.toLowerCase().includes(q) || t.label.toLowerCase().includes(q)
    );
  }, [spriteQuery]);

  const matchedFutures = useMemo(() => {
    const q = spriteQuery.trim().toLowerCase();
    if (!q) return [];
    return FUTURES_SPRITE_DICT.filter(
      (f) => f.symbol.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
    ).slice(0, 6);
  }, [spriteQuery]);

  type SpriteEntry =
    | { kind: 'stock'; item: StockSearchItem }
    | { kind: 'futures'; item: FuturesSpriteItem }
    | { kind: 'tab'; item: TopRibbonTab };

  const spriteEntries: SpriteEntry[] = useMemo(() => {
    const list: SpriteEntry[] = [];
    for (const f of matchedFutures) list.push({ kind: 'futures', item: f });
    for (const s of spriteStocks) list.push({ kind: 'stock', item: s });
    for (const t of matchedShortcuts) list.push({ kind: 'tab', item: t });
    return list;
  }, [matchedFutures, spriteStocks, matchedShortcuts]);

  useEffect(() => {
    setSpriteIndex(0);
  }, [spriteEntries.length, spriteQuery]);

  useEffect(() => {
    const q = spriteQuery.trim();
    if (!q) {
      setSpriteStocks([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const list = await api.searchStocks(q);
        setSpriteStocks(list.slice(0, 8));
      } catch {
        setSpriteStocks([]);
      }
    }, 140);
    return () => clearTimeout(timer);
  }, [spriteQuery]);

  const executeSpriteEntry = useCallback((entry: SpriteEntry | undefined) => {
    if (!entry) return;
    if (entry.kind === 'stock') {
      setSelectedStock({ code: entry.item.code, name: entry.item.name });
    } else if (entry.kind === 'futures') {
      try {
        window.localStorage.setItem('tsp_focus_symbol', entry.item.symbol);
      } catch {
        // ignore storage access issues
      }
      setActiveTab(entry.item.targetTab);
      window.dispatchEvent(new CustomEvent('tsp:focus-symbol', { detail: entry.item.symbol }));
    } else {
      setActiveTab(entry.item.primaryTab);
    }
    setSpriteOpen(false);
    setSpriteQuery('');
  }, []);

  // Global keyboard listener for 同花顺 Keyboard Sprite + F1-F11 shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === 'Escape' && spriteOpen) {
        e.preventDefault();
        setSpriteOpen(false);
        setSpriteQuery('');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSpriteOpen(true);
        setTimeout(() => spriteInputRef.current?.focus(), 0);
        return;
      }

      // F1..F12 quick tab switch (only when modal is closed)
      if (!selectedStock && /^F([1-9]|1[0-2])$/.test(e.key)) {
        const match = TOP_RIBBON_TABS.find((t) => t.keyLabel === e.key);
        if (match) {
          e.preventDefault();
          setActiveTab(match.primaryTab);
          return;
        }
      }

      if (spriteOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSpriteIndex((i) => Math.min(Math.max(0, spriteEntries.length - 1), i + 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSpriteIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === 'Enter' && spriteEntries.length > 0) {
          e.preventDefault();
          executeSpriteEntry(spriteEntries[spriteIndex]);
          return;
        }
      }

      // Pop up Keyboard Sprite automatically when typing alphanumeric outside inputs
      if (
        !isEditing &&
        !selectedStock &&
        !aiOpen &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        /^[a-zA-Z0-9]$/.test(e.key)
      ) {
        e.preventDefault();
        setSpriteOpen(true);
        setSpriteQuery(e.key);
        setTimeout(() => spriteInputRef.current?.focus(), 0);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [spriteOpen, spriteEntries, spriteIndex, selectedStock, aiOpen, executeSpriteEntry]);

  const handleSelectStock = useCallback((code: string, name?: string, date?: string) => {
    if (!code) return;
    setSelectedStock({ code, name, date });
  }, []);

  const handleNavigate = useCallback((tab: string) => {
    setActiveTab(tab as NavTabId);
  }, []);

  const handleJumpToAnalysis = useCallback((code: string, tab: 'stock' | 'finance') => {
    setAnalysisCode(code);
    setActiveTab(tab);
  }, []);

  const renderPage = () => {
    switch (activeTab) {
      case 'panda-pm':
        return (
          <PandaPmCommandPage
            key={`ppm-${refreshNonce}`}
            onSelectStock={handleSelectStock}
            onNavigate={handleNavigate}
          />
        );
      case 'consensus-cpo':
        return (
          <ConsensusCpoPage
            key={`ccpo-${refreshNonce}`}
            onSelectStock={handleSelectStock}
            onNavigate={handleNavigate}
          />
        );
      case 'fact-fupeng':
        return (
          <FactFupengPage
            key={`ffp-${refreshNonce}`}
            onSelectStock={handleSelectStock}
            onNavigate={handleNavigate}
          />
        );
      case 'saas-desk':
        return (
          <SaasEnterprisePage
            key={`saas-${tenantNonce}-${refreshNonce}`}
            onSelectStock={handleSelectStock}
            onNavigate={handleNavigate}
            onTenantChanged={handleTenantChanged}
          />
        );
      case 'dashboard':
        return (
          <DashboardPage
            key={`dash-${refreshNonce}`}
            onSelectStock={handleSelectStock}
            onNavigate={handleNavigate}
          />
        );
      case 'watchlist':
        return <WatchlistPage key={`wl-${refreshNonce}`} onSelectStock={handleSelectStock} />;
      case 'strategy':
        return (
          <StrategyScreenerPage
            key={`strat-${refreshNonce}`}
            onSelectStock={handleSelectStock}
            initialTab="strategy"
          />
        );
      case 'factor':
        return (
          <StrategyScreenerPage
            key={`fac-${refreshNonce}`}
            onSelectStock={handleSelectStock}
            initialTab="factor"
          />
        );
      case 'backtest':
        return (
          <BacktestPage
            key={`bt-${refreshNonce}`}
            onSelectStock={handleSelectStock}
            onNavigate={handleNavigate}
          />
        );
      case 'stock':
        return (
          <StockAnalysisPage
            key={`stk-${analysisCode}-${refreshNonce}`}
            onSelectStock={handleSelectStock}
            initialTab="stock"
            defaultCode={analysisCode}
          />
        );
      case 'finance':
        return (
          <StockAnalysisPage
            key={`fin-${analysisCode}-${refreshNonce}`}
            onSelectStock={handleSelectStock}
            initialTab="finance"
            defaultCode={analysisCode}
          />
        );
      case 'ladder':
        return <LimitUpLadderPage key={`lad-${refreshNonce}`} onSelectStock={handleSelectStock} />;
      case 'concept':
        return <ConceptAnalysisPage key={`con-${refreshNonce}`} onSelectStock={handleSelectStock} />;
      case 'industry':
        return <IndustryAnalysisPage key={`ind-${refreshNonce}`} onSelectStock={handleSelectStock} />;
      case 'monitor':
        return (
          <MonitorCenterPage
            key={`mon-${refreshNonce}`}
            onSelectStock={handleSelectStock}
            initialTab="monitor"
          />
        );
      case 'anomaly':
        return (
          <MonitorCenterPage
            key={`ano-${refreshNonce}`}
            onSelectStock={handleSelectStock}
            initialTab="anomaly"
          />
        );
      case 'market-env':
        return <MarketEnvPage key={`env-${refreshNonce}`} onSelectStock={handleSelectStock} />;
      default:
        return (
          <DashboardPage
            key={`dash-def-${refreshNonce}`}
            onSelectStock={handleSelectStock}
            onNavigate={handleNavigate}
          />
        );
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#090c10] text-[#dfe6f0]">
      {/* Top 28px Wind Menu & Workspace Ribbon */}
      <header className="h-[28px] shrink-0 bg-[#141923] border-b border-[#222832] flex items-center justify-between select-none z-30">
        <div className="flex items-center h-full min-w-0 overflow-x-auto">
          <div className="h-full px-2.5 bg-[#ff8800] text-[#090c10] font-bold text-[11px] flex items-center shrink-0 tracking-tight">
            {isPopout ? 'W·TSP 独立副屏' : 'W·TSP 终端'}
          </div>

          <nav className="flex items-center h-full">
            {TOP_RIBBON_TABS.map((t) => {
              const isActive = t.tabs.includes(activeTab);
              return (
                <button
                  key={t.keyLabel}
                  onClick={() => setActiveTab(t.primaryTab)}
                  className={`h-full px-2.5 text-[11px] border-r border-[#222832] whitespace-nowrap flex items-center gap-1 transition-colors ${
                    isActive
                      ? 'bg-[#0e1117] text-[#ff9500] border-t-2 border-t-[#ff8800] font-semibold'
                      : t.isAlpha
                      ? 'text-[#f0b90b] hover:bg-[#1b2230]'
                      : 'text-[#9aa5b5] hover:text-[#dfe6f0] hover:bg-[#1b2230]'
                  }`}
                >
                  <span className="font-mono text-[10px] text-[#6d7787]">{t.keyLabel}</span>
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Controls: SSE Stream + Seat Switcher + Keyboard Sprite + AI Terminal + Fullscreen + Clock */}
        <div className="flex items-center h-full shrink-0 border-l border-[#222832] relative">
          {/* Stream / Poll Indicator */}
          <button
            onClick={() => setLiveEnabled((v) => !v)}
            className="h-full px-2 bg-[#0e1117] hover:bg-[#181f2c] text-[10px] font-mono border-r border-[#222832] flex items-center gap-1 whitespace-nowrap"
            title={streamConnected ? 'SSE 实时推送已连接 (点击暂停/恢复)' : '15s REST 轮询兜底 (点击暂停/恢复)'}
          >
            <span
              className={
                !liveEnabled
                  ? 'text-[#7d8796]'
                  : streamConnected
                  ? 'text-[#00c853]'
                  : 'text-[#f0b90b]'
              }
            >
              {!liveEnabled ? '[STREAM 暂停]' : streamConnected ? '[STREAM 实时流]' : '[POLL 轮询]'}
            </span>
          </button>

          {/* Active Tenant Seat & Equity Pill + Quick Seat Switcher */}
          <div className="relative h-full">
            <button
              onClick={() => setSeatMenuOpen((v) => !v)}
              className="h-full px-2 bg-[#111620] hover:bg-[#18202e] text-[10px] font-mono border-r border-[#222832] flex items-center gap-1.5 whitespace-nowrap"
              title="点击切换机构席位或进入 OMS 实盘/SaaS"
            >
              <span className="text-[#9aa5b5]">席位:</span>
              <span className="text-[#e5b567] font-semibold">
                {saasDiag?.currentUser?.displayName || '机构席位'}
              </span>
              {paperSummary && (
                <>
                  <span className="text-[#3b4558]">|</span>
                  <span className="text-[#dfe6f0] tabular-nums">
                    净值 ¥{(paperSummary.totalEquity / 10000).toFixed(2)}万
                  </span>
                  <span
                    className={`tabular-nums ${
                      paperSummary.totalReturnPct >= 0 ? 'text-[#ff3535]' : 'text-[#00c853]'
                    }`}
                  >
                    {paperSummary.totalReturnPct >= 0 ? '+' : ''}
                    {paperSummary.totalReturnPct.toFixed(2)}%
                  </span>
                </>
              )}
            </button>

            {seatMenuOpen && (
              <div className="absolute right-0 top-[28px] w-[260px] bg-[#141923] border border-[#2f3b4e] shadow-2xl z-50 text-[11px]">
                <div className="h-[24px] px-2 bg-[#1c2331] border-b border-[#222832] flex items-center justify-between text-[#dfe6f0] font-semibold">
                  <span>租户席位快切 (SQLite WAL)</span>
                  <button
                    onClick={() => setSeatMenuOpen(false)}
                    className="text-[#7d8796] hover:text-[#dfe6f0] font-mono"
                  >
                    [x]
                  </button>
                </div>
                <div className="divide-y divide-[#1d2430]">
                  {(saasDiag?.availableSeats || []).map((seat) => {
                    const current = seat.id === saasDiag?.currentUser?.id;
                    return (
                      <button
                        key={seat.id}
                        onClick={() => handleSwitchSeat(seat.id)}
                        className={`w-full px-2.5 py-1.5 text-left flex items-center justify-between hover:bg-[#1b2230] ${
                          current ? 'bg-[#0e1117] border-l-2 border-l-[#ff8800]' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-[#dfe6f0] truncate">{seat.displayName}</div>
                          <div className="text-[10px] font-mono text-[#7d8796]">
                            {seat.username} · {seat.seatRole}
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-[#f0b90b] shrink-0">
                          {seat.planTier.toUpperCase()}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => {
                    setSeatMenuOpen(false);
                    setActiveTab('saas-desk');
                  }}
                  className="w-full h-[26px] px-2.5 bg-[#0e1117] hover:bg-[#1b2434] border-t border-[#222832] text-[#4da3ff] text-left font-mono"
                >
                  打开 OMS 实盘交易柜台与 SaaS &gt;
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              setSpriteOpen(true);
              setTimeout(() => spriteInputRef.current?.focus(), 0);
            }}
            className="h-full px-2.5 bg-[#0e1117] hover:bg-[#181f2c] text-[11px] text-[#8b95a5] border-r border-[#222832] flex items-center gap-2 font-mono"
            title="键盘精灵: 直接按键输入代码/简称 (Ctrl+K)"
          >
            <span className="text-[#e5b567]">代码/简称</span>
            <span className="text-[#5d6777]">键盘精灵</span>
          </button>

          <button
            onClick={() => setAiOpen(true)}
            className="h-full px-2.5 bg-[#161c26] hover:bg-[#1e2736] text-[11px] text-[#4da3ff] font-medium border-r border-[#222832] whitespace-nowrap"
          >
            AI研报终端
          </button>

          <button
            onClick={() => setShowCommandStrip((v) => !v)}
            className={`h-full px-2 text-[10px] font-mono border-r border-[#222832] whitespace-nowrap ${
              showCommandStrip
                ? 'bg-[#151c28] text-[#ff8800] hover:bg-[#1b2434]'
                : 'bg-[#0e1117] text-[#7d8796] hover:bg-[#181f2c]'
            }`}
            title="显示/隐藏顶部跨维作战联立条 (付鹏FICC / CPO五节点 / 4/4买点 / 后台抓取状态)"
          >
            [作战条]
          </button>

          <button
            onClick={() => {
              if (window.tspDesktop?.openPopout) {
                void window.tspDesktop.openPopout(activeTab, false);
              } else {
                window.open(
                  `${window.location.origin}/?popout=1&tab=${encodeURIComponent(activeTab)}`,
                  '_blank',
                  'noopener,width=1320,height=840'
                );
              }
            }}
            className="h-full px-2 bg-[#111620] hover:bg-[#1b2434] text-[10px] font-mono text-[#e5b567] border-r border-[#222832] whitespace-nowrap"
            title="将当前工作区拆出独立多屏副窗口 (?popout=1)"
          >
            [拆窗副屏]
          </button>

          <button
            onClick={handleToggleFullscreen}
            className="h-full px-2 bg-[#0e1117] hover:bg-[#181f2c] text-[10px] font-mono text-[#9aa5b5] border-r border-[#222832] whitespace-nowrap"
            title="切换终端全屏 (适合桌面端多屏展示)"
          >
            {isFullscreen ? '[退出全屏]' : '[全屏]'}
          </button>

          <div className="h-full px-2.5 flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-[#dfe6f0] bg-[#10141c] whitespace-nowrap">
            <span className="text-[#7d8796] hidden xl:inline">
              {health?.tradingDate || '--'}
            </span>
            <span>{clockText}</span>
          </div>
        </div>
      </header>

      {/* Compact 24px Global Alpha Command Strip */}
      {showCommandStrip && (
        <div className="h-[24px] shrink-0 bg-[#0d1118] border-b border-[#222832] px-2 flex items-center justify-between gap-2 text-[11px] font-mono select-none overflow-x-auto z-20">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setActiveTab('fact-fupeng')}
              className="flex items-center gap-1.5 hover:bg-[#18202e] px-1.5 h-[20px] whitespace-nowrap shrink-0"
              title="点击直达 确定买点 & 付鹏24h宏观FICC工作台"
            >
              <span className="w-[2px] h-2.5 bg-[#ff8800]" />
              <span className="text-[#7d8796]">付鹏FICC:</span>
              <span className="text-[#f0b90b] max-w-[260px] truncate font-sans">
                {commandStrip?.fupengRegime || '正在同步FICC框架...'}
              </span>
              <span className="text-[#5d6777] tabular-nums">
                ({commandStrip?.fupengIntelCount ?? '--'}条)
              </span>
            </button>

            <span className="text-[#222832]">|</span>

            <div className="flex items-center gap-1 whitespace-nowrap shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('fact-fupeng')}
                className="text-[#7d8796] hover:text-[#dfe6f0]"
              >
                4/4确定买点:
              </button>
              {commandStrip && commandStrip.fact4of4Symbols.length > 0 ? (
                commandStrip.fact4of4Symbols.map((item) => (
                  <button
                    key={item.symbol}
                    type="button"
                    onClick={() => {
                      try {
                        window.localStorage.setItem('tsp_focus_symbol', item.symbol);
                      } catch {
                        // ignore
                      }
                      setActiveTab('fact-fupeng');
                      window.dispatchEvent(
                        new CustomEvent('tsp:focus-symbol', { detail: item.symbol })
                      );
                    }}
                    className="px-1.5 h-[18px] bg-[#2a1706] border border-[#ff8800] text-[#ff8800] hover:bg-[#3a2009] text-[10px] font-semibold"
                  >
                    {item.symbol} {item.name}
                  </button>
                ))
              ) : commandStrip && commandStrip.fact3of4Symbols.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setActiveTab('fact-fupeng')}
                  className="px-1.5 h-[18px] bg-[#211c08] border border-[#f0b90b] text-[#f0b90b] text-[10px]"
                >
                  3/4临近: {commandStrip.fact3of4Symbols.map((s) => s.symbol).join('/')}
                </button>
              ) : (
                <span className="text-[#6d7787] text-[10px]">巡检扫描中</span>
              )}
            </div>

            <span className="text-[#222832]">|</span>

            <button
              type="button"
              onClick={() => setActiveTab('consensus-cpo')}
              className="flex items-center gap-1.5 hover:bg-[#18202e] px-1.5 h-[20px] whitespace-nowrap shrink-0"
              title="点击直达 F12 CPO五节点贝叶斯传导"
            >
              <span className="text-[#7d8796]">CPO五节点:</span>
              <span className="text-[#4da3ff] tabular-nums">
                门控 {commandStrip?.cpoGatesPassed ?? 0}/{commandStrip?.cpoGatesTotal ?? 4}
              </span>
              <span className="text-[#cfd8e3] font-sans max-w-[200px] truncate">
                {commandStrip?.cpoRegime || '--'}
              </span>
              {commandStrip?.tmtCrowdingPct !== null &&
                commandStrip?.tmtCrowdingPct !== undefined && (
                  <span
                    className={`tabular-nums text-[10px] ${
                      commandStrip.tmtCrowdingPct >= 38 ? 'text-[#ff3535]' : 'text-[#8b95a5]'
                    }`}
                  >
                    (TMT {commandStrip.tmtCrowdingPct.toFixed(1)}%)
                  </span>
                )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('saas-desk')}
            className="flex items-center gap-1.5 px-1.5 h-[20px] hover:bg-[#18202e] whitespace-nowrap shrink-0 text-[10px] tabular-nums"
            title="点击查看 5 路后台 24h 自动抓取任务与 SQLite WAL 诊断"
          >
            <span
              className={`w-1.5 h-1.5 ${
                streamConnected ? 'bg-[#00c853]' : 'bg-[#f0b90b]'
              }`}
            />
            <span className="text-[#00c853]">
              自动抓取 {commandStrip?.activeJobsOk ?? 0}/{commandStrip?.totalJobs ?? 5} 守护
            </span>
            {commandStrip?.sessionLabel && (
              <span className="px-1 py-0.5 bg-[#161b24] border border-[#222832] text-[#e5b567] text-[9px]">
                {commandStrip.sessionLabel}
              </span>
            )}
            <span className="text-[#6d7787]">· 同步 {lastSyncClock}</span>
          </button>
        </div>
      )}

      {/* Main Middle Area: 44px Rail (hidden in popout) + Edge-to-Edge Workspace */}
      <div className="flex-1 min-h-0 flex">
        {!isPopout && (
          <Sidebar
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            health={health}
            indices={indices}
            liveEnabled={liveEnabled}
            onToggleLive={() => setLiveEnabled((v) => !v)}
            onOpenAi={() => setAiOpen(true)}
            onRefreshData={() => setRefreshNonce((n) => n + 1)}
            onSelectStock={(code, name) => handleSelectStock(code, name)}
          />
        )}

        <main className="flex-1 min-w-0 h-full overflow-y-auto bg-[#090c10]">
          <PageErrorBoundary resetKey={activeTab}>
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full text-xs font-mono text-[#8b95a5] bg-[#0e1117]">
                  正在加载终端模块...
                </div>
              }
            >
              {renderPage()}
            </Suspense>
          </PageErrorBoundary>
        </main>
      </div>

      {/* Bottom Fixed 24px 同花顺/Wind Live Status & Index Bar */}
      <footer className="h-[24px] shrink-0 bg-[#121720] border-t border-[#222832] px-2 flex items-center justify-between text-[11px] font-mono tabular-nums select-none z-30">
        <div className="flex items-center gap-3 overflow-x-auto">
          {(indices.length
            ? indices
            : [
                { code: '000001.SH', name: '上证指数', price: 0, change: 0, changePct: 0 },
                { code: '399001.SZ', name: '深证成指', price: 0, change: 0, changePct: 0 },
                { code: '399006.SZ', name: '创业板指', price: 0, change: 0, changePct: 0 },
                { code: '000680.SH', name: '科创综指', price: 0, change: 0, changePct: 0 },
              ]
          )
            .slice(0, 4)
            .map((idx) => {
              const pct = idx.changePct ?? 0;
              const cls =
                idx.price === 0
                  ? 'text-[#8b949e]'
                  : pct >= 0
                  ? 'text-[#ff3535]'
                  : 'text-[#00c853]';
              return (
                <button
                  key={idx.code}
                  onClick={() => handleSelectStock(idx.code, idx.name)}
                  className="flex items-center gap-1.5 hover:bg-[#1b2230] px-1.5 h-[22px] whitespace-nowrap"
                >
                  <span className="text-[#9aa5b5] font-sans">{idx.name}</span>
                  <span className={`font-semibold ${cls}`}>
                    {idx.price > 0 ? idx.price.toFixed(2) : '--'}
                  </span>
                  <span className={cls}>
                    {idx.price > 0 ? `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%` : '--'}
                  </span>
                  {idx.amount ? (
                    <span className="text-[#f0b90b] hidden 2xl:inline">
                      {formatAmount(idx.amount)}
                    </span>
                  ) : null}
                </button>
              );
            })}
        </div>

        <div className="flex items-center gap-3 shrink-0 text-[11px] text-[#8b95a5]">
          {breadthStat && (
            <>
              <span>
                涨:<span className="text-[#ff3535]">{breadthStat.up}</span> 平:
                <span className="text-[#dfe6f0]">{breadthStat.flat}</span> 跌:
                <span className="text-[#00c853]">{breadthStat.down}</span>
              </span>
              <span className="text-[#2c3545]">|</span>
              <span>
                涨停:<span className="text-[#ff3535]">{breadthStat.limitUp}</span> 跌停:
                <span className="text-[#00c853]">{breadthStat.limitDown}</span>
              </span>
              <span className="text-[#2c3545]">|</span>
            </>
          )}
          <span>
            主站{' '}
            <span className="text-[#00c853]">
              {health?.healthyCount ?? 5}/{health?.totalCount ?? 7} 正常
            </span>
            {apiLatencyMs !== null ? ` (${apiLatencyMs}ms)` : ''}
          </span>
        </div>
      </footer>

      {/* Global 同花顺 键盘精灵 (Keyboard Sprite) */}
      {spriteOpen && (
        <div className="fixed bottom-7 right-2 w-[340px] bg-[#141923] border border-[#ff8800] z-50 shadow-2xl">
          <div className="h-[24px] bg-[#1a212e] border-b border-[#252d3b] px-2 flex items-center justify-between text-[11px]">
            <span className="text-[#ff9500] font-semibold">键盘精灵 · 证券代码/快捷键</span>
            <button
              onClick={() => {
                setSpriteOpen(false);
                setSpriteQuery('');
              }}
              className="text-[#8b95a5] hover:text-white font-mono"
            >
              [ESC]
            </button>
          </div>
          <div className="p-1.5 border-b border-[#222832] bg-[#0e1117]">
            <input
              ref={spriteInputRef}
              type="text"
              value={spriteQuery}
              onChange={(e) => setSpriteQuery(e.target.value)}
              placeholder="输入股票代码/简称/F1-F11..."
              className="w-full h-[26px] px-2 bg-[#090c10] border border-[#2c3647] focus:border-[#ff8800] text-xs font-mono text-[#dfe6f0] outline-none"
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto divide-y divide-[#1a202b]">
            {spriteEntries.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-[#6d7787]">
                未找到匹配证券或快捷键
              </div>
            ) : (
              spriteEntries.map((entry, idx) => {
                const selected = idx === spriteIndex;
                if (entry.kind === 'stock') {
                  const pct = entry.item.changePct ?? 0;
                  const c = pct >= 0 ? 'text-[#ff3535]' : 'text-[#00c853]';
                  return (
                    <button
                      key={`s-${entry.item.code}`}
                      onMouseEnter={() => setSpriteIndex(idx)}
                      onClick={() => executeSpriteEntry(entry)}
                      className={`w-full h-[26px] px-2 flex items-center justify-between text-xs font-mono ${
                        selected ? 'bg-[#1f293b]' : 'hover:bg-[#18202e]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[#e5b567]">{entry.item.code}</span>
                        <span className="text-[#e8edf5] font-sans truncate">
                          {entry.item.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 tabular-nums">
                        {entry.item.price !== undefined && (
                          <span className="text-[#dfe6f0]">{entry.item.price.toFixed(2)}</span>
                        )}
                        {entry.item.changePct !== undefined && (
                          <span className={c}>
                            {pct >= 0 ? '+' : ''}
                            {pct.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    </button>
                  );
                }
                if (entry.kind === 'futures') {
                  return (
                    <button
                      key={`f-${entry.item.symbol}`}
                      onMouseEnter={() => setSpriteIndex(idx)}
                      onClick={() => executeSpriteEntry(entry)}
                      className={`w-full h-[26px] px-2 flex items-center justify-between text-xs font-mono ${
                        selected ? 'bg-[#1f293b]' : 'hover:bg-[#18202e]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-1 bg-[#241809] border border-[#ff8800] text-[#ff8800] text-[10px]">
                          期货
                        </span>
                        <span className="text-[#e5b567]">{entry.item.symbol}</span>
                        <span className="text-[#e8edf5] font-sans truncate">
                          {entry.item.name}
                        </span>
                      </div>
                      <span className="text-[10px] text-[#8b95a5] font-sans shrink-0">
                        {entry.item.note}
                      </span>
                    </button>
                  );
                }
                return (
                  <button
                    key={`t-${entry.item.keyLabel}`}
                    onMouseEnter={() => setSpriteIndex(idx)}
                    onClick={() => executeSpriteEntry(entry)}
                    className={`w-full h-[26px] px-2 flex items-center justify-between text-xs ${
                      selected ? 'bg-[#1f293b]' : 'hover:bg-[#18202e]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[#ff9500]">{entry.item.keyLabel}</span>
                      <span className="text-[#dfe6f0]">{entry.item.label}</span>
                    </div>
                    <span className="text-[10px] text-[#7d8796]">功能面板</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Stock K-Line & Five-Gear Level-1 Watch Modal */}
      {selectedStock && (
        <StockDetailModal
          code={selectedStock.code}
          name={selectedStock.name}
          initialDate={selectedStock.date}
          onClose={() => setSelectedStock(null)}
          onJumpToAnalysis={handleJumpToAnalysis}
        />
      )}

      {/* Sharp Wind-Style Docked AI Research Terminal Drawer */}
      <AiCyberAgentDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        activeTab={activeTab}
        selectedStock={selectedStock}
        onConfigSaved={(model) =>
          setHealth((prev) => (prev ? { ...prev, activeModel: model } : prev))
        }
      />

      {/* Sharp Wind Bottom-Right SSE Live Push Notification Strip */}
      {liveAlerts.length > 0 && (
        <div className="fixed right-3 bottom-[32px] w-[340px] z-40 flex flex-col gap-1">
          {liveAlerts.map((evt) => {
            const borderCls =
              evt.level === 'critical'
                ? 'border-l-[#ff3535]'
                : evt.level === 'warn'
                ? 'border-l-[#f0b90b]'
                : 'border-l-[#4da3ff]';
            const tagCls =
              evt.level === 'critical'
                ? 'text-[#ff3535]'
                : evt.level === 'warn'
                ? 'text-[#f0b90b]'
                : 'text-[#4da3ff]';
            return (
              <div
                key={evt.id}
                className={`bg-[#141923] border border-[#2f3b4e] border-l-2 ${borderCls} px-2.5 py-1.5 text-[11px] shadow-xl`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0 font-mono">
                    <span className={`font-semibold shrink-0 ${tagCls}`}>
                      [{evt.ruleName}]
                    </span>
                    <button
                      onClick={() => handleSelectStock(evt.code, evt.name)}
                      className="text-[#e5b567] hover:underline truncate"
                    >
                      {evt.code} {evt.name}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 font-mono text-[10px] text-[#7d8796]">
                    <span>{evt.time}</span>
                    <button
                      onClick={() =>
                        setLiveAlerts((prev) => prev.filter((item) => item.id !== evt.id))
                      }
                      className="hover:text-[#dfe6f0]"
                    >
                      [x]
                    </button>
                  </div>
                </div>
                <div className="text-[#c9d2e0] mt-0.5 truncate">{evt.message}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
