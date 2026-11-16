import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import {
  Activity,
  Bell,
  Check,
  Copy,
  Database,
  Download,
  Key,
  Monitor,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Server,
  Shield,
  Trash2,
  UserCheck,
  Users,
  Zap,
} from 'lucide-react';
import { api, formatAmount, setSaasSession, subscribeRealtimeStream } from '../api/client';
import type {
  AlertTriggerEvent,
  ArchivedBacktestItem,
  MonitorRule,
  PaperDeskOverviewResponse,
  PaperOrderRequest,
  PaperPositionItem,
  RealtimePulsePayload,
  SaasApiKeyItem,
  SaasPlanTier,
  SaasSystemDiagnostics,
  WebhookChannelItem,
  WebhookProviderType,
} from '../types/market';

export interface SaasEnterprisePageProps {
  onSelectStock: (code: string, name?: string) => void;
  onNavigate?: (tab: string) => void;
  onTenantChanged?: () => void;
}

type EnterpriseSubTab = 'paper-desk' | 'archive-repo' | 'webhook-gateway' | 'tenant-ops';

interface QuickSignalItem {
  id: string;
  source: 'CPO五节点' | 'PM预期差' | 'PandaAI Top3';
  symbol: string;
  name: string;
  market: 'ashare' | 'futures';
  action: 'buy_long' | 'open_short';
  allocationPct: number;
  leverage: number;
  strategyTag: string;
  rationale: string;
  metricBadge: string;
}

function safeNum(val: unknown, fallback = 0): number {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function fmtNum(val: unknown, digits = 2): string {
  const n = safeNum(val, NaN);
  if (Number.isNaN(n)) return '--';
  return n.toFixed(digits);
}

function fmtPct(val: unknown, digits = 2): string {
  const n = safeNum(val, NaN);
  if (Number.isNaN(n)) return '--';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtCurrency(val: unknown): string {
  const n = safeNum(val, NaN);
  if (Number.isNaN(n)) return '--';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedCurrency(val: unknown): string {
  const n = safeNum(val, NaN);
  if (Number.isNaN(n)) return '--';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function colorUpDown(val: unknown): string {
  const n = safeNum(val, 0);
  if (n > 0) return 'text-[#ff3535]';
  if (n < 0) return 'text-[#00c853]';
  return 'text-[#cfd8e3]';
}

function isAShareSymbol(symbol?: string): boolean {
  if (!symbol) return false;
  return /^\d{6}$/.test(symbol.trim());
}

function shortTime(iso?: string | null): string {
  if (!iso) return '--';
  const s = String(iso).replace('T', ' ').replace('Z', '');
  return s.slice(0, 19);
}

async function downloadWithAuth(url: string, fallbackFilename: string) {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('tsp_saas_token') : null;
  const tenantUser = typeof window !== 'undefined' ? window.localStorage.getItem('tsp_tenant_user') : null;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (tenantUser) headers['X-TSP-Tenant-User'] = tenantUser;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`导出失败 HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  const cd = res.headers.get('content-disposition') || '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  a.download = match ? decodeURIComponent(match[1]) : fallbackFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

function PaneHeader({
  title,
  badge,
  right,
}: {
  title: string;
  badge?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="h-[26px] bg-[#161b24] border-b border-[#222832] px-2.5 flex items-center justify-between gap-2 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-[2px] h-3 bg-[#ff8800] shrink-0" />
        <span className="text-[12px] font-bold text-[#dfe6f0] truncate">{title}</span>
        {badge && (
          <span className="px-1.5 py-0.5 text-[10px] bg-[#0e1117] border border-[#222832] text-[#e5b567] tabular-nums shrink-0">
            {badge}
          </span>
        )}
      </div>
      {right && <div className="flex items-center gap-1.5 text-[11px] text-[#8b95a5] shrink-0">{right}</div>}
    </div>
  );
}

function KpiCell({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'up' | 'down' | 'orange' | 'gold' | 'blue' | 'neutral';
}) {
  const valueClass =
    tone === 'up'
      ? 'text-[#ff3535]'
      : tone === 'down'
      ? 'text-[#00c853]'
      : tone === 'orange'
      ? 'text-[#ff8800]'
      : tone === 'gold'
      ? 'text-[#f0b90b]'
      : tone === 'blue'
      ? 'text-[#4da3ff]'
      : 'text-[#dfe6f0]';

  return (
    <div className="bg-[#0e1117] px-2.5 py-1.5 flex flex-col justify-between min-w-0">
      <div className="text-[10px] text-[#7d8796] truncate">{label}</div>
      <div className={`text-[13px] font-bold tabular-nums leading-tight mt-0.5 truncate ${valueClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-[#6d7787] tabular-nums truncate mt-0.5">{sub}</div>}
    </div>
  );
}

const ACTION_LABEL: Record<PaperOrderRequest['action'], string> = {
  buy_long: '买入做多',
  sell_long: '卖出平多',
  open_short: '开仓做空',
  cover_short: '买入平空',
};

const ENGINE_LABEL: Record<ArchivedBacktestItem['engineType'], string> = {
  ashare_t1: 'A股T+1',
  pm_event: 'PM事件联立',
  cpo_dag: 'CPO五节点',
  alt_consensus: '超前认知',
  futures_t0: '期货T+0',
};

const PROVIDER_LABEL: Record<WebhookProviderType, string> = {
  feishu: '飞书 Feishu',
  dingtalk: '钉钉 DingTalk 加签',
  wecom: '企业微信 WeCom',
  telegram: 'Telegram Bot',
  custom_json: '自定义 JSON Webhook',
};

const EVENT_FILTERS = [
  { id: 'anomaly', label: '盘中异动' },
  { id: 'cpo_gate', label: 'CPO门控切换' },
  { id: 'pm_shock', label: 'PM预期差突变' },
  { id: 'paper_fill', label: '实盘成交成单' },
];

const PLAN_LABELS: Record<SaasPlanTier, string> = {
  free: 'Free 个人体验',
  pro: 'Pro 投研专户',
  institutional: 'Institutional 机构旗舰',
};

export default function SaasEnterprisePage({
  onSelectStock,
  onNavigate,
  onTenantChanged,
}: SaasEnterprisePageProps) {
  const [subTab, setSubTab] = useState<EnterpriseSubTab>('paper-desk');
  const [diagnostics, setDiagnostics] = useState<SaasSystemDiagnostics | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const [lastPulse, setLastPulse] = useState<RealtimePulsePayload | null>(null);
  const [liveAlertBanner, setLiveAlertBanner] = useState<AlertTriggerEvent | null>(null);
  const [globalNotice, setGlobalNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const notify = useCallback((type: 'ok' | 'err', text: string) => {
    setGlobalNotice({ type, text });
  }, []);

  // ==================== [01] Paper Trading Desk State ====================
  const [paperDesk, setPaperDesk] = useState<PaperDeskOverviewResponse | null>(null);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>('');
  const [loadingPaper, setLoadingPaper] = useState(false);
  const [showNewPortfolioBar, setShowNewPortfolioBar] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState('CPO贝叶斯传导组合');
  const [newPortfolioCapital, setNewPortfolioCapital] = useState('1000000');
  const [confirmReset, setConfirmReset] = useState(false);

  // Order Ticket State
  const [orderMarket, setOrderMarket] = useState<'ashare' | 'futures'>('ashare');
  const [orderAction, setOrderAction] = useState<PaperOrderRequest['action']>('buy_long');
  const [orderSymbol, setOrderSymbol] = useState('300308');
  const [orderName, setOrderName] = useState('中际旭创');
  const [sizingMode, setSizingMode] = useState<'qty' | 'pct'>('qty');
  const [orderQty, setOrderQty] = useState('500');
  const [orderAllocPct, setOrderAllocPct] = useState('15');
  const [orderLeverage, setOrderLeverage] = useState(1);
  const [orderStrategyTag, setOrderStrategyTag] = useState('CPO五节点门控');
  const [orderNote, setOrderNote] = useState('');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderFeedback, setOrderFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [orderType, setOrderType] = useState<'MARKET_IOC' | 'LIMIT'>('MARKET_IOC');
  const [orderLimitPrice, setOrderLimitPrice] = useState('');
  const [orderSlippageBps, setOrderSlippageBps] = useState('2.5');
  const [orderStopLossPrice, setOrderStopLossPrice] = useState('');
  const [orderTakeProfitPrice, setOrderTakeProfitPrice] = useState('');
  const [quotePreview, setQuotePreview] = useState<Awaited<ReturnType<typeof api.getOmsQuotePreview>> | null>(null);
  const [loadingQuotePreview, setLoadingQuotePreview] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [editingStopPosId, setEditingStopPosId] = useState<string | null>(null);
  const [editingStopVal, setEditingStopVal] = useState('');
  const [editingTpVal, setEditingTpVal] = useState('');

  // Quick Signals State
  const [quickSignals, setQuickSignals] = useState<QuickSignalItem[]>([]);
  const [loadingSignals, setLoadingSignals] = useState(false);
  const navChartRef = useRef<HTMLDivElement | null>(null);

  // ==================== [02] SQLite Backtest Archive State ====================
  const [archives, setArchives] = useState<ArchivedBacktestItem[]>([]);
  const [loadingArchives, setLoadingArchives] = useState(false);
  const [engineFilter, setEngineFilter] = useState<string>('all');
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveSortBy, setArchiveSortBy] = useState<'createdAt' | 'totalReturnPct' | 'sharpe' | 'maxDrawdownPct' | 'winRatePct'>('createdAt');
  const [archiveSortDir, setArchiveSortDir] = useState<'desc' | 'asc'>('desc');
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const compareChartRef = useRef<HTMLDivElement | null>(null);

  // ==================== [03] Webhook & Alerts State ====================
  const [webhooks, setWebhooks] = useState<WebhookChannelItem[]>([]);
  const [loadingWebhooks, setLoadingWebhooks] = useState(false);
  const [editingWebhookId, setEditingWebhookId] = useState<string | undefined>(undefined);
  const [whName, setWhName] = useState('机构盘中风控飞书群');
  const [whProvider, setWhProvider] = useState<WebhookProviderType>('feishu');
  const [whUrl, setWhUrl] = useState('');
  const [whSecret, setWhSecret] = useState('');
  const [whEvents, setWhEvents] = useState<string[]>(['anomaly', 'cpo_gate', 'pm_shock', 'paper_fill']);
  const [whEnabled, setWhEnabled] = useState(true);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<{ id: string; ok: boolean; statusText: string } | null>(null);

  const [alertRules, setAlertRules] = useState<MonitorRule[]>([]);
  const [alertEvents, setAlertEvents] = useState<AlertTriggerEvent[]>([]);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleCode, setNewRuleCode] = useState('300308');
  const [newRuleMetric, setNewRuleMetric] = useState<MonitorRule['metric']>('changePct');
  const [newRuleThreshold, setNewRuleThreshold] = useState('4');
  const [savingRule, setSavingRule] = useState(false);

  // ==================== [04] Multi-Tenant, OpenAPI, SQLite & Stream Ops State ====================
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register');
  const [authUsername, setAuthUsername] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPlanTier, setAuthPlanTier] = useState<SaasPlanTier>('pro');
  const [authBusy, setAuthBusy] = useState(false);
  const [newKeyName, setNewKeyName] = useState('Quantitative Execution Bot');
  const [creatingKey, setCreatingKey] = useState(false);
  const [revealedKeyOnce, setRevealedKeyOnce] = useState<SaasApiKeyItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = useCallback((id: string, text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1800);
  }, []);

  // ==================== Loaders ====================
  const loadDiagnostics = useCallback(async () => {
    try {
      const diag = await api.getSaasDiagnostics();
      setDiagnostics(diag);
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '获取系统底座诊断失败');
    }
  }, [notify]);

  const loadPaperDesk = useCallback(
    async (portfolioId?: string) => {
      setLoadingPaper(true);
      try {
        const res = await api.getPaperDesk(portfolioId || selectedPortfolioId || undefined);
        setPaperDesk(res);
        if (res.activePortfolio?.id) {
          setSelectedPortfolioId(res.activePortfolio.id);
        }
      } catch (e: unknown) {
        notify('err', e instanceof Error ? e.message : '加载实盘账户组合失败');
      } finally {
        setLoadingPaper(false);
      }
    },
    [notify, selectedPortfolioId]
  );

  const loadQuickSignals = useCallback(async () => {
    setLoadingSignals(true);
    const collected: QuickSignalItem[] = [];
    try {
      const [cpoRes, pmRes] = await Promise.allSettled([
        api.getCpoTransmissionOverview(),
        api.getPandaPmOverview(),
      ]);

      if (cpoRes.status === 'fulfilled') {
        const cpo = cpoRes.value;
        (cpo.playbooks || []).slice(0, 3).forEach((pb, idx) => {
          const sym = pb.symbol || '300308';
          const isFut = !isAShareSymbol(sym);
          collected.push({
            id: `cpo-pb-${idx}-${sym}`,
            source: 'CPO五节点',
            symbol: sym,
            name: pb.name || sym,
            market: isFut ? 'futures' : 'ashare',
            action: pb.action.includes('空') ? 'open_short' : 'buy_long',
            allocationPct: Math.max(5, Math.min(25, Math.round(pb.suggestedWeightPct || 12))),
            leverage: isFut ? 2 : 1,
            strategyTag: 'CPO五节点门控',
            rationale: `${pb.legType} · ${pb.action} · ${pb.entryRule}`,
            metricBadge: `后验${safeNum(cpo.bayesianPosteriorProb).toFixed(0)}% / 建议${safeNum(pb.suggestedWeightPct, 10).toFixed(0)}%`,
          });
        });
        const lagTarget = (cpo.secondOrderTargets || []).find((t) => t.residualZScore < -0.8) || cpo.secondOrderTargets?.[0];
        if (lagTarget) {
          collected.push({
            id: `cpo-lag-${lagTarget.code}`,
            source: 'CPO五节点',
            symbol: lagTarget.code,
            name: lagTarget.name,
            market: 'ashare',
            action: 'buy_long',
            allocationPct: 12,
            leverage: 1,
            strategyTag: 'CPO二阶滞后补涨',
            rationale: `${lagTarget.subSector} · ${lagTarget.catchupSignal} · Beta ${fmtNum(lagTarget.rollingBetaToCpo)}`,
            metricBadge: `Z=${fmtNum(lagTarget.residualZScore)} / 胜率${fmtNum(lagTarget.hitRatePct, 0)}%`,
          });
        }
      }

      if (pmRes.status === 'fulfilled') {
        const pm = pmRes.value;
        const topEvent = [...(pm.pmEvents || [])].sort((a, b) => Math.abs(safeNum(b.change24h)) - Math.abs(safeNum(a.change24h)))[0];
        if (topEvent && topEvent.impactAssets?.length) {
          topEvent.impactAssets.slice(0, 2).forEach((asset, idx) => {
            const isFut = !isAShareSymbol(asset.symbol);
            const isShort = isFut && asset.direction === '做空';
            collected.push({
              id: `pm-ev-${idx}-${asset.symbol}`,
              source: 'PM预期差',
              symbol: asset.symbol,
              name: asset.name,
              market: isFut ? 'futures' : 'ashare',
              action: isShort ? 'open_short' : 'buy_long',
              allocationPct: 10,
              leverage: isFut ? 2 : 1,
              strategyTag: 'PM事件预期差',
              rationale: `${topEvent.title.slice(0, 28)} · ${asset.logic || asset.direction}`,
              metricBadge: `PM ${fmtNum(topEvent.yesProb, 0)}% (${fmtPct(topEvent.change24h, 1)})`,
            });
          });
        }

        const firstFactor = pm.factors?.[0];
        if (firstFactor) {
          try {
            const scan = await api.runPandaFactorScan({
              factorId: firstFactor.id,
              topN: 3,
              universe: 'ashare',
            });
            (scan.targets || []).slice(0, 3).forEach((t, idx) => {
              collected.push({
                id: `panda-f-${idx}-${t.code}`,
                source: 'PandaAI Top3',
                symbol: t.code,
                name: t.name,
                market: isAShareSymbol(t.code) ? 'ashare' : 'futures',
                action: 'buy_long',
                allocationPct: 10,
                leverage: 1,
                strategyTag: `PandaAI:${firstFactor.name.slice(0, 12)}`,
                rationale: t.reason || `${t.signal} · 涨跌${fmtPct(t.changePct)}`,
                metricBadge: `Z=${fmtNum(t.zScore)} · 因子${fmtNum(t.factorValue, 3)}`,
              });
            });
          } catch {
            // ignore factor scan fallback
          }
        }
      }
      setQuickSignals(collected);
    } finally {
      setLoadingSignals(false);
    }
  }, []);

  const loadArchives = useCallback(async (engine = engineFilter) => {
    setLoadingArchives(true);
    try {
      const list = await api.getArchivedBacktests(engine);
      setArchives(Array.isArray(list) ? list : []);
      setCompareIds((prev) => {
        const valid = prev.filter((id) => list.some((r) => r.id === id));
        if (valid.length > 0) return valid;
        return list.slice(0, Math.min(3, list.length)).map((r) => r.id);
      });
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '加载SQLite回测归档失败');
    } finally {
      setLoadingArchives(false);
    }
  }, [engineFilter, notify]);

  const loadWebhooksAndAlerts = useCallback(async () => {
    setLoadingWebhooks(true);
    try {
      const [whList, monRes] = await Promise.all([api.getWebhookChannels(), api.getMonitorRules()]);
      setWebhooks(Array.isArray(whList) ? whList : []);
      setAlertRules(monRes.rules || []);
      setAlertEvents(monRes.events || []);
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '加载Webhook与预警流失败');
    } finally {
      setLoadingWebhooks(false);
    }
  }, [notify]);

  const refreshAllForTenant = useCallback(async () => {
    setSelectedPortfolioId('');
    await Promise.all([
      loadDiagnostics(),
      loadPaperDesk(''),
      loadArchives(engineFilter),
      loadWebhooksAndAlerts(),
    ]);
  }, [engineFilter, loadArchives, loadDiagnostics, loadPaperDesk, loadWebhooksAndAlerts]);

  useEffect(() => {
    loadDiagnostics();
    loadPaperDesk();
    loadQuickSignals();
  }, []);

  const loadQuotePreview = useCallback(async (sym: string, mkt: 'ashare' | 'futures') => {
    const clean = sym.trim();
    if (!clean) return;
    setLoadingQuotePreview(true);
    try {
      const q = await api.getOmsQuotePreview(clean, mkt);
      setQuotePreview(q);
      if (q.name && q.name !== clean) {
        setOrderName(q.name);
      }
    } catch {
      // keep previous preview snapshot on transient network hiccup
    } finally {
      setLoadingQuotePreview(false);
    }
  }, []);

  useEffect(() => {
    if (subTab !== 'paper-desk') return;
    void loadQuotePreview(orderSymbol, orderMarket);
    const timer = setInterval(() => {
      void loadQuotePreview(orderSymbol, orderMarket);
    }, 10000);
    return () => clearInterval(timer);
  }, [subTab, orderSymbol, orderMarket, loadQuotePreview]);

  useEffect(() => {
    if (subTab === 'archive-repo') loadArchives(engineFilter);
    if (subTab === 'webhook-gateway') loadWebhooksAndAlerts();
    if (subTab === 'tenant-ops') loadDiagnostics();
  }, [subTab, engineFilter, loadArchives, loadWebhooksAndAlerts, loadDiagnostics]);

  // Subscribe to SSE Realtime Stream
  useEffect(() => {
    const unsub = subscribeRealtimeStream({
      onConnected: () => setStreamConnected(true),
      onStatusChange: (connected) => setStreamConnected(connected),
      onPulse: (pulse) => {
        setStreamConnected(true);
        setLastPulse(pulse);
      },
      onAlert: (ev) => {
        setStreamConnected(true);
        setLiveAlertBanner(ev);
        setAlertEvents((prev) => [ev, ...prev.filter((x) => x.id !== ev.id)].slice(0, 60));
      },
    });
    return () => {
      setStreamConnected(false);
      unsub();
    };
  }, []);

  // ==================== ECharts: Portfolio NAV Curve ====================
  useEffect(() => {
    const dom = navChartRef.current;
    const nav = paperDesk?.navHistory;
    if (subTab !== 'paper-desk' || !dom || !nav?.length) return;
    const chart = echarts.init(dom);
    chart.setOption({
      backgroundColor: '#0d1015',
      animation: false,
      grid: { left: 56, right: 48, top: 28, bottom: 24 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#161b24',
        borderColor: '#2b3444',
        textStyle: { color: '#dfe6f0', fontSize: 11 },
      },
      legend: {
        top: 4,
        right: 10,
        textStyle: { color: '#9aa5b5', fontSize: 10 },
        itemWidth: 14,
        itemHeight: 8,
        data: ['总净资产(元)', '累计收益率%'],
      },
      xAxis: {
        type: 'category',
        data: nav.map((n) => shortTime(n.timestamp).slice(5, 16)),
        axisLine: { lineStyle: { color: '#222832' } },
        axisLabel: { color: '#7d8796', fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          scale: true,
          splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
          axisLabel: {
            color: '#8b95a5',
            fontSize: 10,
            formatter: (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v)),
          },
        },
        {
          type: 'value',
          splitLine: { show: false },
          axisLabel: { color: '#e5b567', fontSize: 10, formatter: (v: number) => `${v.toFixed(1)}%` },
        },
      ],
      series: [
        {
          name: '总净资产(元)',
          type: 'line',
          data: nav.map((n) => safeNum(n.totalEquity)),
          showSymbol: nav.length <= 12,
          symbolSize: 4,
          lineStyle: { width: 1.8, color: '#ff8800' },
          itemStyle: { color: '#ff8800' },
          areaStyle: { color: 'rgba(255,136,0,0.08)' },
        },
        {
          name: '累计收益率%',
          type: 'line',
          yAxisIndex: 1,
          data: nav.map((n) => safeNum(n.returnPct)),
          showSymbol: false,
          lineStyle: { width: 1.3, color: '#4da3ff', type: 'dashed' },
          itemStyle: { color: '#4da3ff' },
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [paperDesk?.navHistory, subTab]);

  // ==================== ECharts: Archive Multi-Run Comparison ====================
  const comparedRuns = useMemo(
    () => archives.filter((a) => compareIds.includes(a.id)).slice(0, 4),
    [archives, compareIds]
  );

  useEffect(() => {
    const dom = compareChartRef.current;
    if (subTab !== 'archive-repo' || !dom || comparedRuns.length === 0) return;
    const chart = echarts.init(dom);
    chart.setOption({
      backgroundColor: '#0d1015',
      animation: false,
      grid: { left: 42, right: 14, top: 28, bottom: 26 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#161b24',
        borderColor: '#2b3444',
        textStyle: { color: '#dfe6f0', fontSize: 11 },
      },
      legend: {
        top: 4,
        right: 8,
        textStyle: { color: '#9aa5b5', fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8,
        data: ['总收益%', '超额%', '胜率%', '-最大回撤%'],
      },
      xAxis: {
        type: 'category',
        data: comparedRuns.map((r) => `${r.symbol}`),
        axisLine: { lineStyle: { color: '#222832' } },
        axisLabel: { color: '#e5b567', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1a202b', type: 'dashed' } },
        axisLabel: { color: '#8b95a5', fontSize: 10, formatter: (v: number) => `${v}%` },
      },
      series: [
        {
          name: '总收益%',
          type: 'bar',
          barMaxWidth: 14,
          data: comparedRuns.map((r) => safeNum(r.totalReturnPct)),
          itemStyle: { color: '#ff8800' },
        },
        {
          name: '超额%',
          type: 'bar',
          barMaxWidth: 14,
          data: comparedRuns.map((r) => safeNum(r.excessReturnPct)),
          itemStyle: { color: '#ff3535' },
        },
        {
          name: '胜率%',
          type: 'bar',
          barMaxWidth: 14,
          data: comparedRuns.map((r) => safeNum(r.winRatePct)),
          itemStyle: { color: '#4da3ff' },
        },
        {
          name: '-最大回撤%',
          type: 'bar',
          barMaxWidth: 14,
          data: comparedRuns.map((r) => -Math.abs(safeNum(r.maxDrawdownPct))),
          itemStyle: { color: '#00c853' },
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(dom);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [comparedRuns, subTab]);

  // ==================== Paper Desk Handlers ====================
  const handleSwitchMarket = (m: 'ashare' | 'futures') => {
    setOrderMarket(m);
    if (m === 'ashare') {
      setOrderLeverage(1);
      if (orderAction === 'open_short' || orderAction === 'cover_short') {
        setOrderAction('buy_long');
      }
      if (!isAShareSymbol(orderSymbol)) {
        setOrderSymbol('300308');
        setOrderName('中际旭创');
        setOrderQty('500');
      }
    } else {
      setOrderLeverage(2);
      if (isAShareSymbol(orderSymbol)) {
        setOrderSymbol('IC0');
        setOrderName('中证500期指主连');
        setOrderQty('1');
      }
    }
  };

  const handlePlaceOrder = async (customPayload?: Partial<PaperOrderRequest>) => {
    setSubmittingOrder(true);
    setOrderFeedback(null);
    try {
      const mkt = customPayload?.market ?? orderMarket;
      const effType = customPayload?.orderType ?? orderType;
      const limitNum = safeNum(orderLimitPrice, 0);
      const slNum = safeNum(orderStopLossPrice, 0);
      const tpNum = safeNum(orderTakeProfitPrice, 0);
      const slipNum = Math.max(0, Math.min(50, safeNum(orderSlippageBps, 2.5)));

      const payload: PaperOrderRequest = {
        portfolioId: selectedPortfolioId || paperDesk?.activePortfolio?.id,
        symbol: (customPayload?.symbol ?? orderSymbol).trim().toUpperCase(),
        name: customPayload?.name ?? (orderName.trim() || undefined),
        market: mkt,
        action: customPayload?.action ?? orderAction,
        orderType: effType,
        leverage: mkt === 'ashare' ? 1 : customPayload?.leverage ?? orderLeverage,
        slippageBps: customPayload?.slippageBps ?? slipNum,
        strategyTag: customPayload?.strategyTag ?? orderStrategyTag,
        note: customPayload?.note ?? (orderNote.trim() || '桌面终端实盘委托'),
      };
      if (customPayload?.price !== undefined) {
        payload.price = customPayload.price;
      } else if (effType === 'LIMIT' && limitNum > 0) {
        payload.price = limitNum;
      }
      if (customPayload?.stopLossPrice !== undefined) {
        payload.stopLossPrice = customPayload.stopLossPrice;
      } else if (slNum > 0) {
        payload.stopLossPrice = slNum;
      }
      if (customPayload?.takeProfitPrice !== undefined) {
        payload.takeProfitPrice = customPayload.takeProfitPrice;
      } else if (tpNum > 0) {
        payload.takeProfitPrice = tpNum;
      }
      if (customPayload?.capitalAllocationPct !== undefined) {
        payload.capitalAllocationPct = customPayload.capitalAllocationPct;
      } else if (sizingMode === 'pct') {
        payload.capitalAllocationPct = Math.max(1, Math.min(95, safeNum(orderAllocPct, 10)));
      } else {
        payload.quantity = Math.max(1, Math.floor(safeNum(orderQty, mkt === 'ashare' ? 100 : 1)));
      }

      const res = await api.placePaperOrder(payload);
      setPaperDesk(res);
      const latestOrder = res.orders?.[0];
      setOrderFeedback({
        ok: true,
        text: latestOrder
          ? `成交 [${latestOrder.execId || latestOrder.id}]: ${ACTION_LABEL[latestOrder.action]} ${latestOrder.symbol} ${latestOrder.quantity}${latestOrder.market === 'ashare' ? '股' : '手'} @ ${fmtNum(latestOrder.fillPrice)} (${latestOrder.taxAndFeeDetail || `费:${fmtNum(latestOrder.fee)}`})`
          : '委托执行成功并已写入 SQLite WAL',
      });
      loadDiagnostics();
    } catch (e: unknown) {
      setOrderFeedback({
        ok: false,
        text: e instanceof Error ? e.message : '下单执行被拒绝',
      });
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleClosePosition = async (pos: PaperPositionItem, ratio = 1) => {
    setSubmittingOrder(true);
    setOrderFeedback(null);
    try {
      const pid = selectedPortfolioId || paperDesk?.activePortfolio?.id;
      const res = await api.closePaperPosition(pos.id, ratio, pid);
      setPaperDesk(res);
      setOrderFeedback({
        ok: true,
        text: `已市价${ratio < 0.99 ? '半仓平仓(1/2)' : '全额平仓'} ${pos.symbol} ${pos.name}`,
      });
      loadDiagnostics();
    } catch (e: unknown) {
      setOrderFeedback({
        ok: false,
        text: e instanceof Error ? e.message : '平仓失败',
      });
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleSavePositionStops = async (pos: PaperPositionItem) => {
    setSubmittingOrder(true);
    try {
      const pid = selectedPortfolioId || paperDesk?.activePortfolio?.id;
      const slVal = editingStopVal.trim() === '' ? null : safeNum(editingStopVal, 0);
      const tpVal = editingTpVal.trim() === '' ? null : safeNum(editingTpVal, 0);
      const res = await api.updatePositionStops(pos.id, {
        portfolioId: pid,
        stopLossPrice: slVal && slVal > 0 ? slVal : null,
        takeProfitPrice: tpVal && tpVal > 0 ? tpVal : null,
      });
      setPaperDesk(res);
      setEditingStopPosId(null);
      setOrderFeedback({ ok: true, text: `已更新 ${pos.symbol} 证伪止损/止盈触发线` });
    } catch (e: unknown) {
      setOrderFeedback({ ok: false, text: e instanceof Error ? e.message : '保存止损线失败' });
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleSaveOmsPolicy = async (
    patch: Partial<{ autoFollow4of4: boolean; autoStopLossGuard: boolean; autoAllocPct: number; maxDailyAutoOrders: number; defaultSlippageBps: number }>
  ) => {
    setSavingPolicy(true);
    try {
      const updated = await api.saveOmsPolicy(patch);
      setPaperDesk((prev) => (prev ? { ...prev, policy: updated } : prev));
      notify('ok', 'OMS 自动风控与信号执行策略已保存至 SQLite');
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '保存 OMS 执行策略失败');
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleCreatePortfolio = async () => {
    if (!newPortfolioName.trim()) return;
    setLoadingPaper(true);
    try {
      const res = await api.createPaperPortfolio({
        name: newPortfolioName.trim(),
        initialCapital: Math.max(50000, safeNum(newPortfolioCapital, 1000000)),
      });
      setPaperDesk(res);
      if (res.activePortfolio?.id) setSelectedPortfolioId(res.activePortfolio.id);
      setShowNewPortfolioBar(false);
      notify('ok', `已创建隔离实盘专户「${newPortfolioName.trim()}」`);
      loadDiagnostics();
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '新建实盘专户失败');
    } finally {
      setLoadingPaper(false);
    }
  };

  const handleResetPortfolio = async () => {
    const pid = selectedPortfolioId || paperDesk?.activePortfolio?.id;
    if (!pid) return;
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    setConfirmReset(false);
    setLoadingPaper(true);
    try {
      const res = await api.resetPaperPortfolio(pid);
      setPaperDesk(res);
      setOrderFeedback({ ok: true, text: '组合资金与持仓已重置至初始本金' });
      loadDiagnostics();
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '重置组合失败');
    } finally {
      setLoadingPaper(false);
    }
  };

  const handleImportQuickSignal = (sig: QuickSignalItem, executeNow = false) => {
    setOrderMarket(sig.market);
    setOrderAction(sig.action);
    setOrderSymbol(sig.symbol);
    setOrderName(sig.name);
    setOrderLeverage(sig.leverage);
    setOrderStrategyTag(sig.strategyTag);
    setOrderNote(sig.rationale);
    setSizingMode('pct');
    setOrderAllocPct(String(sig.allocationPct));

    if (executeNow) {
      handlePlaceOrder({
        symbol: sig.symbol,
        name: sig.name,
        market: sig.market,
        action: sig.action,
        capitalAllocationPct: sig.allocationPct,
        leverage: sig.leverage,
        strategyTag: sig.strategyTag,
        note: sig.rationale,
      });
    } else {
      setOrderFeedback({
        ok: true,
        text: `已导入信号 [${sig.source}] ${sig.symbol} ${sig.name} (建议仓位 ${sig.allocationPct}%)，可直接点[立即下单执行]`,
      });
    }
  };

  // ==================== Archive Handlers ====================
  const filteredSortedArchives = useMemo(() => {
    const q = archiveSearch.trim().toLowerCase();
    const list = archives.filter((a) => {
      if (!q) return true;
      return (
        a.symbol.toLowerCase().includes(q) ||
        a.symbolName.toLowerCase().includes(q) ||
        a.strategyName.toLowerCase().includes(q) ||
        a.paramsSummary.toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (archiveSortBy === 'createdAt') {
        cmp = String(a.createdAt).localeCompare(String(b.createdAt));
      } else {
        cmp = safeNum(a[archiveSortBy]) - safeNum(b[archiveSortBy]);
      }
      return archiveSortDir === 'desc' ? -cmp : cmp;
    });
  }, [archives, archiveSearch, archiveSortBy, archiveSortDir]);

  const preTradeCalc = useMemo(() => {
    const refPx =
      orderType === 'LIMIT' && safeNum(orderLimitPrice, 0) > 0
        ? safeNum(orderLimitPrice, 0)
        : safeNum(quotePreview?.lastPrice, 0);
    const slipBps =
      orderType === 'LIMIT' ? 0 : Math.max(0, Math.min(50, safeNum(orderSlippageBps, 2.5)));
    const isBuySide = orderAction === 'buy_long' || orderAction === 'open_short';
    const slipMult =
      orderAction === 'buy_long' || orderAction === 'cover_short'
        ? 1 + slipBps / 10000
        : 1 - slipBps / 10000;
    const estFillPx = refPx > 0 ? refPx * slipMult : 0;
    const eq = Math.max(0, safeNum(paperDesk?.activePortfolio?.totalEquity, 0));
    const cash = Math.max(0, safeNum(paperDesk?.activePortfolio?.cashBalance, 0));
    const lev = orderMarket === 'ashare' ? 1 : Math.max(1, orderLeverage);
    const futuresMult =
      orderMarket === 'futures' && quotePreview?.multiplier
        ? quotePreview.multiplier
        : 1;

    let estQty = 0;
    if (sizingMode === 'qty') {
      estQty = Math.max(1, Math.floor(safeNum(orderQty, orderMarket === 'ashare' ? 100 : 1)));
      if (orderMarket === 'ashare') estQty = Math.max(100, Math.floor(estQty / 100) * 100);
    } else if (estFillPx > 0 && eq > 0) {
      const targetCap = (eq * Math.max(1, Math.min(95, safeNum(orderAllocPct, 10)))) / 100;
      if (orderMarket === 'ashare') {
        estQty = Math.max(100, Math.floor(targetCap / estFillPx / 100) * 100);
      } else {
        estQty = Math.max(1, Math.floor((targetCap * lev) / (estFillPx * futuresMult)));
      }
    }

    const notional = estFillPx * estQty * (orderMarket === 'futures' ? futuresMult : 1);
    const marginOrCost = orderMarket === 'futures' ? notional / lev : notional;
    const commission =
      orderMarket === 'ashare'
        ? notional > 0
          ? Math.max(5, notional * 0.00025)
          : 0
        : estQty * 6;
    const stampDuty =
      orderMarket === 'ashare' && orderAction === 'sell_long' ? notional * 0.0005 : 0;
    const transferFee = orderMarket === 'ashare' ? notional * 0.00001 : 0;
    const estTotalFee = commission + stampDuty + transferFee;
    const postTradePct = eq > 0 ? (marginOrCost / eq) * 100 : 0;
    const slPx = safeNum(orderStopLossPrice, 0);
    let maxStopRisk = 0;
    if (slPx > 0 && estFillPx > 0 && estQty > 0 && isBuySide) {
      const diff =
        orderAction === 'buy_long'
          ? Math.max(0, estFillPx - slPx)
          : Math.max(0, slPx - estFillPx);
      maxStopRisk = diff * estQty * (orderMarket === 'futures' ? futuresMult : 1);
    }
    return {
      refPx,
      estFillPx,
      estQty,
      marginOrCost,
      commission,
      stampDuty,
      transferFee,
      estTotalFee,
      postTradePct,
      maxStopRisk,
      overCash: isBuySide && marginOrCost + estTotalFee > cash,
    };
  }, [
    orderType,
    orderLimitPrice,
    quotePreview,
    orderSlippageBps,
    orderAction,
    paperDesk?.activePortfolio,
    orderMarket,
    orderLeverage,
    sizingMode,
    orderQty,
    orderAllocPct,
    orderStopLossPrice,
  ]);

  const toggleArchiveSort = (col: typeof archiveSortBy) => {
    if (archiveSortBy === col) {
      setArchiveSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setArchiveSortBy(col);
      setArchiveSortDir('desc');
    }
  };

  const toggleCompareId = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) {
        notify('err', '同屏对比矩阵最多选择 4 条归档记录');
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleDeleteArchive = async (id: string) => {
    try {
      const next = await api.deleteArchivedBacktest(id);
      setArchives(next);
      setCompareIds((prev) => prev.filter((x) => x !== id));
      notify('ok', '已从 SQLite 归档库删除记录');
      loadDiagnostics();
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '删除归档失败');
    }
  };

  // ==================== Webhook & Alert Rule Handlers ====================
  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whName.trim() || !whUrl.trim()) {
      notify('err', '请填写通道名称和 Webhook URL');
      return;
    }
    setSavingWebhook(true);
    try {
      const list = await api.saveWebhookChannel({
        id: editingWebhookId,
        name: whName.trim(),
        provider: whProvider,
        webhookUrl: whUrl.trim(),
        secret: whSecret.trim() || undefined,
        enabled: whEnabled,
        eventsFilter: whEvents.length > 0 ? whEvents : ['anomaly', 'cpo_gate'],
      });
      setWebhooks(list);
      setEditingWebhookId(undefined);
      setWhUrl('');
      setWhSecret('');
      notify('ok', 'Webhook 通道已保存至 SQLite');
      loadDiagnostics();
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '保存 Webhook 失败');
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleToggleWebhook = async (ch: WebhookChannelItem) => {
    try {
      const list = await api.saveWebhookChannel({ ...ch, enabled: !ch.enabled });
      setWebhooks(list);
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '切换通道状态失败');
    }
  };

  const handleTestWebhook = async (id: string) => {
    setWebhookTestResult(null);
    try {
      const res = await api.testWebhookChannel(id);
      setWebhooks(res.channels || []);
      setWebhookTestResult({ id, ok: res.ok, statusText: res.statusText });
    } catch (e: unknown) {
      setWebhookTestResult({
        id,
        ok: false,
        statusText: e instanceof Error ? e.message : '测试请求异常',
      });
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    try {
      const list = await api.deleteWebhookChannel(id);
      setWebhooks(list);
      loadDiagnostics();
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '删除通道失败');
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRule(true);
    try {
      const res = await api.saveMonitorRule({
        name: newRuleName.trim() || `${newRuleCode || '*'} ${newRuleMetric} >= ${newRuleThreshold}`,
        code: newRuleCode.trim() || '*',
        metric: newRuleMetric,
        threshold: safeNum(newRuleThreshold, 4),
        enabled: true,
      });
      setAlertRules(res.rules || []);
      setAlertEvents(res.events || []);
      setNewRuleName('');
      notify('ok', '已新增 SQLite 预警规则');
      loadDiagnostics();
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '保存预警规则失败');
    } finally {
      setSavingRule(false);
    }
  };

  const handleToggleRule = async (rule: MonitorRule) => {
    try {
      const res = await api.saveMonitorRule({ ...rule, enabled: !rule.enabled });
      setAlertRules(res.rules || []);
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '更新规则失败');
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      const res = await api.deleteMonitorRule(id);
      setAlertRules(res.rules || []);
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '删除规则失败');
    }
  };

  // ==================== Multi-Tenant & OpenAPI Key Handlers ====================
  const handleSwitchSeat = async (userId: string) => {
    setAuthBusy(true);
    try {
      const res = await api.switchDemoSeat(userId);
      setSaasSession(res.token, res.user.id);
      await refreshAllForTenant();
      onTenantChanged?.();
      notify('ok', `已切换至隔离席位: ${res.user.displayName} (${res.user.username})`);
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '切换席位失败');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUsername.trim() || !authPassword.trim()) {
      notify('err', '请输入用户名与密码');
      return;
    }
    setAuthBusy(true);
    try {
      const res =
        authMode === 'register'
          ? await api.registerSaas({
              username: authUsername.trim(),
              displayName: authDisplayName.trim() || authUsername.trim(),
              password: authPassword,
              planTier: authPlanTier,
            })
          : await api.loginSaas({
              username: authUsername.trim(),
              password: authPassword,
            });
      setSaasSession(res.token, res.user.id);
      setAuthPassword('');
      await refreshAllForTenant();
      onTenantChanged?.();
      notify(
        'ok',
        authMode === 'register'
          ? `已注册并登录新隔离租户「${res.user.displayName}」，已自动初始化专属自选股与OMS实盘专户`
          : `登录成功: ${res.user.displayName}`
      );
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '租户认证失败');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCreateApiKey = async () => {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const item = await api.createSaasApiKey(newKeyName.trim());
      setRevealedKeyOnce(item);
      await loadDiagnostics();
      notify('ok', `已签发 OpenAPI 密钥 ${item.keyPrefix}... (仅明文展示一次)`);
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '签发密钥失败');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeApiKey = async (id: string) => {
    try {
      await api.revokeSaasApiKey(id);
      if (revealedKeyOnce?.id === id) setRevealedKeyOnce(null);
      await loadDiagnostics();
      notify('ok', '已吊销 OpenAPI 密钥');
    } catch (e: unknown) {
      notify('err', e instanceof Error ? e.message : '吊销密钥失败');
    }
  };

  const activePortfolio = paperDesk?.activePortfolio;
  const currentUser = diagnostics?.currentUser;
  const totalSqliteRows = useMemo(
    () => (diagnostics?.tables || []).reduce((acc, t) => acc + safeNum(t.rowCount), 0),
    [diagnostics?.tables]
  );

  const sampleApiKeyForCurl = revealedKeyOnce?.rawKeyOnce || `${diagnostics?.apiKeys?.[0]?.keyPrefix || 'tsp_live_xxxx'}...`;
  const curlSnippet = `curl -H "X-TSP-API-Key: ${sampleApiKeyForCurl}" http://127.0.0.1:3130/api/paper/overview`;

  return (
    <div className="h-full flex flex-col bg-[#090c10] text-[#dfe6f0] select-none overflow-hidden">
      {/* ==================== Top 28px Wind Ribbon ==================== */}
      <div className="h-[28px] bg-[#161b24] border-b border-[#222832] flex items-center justify-between px-2 shrink-0 overflow-x-auto">
        <div className="flex items-center h-full shrink-0">
          <div className="flex items-center gap-1.5 pr-3 border-r border-[#222832] h-full">
            <span className="w-[3px] h-3.5 bg-[#ff8800]" />
            <span className="text-[11px] font-bold text-[#ff8800] tracking-tight">ENTERPRISE SAAS DESK</span>
            <span className="text-[10px] text-[#7d8796] tabular-nums">{diagnostics?.version || 'v1.0.0-enterprise'}</span>
          </div>

          <button
            type="button"
            onClick={() => setSubTab('paper-desk')}
            className={`w-tab ${subTab === 'paper-desk' ? 'w-tab-active' : ''}`}
          >
            [01] OMS 实盘交易柜台与风控执行舱
          </button>
          <button
            type="button"
            onClick={() => setSubTab('archive-repo')}
            className={`w-tab ${subTab === 'archive-repo' ? 'w-tab-active' : ''}`}
          >
            [02] SQLite 回测归档与研报
          </button>
          <button
            type="button"
            onClick={() => setSubTab('webhook-gateway')}
            className={`w-tab ${subTab === 'webhook-gateway' ? 'w-tab-active' : ''}`}
          >
            [03] 实盘预警与Webhook网关
          </button>
          <button
            type="button"
            onClick={() => setSubTab('tenant-ops')}
            className={`w-tab ${subTab === 'tenant-ops' ? 'w-tab-active' : ''}`}
          >
            [04] 多租户·OpenAPI·SQLite/流监控
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0 pl-2">
          {currentUser && (
            <button
              type="button"
              onClick={() => setSubTab('tenant-ops')}
              className="px-1.5 py-0.5 text-[10px] bg-[#0e1117] border border-[#2b3444] text-[#e5b567] hover:border-[#ff8800] tabular-nums"
              title="点击管理多租户席位"
            >
              席位: {currentUser.displayName} [{currentUser.planTier.toUpperCase()}]
            </button>
          )}
          <span
            className={`px-1.5 py-0.5 text-[10px] border tabular-nums ${
              streamConnected
                ? 'bg-[#0b1f16] border-[#1f5c3a] text-[#00c853]'
                : 'bg-[#1a1510] border-[#4d3518] text-[#f0b90b]'
            }`}
          >
            {streamConnected ? 'SSE LIVE' : 'SSE INIT'}
            {lastPulse ? ` · ${lastPulse.connectedClients}客户端` : ''}
          </span>
          <button
            type="button"
            onClick={() => {
              loadDiagnostics();
              if (subTab === 'paper-desk') loadPaperDesk();
              if (subTab === 'archive-repo') loadArchives(engineFilter);
              if (subTab === 'webhook-gateway') loadWebhooksAndAlerts();
            }}
            className="h-[20px] px-2 bg-[#0e1117] border border-[#2b3444] hover:border-[#ff8800] text-[10px] text-[#cfd8e3] flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            刷新
          </button>
        </div>
      </div>

      {/* Global Notice / Live SSE Alert Strip */}
      {(globalNotice || liveAlertBanner) && (
        <div className="bg-[#11151d] border-b border-[#222832] px-2.5 py-1 flex items-center justify-between gap-2 text-[11px] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {globalNotice && (
              <span className={globalNotice.type === 'ok' ? 'text-[#00c853]' : 'text-[#ff3535]'}>
                [{globalNotice.type === 'ok' ? 'OK' : 'ERR'}] {globalNotice.text}
              </span>
            )}
            {liveAlertBanner && (
              <span className="text-[#f0b90b] truncate tabular-nums">
                [实时预警推送] {liveAlertBanner.time} {liveAlertBanner.code} {liveAlertBanner.name} — {liveAlertBanner.ruleName}: {liveAlertBanner.message}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setGlobalNotice(null);
              setLiveAlertBanner(null);
            }}
            className="text-[10px] text-[#7d8796] hover:text-[#dfe6f0] shrink-0"
          >
            [关闭]
          </button>
        </div>
      )}

      {/* ==================== TAB [01]: PAPER TRADING DESK ==================== */}
      {subTab === 'paper-desk' && (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
          {/* Top Portfolio Control Bar */}
          <div className="bg-[#0e1117] px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-[#8b95a5]">当前组合:</span>
              <select
                value={selectedPortfolioId || activePortfolio?.id || ''}
                onChange={(e) => {
                  setSelectedPortfolioId(e.target.value);
                  loadPaperDesk(e.target.value);
                }}
                className="h-[24px] px-2 bg-[#161b24] border border-[#2b3444] text-[11px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
              >
                {(paperDesk?.portfolios || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (净值 {fmtCurrency(p.totalEquity)})
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setShowNewPortfolioBar((v) => !v)}
                className="h-[24px] px-2 bg-[#161b24] border border-[#2b3444] hover:border-[#ff8800] text-[11px] text-[#ff8800] flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                新建实盘专户
              </button>

              <button
                type="button"
                onClick={handleResetPortfolio}
                className={`h-[24px] px-2 border text-[11px] flex items-center gap-1 ${
                  confirmReset
                    ? 'bg-[#2a1215] border-[#ff3535] text-[#ff3535]'
                    : 'bg-[#161b24] border-[#2b3444] hover:border-[#ff3535] text-[#cfd8e3]'
                }`}
              >
                <RotateCcw className="w-3 h-3" />
                {confirmReset ? '确认重置组合?' : '重置组合'}
              </button>

              <button
                type="button"
                onClick={() =>
                  downloadWithAuth(
                    api.getPaperOrdersCsvUrl(selectedPortfolioId || activePortfolio?.id),
                    `oms_orders_${activePortfolio?.id || 'desk'}.csv`
                  ).catch((err) => notify('err', err.message))
                }
                className="h-[24px] px-2 bg-[#161b24] border border-[#2b3444] hover:border-[#4da3ff] text-[11px] text-[#4da3ff] flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                导出交割单CSV
              </button>

              <button
                type="button"
                onClick={() => loadPaperDesk()}
                disabled={loadingPaper}
                className="h-[24px] px-2 bg-[#161b24] border border-[#2b3444] hover:border-[#ff8800] text-[11px] text-[#cfd8e3] flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${loadingPaper ? 'animate-spin' : ''}`} />
                实时盯市
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] bg-[#161b24] border border-[#222832] text-[#e5b567] tabular-nums">
                交易日: {paperDesk?.tradingDate || '--'}
              </span>
              <span className="px-2 py-0.5 text-[10px] bg-[#11151d] border border-[#2b3444] text-[#9aa5b5]">
                SQLite WAL 事务级记账 · A股T+1整手锁仓 · 期货T+0双向保证金
              </span>
            </div>
          </div>

          {/* Inline Create Portfolio Bar */}
          {showNewPortfolioBar && (
            <div className="bg-[#11151d] px-2.5 py-1.5 flex flex-wrap items-center gap-2 border-b border-[#222832] shrink-0">
              <span className="text-[11px] text-[#ff8800] font-semibold">新建隔离组合:</span>
              <input
                type="text"
                value={newPortfolioName}
                onChange={(e) => setNewPortfolioName(e.target.value)}
                placeholder="组合名称"
                className="h-[24px] w-48 px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
              />
              <span className="text-[11px] text-[#8b95a5]">初始资金(元):</span>
              <input
                type="number"
                value={newPortfolioCapital}
                onChange={(e) => setNewPortfolioCapital(e.target.value)}
                className="h-[24px] w-32 px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#f0b90b] tabular-nums focus:outline-none focus:border-[#ff8800]"
              />
              <button
                type="button"
                onClick={handleCreatePortfolio}
                className="h-[24px] px-3 bg-[#ff8800] text-[#090c10] text-[11px] font-bold hover:bg-[#ff9922]"
              >
                创建并切换
              </button>
              <button
                type="button"
                onClick={() => setShowNewPortfolioBar(false)}
                className="h-[24px] px-2 bg-[#161b24] border border-[#2b3444] text-[11px] text-[#8b95a5]"
              >
                取消
              </button>
            </div>
          )}

          {/* OMS Auto-Execution & Stop-Loss Guard Policy Bar */}
          <div className="bg-[#11151d] px-2.5 py-1 flex flex-wrap items-center justify-between gap-2 border-b border-[#222832] text-[11px] shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[#ff8800] font-bold">OMS 风控守护策略:</span>
              <button
                type="button"
                disabled={savingPolicy}
                onClick={() =>
                  handleSaveOmsPolicy({
                    autoFollow4of4: !(paperDesk?.policy?.autoFollow4of4 ?? false),
                  })
                }
                className={`px-2 h-[20px] border text-[10px] font-semibold ${
                  paperDesk?.policy?.autoFollow4of4
                    ? 'bg-[#211508] border-[#ff8800] text-[#ff8800]'
                    : 'bg-[#161b24] border-[#2b3444] text-[#8b95a5] hover:text-[#dfe6f0]'
                }`}
              >
                4/4买点自动跟单: {paperDesk?.policy?.autoFollow4of4 ? '已开启' : '关闭'}
              </button>
              <div className="flex items-center gap-1 text-[10px] text-[#8b95a5]">
                <span>单笔配比:</span>
                {[5, 10, 15, 20].map((pct) => {
                  const active = Math.round(paperDesk?.policy?.autoAllocPct ?? 10) === pct;
                  return (
                    <button
                      key={pct}
                      type="button"
                      disabled={savingPolicy}
                      onClick={() => handleSaveOmsPolicy({ autoAllocPct: pct })}
                      className={`px-1.5 h-[20px] border tabular-nums ${
                        active
                          ? 'bg-[#ff8800] border-[#ff8800] text-[#090c10] font-bold'
                          : 'bg-[#161b24] border-[#252c38] text-[#9aa5b5] hover:border-[#ff8800]'
                      }`}
                    >
                      {pct}%
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={savingPolicy}
                onClick={() =>
                  handleSaveOmsPolicy({
                    autoStopLossGuard: !(paperDesk?.policy?.autoStopLossGuard ?? true),
                  })
                }
                className={`px-2 h-[20px] border text-[10px] font-semibold ${
                  (paperDesk?.policy?.autoStopLossGuard ?? true)
                    ? 'bg-[#0b1f16] border-[#00c853] text-[#00c853]'
                    : 'bg-[#211013] border-[#ff3535] text-[#ff3535]'
                }`}
              >
                证伪止损熔断: {(paperDesk?.policy?.autoStopLossGuard ?? true) ? 'GUARD ON' : 'OFF'}
              </button>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[#7d8796] tabular-nums">
              <span>日限跟单: {paperDesk?.policy?.maxDailyAutoOrders ?? 3} 笔</span>
              <span>·</span>
              <span>默认滑点: {fmtNum(paperDesk?.policy?.defaultSlippageBps ?? 1.5, 1)} bps</span>
            </div>
          </div>

          {/* 8-Cell Wind MTM KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-[1px] bg-[#222832] shrink-0">
            <KpiCell
              label="组合总净资产 (CNY)"
              value={fmtCurrency(activePortfolio?.totalEquity)}
              sub={`初始本金 ${formatAmount(activePortfolio?.initialCapital)}`}
              tone="gold"
            />
            <KpiCell
              label="可用现金余额"
              value={fmtCurrency(activePortfolio?.cashBalance)}
              sub={`现金占比 ${activePortfolio?.totalEquity ? ((safeNum(activePortfolio.cashBalance) / safeNum(activePortfolio.totalEquity)) * 100).toFixed(1) : '0.0'}%`}
              tone="blue"
            />
            <KpiCell
              label="持仓市值 / 占用保证金"
              value={fmtCurrency(activePortfolio?.marketValue)}
              sub={`占用保证金 ${fmtCurrency(activePortfolio?.marginUsed)}`}
              tone="neutral"
            />
            <KpiCell
              label="当日浮动盈亏"
              value={fmtSignedCurrency(activePortfolio?.todayPnl ?? activePortfolio?.unrealizedPnl)}
              sub={`持仓浮盈 ${fmtSignedCurrency(activePortfolio?.unrealizedPnl)}`}
              tone={safeNum(activePortfolio?.todayPnl ?? activePortfolio?.unrealizedPnl) >= 0 ? 'up' : 'down'}
            />
            <KpiCell
              label="累计总收益率%"
              value={fmtPct(activePortfolio?.totalReturnPct)}
              sub={`净值 ${(1 + safeNum(activePortfolio?.totalReturnPct) / 100).toFixed(4)}`}
              tone={safeNum(activePortfolio?.totalReturnPct) >= 0 ? 'up' : 'down'}
            />
            <KpiCell
              label="累计已实现盈亏"
              value={fmtSignedCurrency(activePortfolio?.realizedPnl)}
              sub="含手续费与印花税扣减"
              tone={safeNum(activePortfolio?.realizedPnl) >= 0 ? 'up' : 'down'}
            />
            <KpiCell
              label="仓位/保证金使用率%"
              value={`${fmtNum(activePortfolio?.positionUsagePct, 1)}%`}
              sub={safeNum(activePortfolio?.positionUsagePct) > 85 ? '高仓位警戒' : '风险敞口可控'}
              tone="orange"
            />
            <KpiCell
              label="持仓标的数量"
              value={`${activePortfolio?.positionCount ?? (paperDesk?.positions?.length || 0)} 支`}
              sub={`成交笔数 ${paperDesk?.orders?.length || 0} 笔`}
              tone="neutral"
            />
          </div>

          {/* Main Split: Left/Center Positions + NAV & Blotter | Right Order Ticket & Signal Launcher */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-[1px] bg-[#222832] overflow-hidden">
            {/* Left/Center Area */}
            <div className="flex-1 min-w-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
              {/* Real-time MTM Positions Table */}
              <div className="bg-[#0e1117] flex flex-col min-h-[190px] flex-[1.1] overflow-hidden">
                <PaneHeader
                  title="实时盯市持仓表 (A股 T+1 锁仓校验 · 期货 T+0 双向保证金)"
                  badge={`${paperDesk?.positions?.length || 0} 笔持仓`}
                  right={<span>点击A股代码查看K线与分时</span>}
                />
                <div className="flex-1 overflow-auto">
                  <table className="w-table">
                    <thead>
                      <tr>
                        <th className="text-left">代码</th>
                        <th className="text-left">名称</th>
                        <th className="text-left">市场/方向</th>
                        <th className="text-right">总持仓 / 可平量</th>
                        <th className="text-right">持仓均价</th>
                        <th className="text-right">实时最新价</th>
                        <th className="text-right">浮动盈亏</th>
                        <th className="text-right">盈亏比例%</th>
                        <th className="text-right">证伪止损 / 缓冲%</th>
                        <th className="text-left">策略来源标签</th>
                        <th className="text-center">平仓操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(paperDesk?.positions || []).length === 0 ? (
                        <tr>
                          <td colSpan={11} className="text-center py-6 text-[#6d7787]">
                            当前专户暂无持仓 — 可在右侧委托单直接下单或一键导入策略信号建仓
                          </td>
                        </tr>
                      ) : (
                        (paperDesk?.positions || []).map((pos) => {
                          const isLockedT1 = pos.market === 'ashare' && pos.availableQuantity <= 0;
                          const canHalfClose =
                            !isLockedT1 && pos.quantity >= (pos.market === 'ashare' ? 200 : 2);
                          const isEditingStops = editingStopPosId === pos.id;
                          return (
                            <tr key={pos.id}>
                              <td>
                                {isAShareSymbol(pos.symbol) ? (
                                  <button
                                    type="button"
                                    onClick={() => onSelectStock(pos.symbol, pos.name)}
                                    className="text-[#e5b567] hover:underline font-semibold"
                                  >
                                    {pos.symbol}
                                  </button>
                                ) : (
                                  <span className="text-[#e5b567] font-semibold">{pos.symbol}</span>
                                )}
                              </td>
                              <td className="text-[#dfe6f0]">{pos.name}</td>
                              <td>
                                <span
                                  className={`px-1 py-0.5 text-[10px] border ${
                                    pos.side === 'long'
                                      ? 'bg-[#211013] border-[#5c1f24] text-[#ff3535]'
                                      : 'bg-[#0b1f16] border-[#1f5c3a] text-[#00c853]'
                                  }`}
                                >
                                  {pos.market === 'ashare' ? 'A股 T+1' : '期货 T+0'} · {pos.side === 'long' ? '多' : '空'}
                                  {pos.leverage > 1 ? ` ${pos.leverage}x` : ''}
                                </span>
                              </td>
                              <td className="text-right tabular-nums">
                                <span className="text-[#dfe6f0] font-semibold">{pos.quantity}</span>
                                <span className="text-[#6d7787] mx-1">/</span>
                                <span className={isLockedT1 ? 'text-[#f0b90b]' : 'text-[#00c853]'}>
                                  {pos.availableQuantity}
                                </span>
                                {isLockedT1 ? (
                                  <span className="ml-1.5 px-1 py-0.5 text-[9px] bg-[#211a0e] border border-[#5e4519] text-[#f0b90b]">
                                    T+1锁仓
                                  </span>
                                ) : pos.market === 'futures' ? (
                                  <span className="ml-1.5 px-1 py-0.5 text-[9px] bg-[#0e1b29] border border-[#22476b] text-[#4da3ff]">
                                    T+0可平
                                  </span>
                                ) : null}
                              </td>
                              <td className="text-right tabular-nums text-[#cfd8e3]">{fmtNum(pos.avgCost, 3)}</td>
                              <td className={`text-right tabular-nums font-semibold ${colorUpDown(pos.unrealizedPnl)}`}>
                                {fmtNum(pos.lastPrice, 3)}
                              </td>
                              <td className={`text-right tabular-nums font-semibold ${colorUpDown(pos.unrealizedPnl)}`}>
                                {fmtSignedCurrency(pos.unrealizedPnl)}
                              </td>
                              <td className={`text-right tabular-nums font-semibold ${colorUpDown(pos.unrealizedPnlPct)}`}>
                                {fmtPct(pos.unrealizedPnlPct)}
                              </td>
                              <td className="text-right tabular-nums">
                                {isEditingStops ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <input
                                      type="number"
                                      step="0.01"
                                      placeholder="止损"
                                      value={editingStopVal}
                                      onChange={(e) => setEditingStopVal(e.target.value)}
                                      className="w-16 h-[20px] px-1 bg-[#090c10] border border-[#ff8800] text-[10px] text-[#f0b90b]"
                                    />
                                    <input
                                      type="number"
                                      step="0.01"
                                      placeholder="止盈"
                                      value={editingTpVal}
                                      onChange={(e) => setEditingTpVal(e.target.value)}
                                      className="w-16 h-[20px] px-1 bg-[#090c10] border border-[#2b3444] text-[10px] text-[#00c853]"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleSavePositionStops(pos)}
                                      className="px-1.5 h-[20px] bg-[#ff8800] text-[#090c10] text-[10px] font-bold"
                                    >
                                      存
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingStopPosId(null)}
                                      className="px-1 h-[20px] bg-[#161b24] border border-[#2b3444] text-[#8b95a5] text-[10px]"
                                    >
                                      x
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-end gap-1">
                                    {pos.stopLossPrice ? (
                                      <span
                                        className={
                                          (pos.distanceToStopPct ?? 99) < 2
                                            ? 'text-[#ff3535] font-semibold'
                                            : 'text-[#f0b90b]'
                                        }
                                        title={
                                          pos.takeProfitPrice
                                            ? `目标止盈: ${fmtNum(pos.takeProfitPrice, 2)}`
                                            : '证伪止损触发价'
                                        }
                                      >
                                        {fmtNum(pos.stopLossPrice, 2)}
                                        {pos.distanceToStopPct !== null &&
                                          pos.distanceToStopPct !== undefined && (
                                            <span className="ml-1 text-[10px] text-[#8b95a5]">
                                              ({pos.distanceToStopPct.toFixed(1)}%)
                                            </span>
                                          )}
                                      </span>
                                    ) : (
                                      <span className="text-[#5d6777] text-[10px]">未设</span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingStopPosId(pos.id);
                                        setEditingStopVal(pos.stopLossPrice ? String(pos.stopLossPrice) : '');
                                        setEditingTpVal(pos.takeProfitPrice ? String(pos.takeProfitPrice) : '');
                                      }}
                                      className="px-1 py-0.5 text-[9px] bg-[#161b24] border border-[#2b3444] hover:border-[#ff8800] text-[#8b95a5] hover:text-[#ff8800]"
                                    >
                                      设止损
                                    </button>
                                  </div>
                                )}
                              </td>
                              <td>
                                <span className="px-1.5 py-0.5 text-[10px] bg-[#161b24] border border-[#252c38] text-[#4da3ff]">
                                  {pos.strategyTag || '手工交易'}
                                </span>
                              </td>
                              <td className="text-center whitespace-nowrap">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleClosePosition(pos, 0.5)}
                                    disabled={submittingOrder || !canHalfClose}
                                    title={canHalfClose ? '按实时市价平掉 1/2 仓位' : '当前持仓不足半仓或T+1锁仓'}
                                    className="px-1.5 py-0.5 text-[10px] border bg-[#161b24] border-[#2b3444] text-[#e5b567] hover:border-[#ff8800] disabled:opacity-40"
                                  >
                                    平1/2
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleClosePosition(pos, 1)}
                                    disabled={submittingOrder}
                                    title={isLockedT1 ? '今日买入A股T+1锁仓(点击可验证服务端风控拦截)' : '按实时市价全额平仓'}
                                    className={`px-1.5 py-0.5 text-[10px] border ${
                                      isLockedT1
                                        ? 'bg-[#1a1510] border-[#4d3518] text-[#f0b90b] hover:border-[#ff3535]'
                                        : 'bg-[#161b24] border-[#2b3444] text-[#dfe6f0] hover:border-[#ff8800] hover:text-[#ff8800]'
                                    }`}
                                  >
                                    全平
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bottom: NAV Curve + Orders Audit */}
              <div className="flex-1 min-h-[200px] grid grid-cols-1 xl:grid-cols-12 gap-[1px] bg-[#222832] overflow-hidden">
                {/* NAV Chart */}
                <div className="xl:col-span-5 bg-[#0e1117] flex flex-col overflow-hidden">
                  <PaneHeader
                    title="组合实时净值曲线"
                    badge={`${paperDesk?.navHistory?.length || 0} 点`}
                  />
                  <div ref={navChartRef} className="flex-1 min-h-[160px] bg-[#0d1015]" />
                </div>

                {/* Order & Fill Audit Blotter */}
                <div className="xl:col-span-7 bg-[#0e1117] flex flex-col overflow-hidden">
                  <PaneHeader
                    title="委托与成交流水审计表"
                    badge={`${paperDesk?.orders?.length || 0} 笔`}
                  />
                  <div className="flex-1 overflow-auto">
                    <table className="w-table">
                      <thead>
                        <tr>
                          <th className="text-left">成交时间</th>
                          <th className="text-left">合同 / 类型</th>
                          <th className="text-left">代码 / 名称</th>
                          <th className="text-left">买卖方向</th>
                          <th className="text-right">成交价 / 滑点</th>
                          <th className="text-right">数量</th>
                          <th className="text-right">税费明细</th>
                          <th className="text-right">实现盈亏</th>
                          <th className="text-left">信号备注</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(paperDesk?.orders || []).length === 0 ? (
                          <tr>
                            <td colSpan={9} className="text-center py-6 text-[#6d7787]">
                              暂无成交流水
                            </td>
                          </tr>
                        ) : (
                          (paperDesk?.orders || []).map((ord) => (
                            <tr key={ord.id}>
                              <td className="text-[#8b95a5] tabular-nums text-[11px]">{shortTime(ord.createdAt)}</td>
                              <td className="tabular-nums text-[10px]">
                                <div className="text-[#cfd8e3] font-semibold">{ord.execId || `ORD-${ord.id}`}</div>
                                <span
                                  className={`px-1 border text-[9px] ${
                                    ord.orderType === 'AUTO_GUARD'
                                      ? 'bg-[#211013] border-[#ff3535] text-[#ff3535]'
                                      : ord.orderType === 'AUTO_SIGNAL'
                                      ? 'bg-[#211508] border-[#ff8800] text-[#ff8800]'
                                      : ord.orderType === 'LIMIT'
                                      ? 'bg-[#0e1b29] border-[#4da3ff] text-[#4da3ff]'
                                      : 'bg-[#161b24] border-[#2b3444] text-[#8b95a5]'
                                  }`}
                                >
                                  {ord.orderType || 'MARKET_IOC'}
                                </span>
                              </td>
                              <td>
                                <span className="text-[#e5b567] font-semibold mr-1">{ord.symbol}</span>
                                <span className="text-[#cfd8e3]">{ord.name}</span>
                              </td>
                              <td>
                                <span
                                  className={`px-1 py-0.5 text-[10px] border ${
                                    ord.action === 'buy_long' || ord.action === 'cover_short'
                                      ? 'bg-[#211013] border-[#5c1f24] text-[#ff3535]'
                                      : 'bg-[#0b1f16] border-[#1f5c3a] text-[#00c853]'
                                  }`}
                                >
                                  {ACTION_LABEL[ord.action] || ord.action}
                                </span>
                              </td>
                              <td className="text-right tabular-nums">
                                <div>{fmtNum(ord.fillPrice, 3)}</div>
                                <div className="text-[9px] text-[#7d8796]">
                                  {fmtNum(ord.slippageBps ?? 0, 1)}bps
                                </div>
                              </td>
                              <td className="text-right tabular-nums">{ord.quantity}</td>
                              <td
                                className="text-right tabular-nums text-[#f0b90b]"
                                title={ord.taxAndFeeDetail || `合计费税 ${fmtNum(ord.fee, 2)}`}
                              >
                                <div>{fmtNum(ord.fee, 2)}</div>
                                {ord.taxAndFeeDetail && (
                                  <div className="text-[9px] text-[#7d8796] max-w-[115px] truncate ml-auto">
                                    {ord.taxAndFeeDetail}
                                  </div>
                                )}
                              </td>
                              <td className={`text-right tabular-nums font-semibold ${colorUpDown(ord.realizedPnl)}`}>
                                {ord.realizedPnl === 0 ? '--' : fmtSignedCurrency(ord.realizedPnl)}
                              </td>
                              <td className="text-[#8b95a5] text-[11px] max-w-[180px] truncate" title={`${ord.strategyTag} · ${ord.note}`}>
                                <span className="text-[#4da3ff] mr-1">[{ord.strategyTag}]</span>
                                {ord.note}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Docked Order Ticket + Live 5-Gear Book + Quick Signal Launcher */}
            <div className="w-full lg:w-[328px] shrink-0 bg-[#0e1117] flex flex-col overflow-hidden">
              <PaneHeader
                title="OMS 实盘委托报单台"
                badge={`${orderMarket === 'ashare' ? 'A股T+1' : '期货T+0'} · ${orderType === 'LIMIT' ? '限价' : '五档IOC'}`}
              />

              <div className="p-2.5 space-y-2 border-b border-[#222832] overflow-y-auto shrink-0">
                {/* Market Toggle */}
                <div className="grid grid-cols-2 gap-[1px] bg-[#222832] border border-[#222832]">
                  <button
                    type="button"
                    onClick={() => handleSwitchMarket('ashare')}
                    className={`h-[26px] text-[11px] font-semibold ${
                      orderMarket === 'ashare' ? 'bg-[#ff8800] text-[#090c10]' : 'bg-[#161b24] text-[#8b95a5]'
                    }`}
                  >
                    A股 T+1 (100股整手)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchMarket('futures')}
                    className={`h-[26px] text-[11px] font-semibold ${
                      orderMarket === 'futures' ? 'bg-[#ff8800] text-[#090c10]' : 'bg-[#161b24] text-[#8b95a5]'
                    }`}
                  >
                    国内期货 T+0 (双向)
                  </button>
                </div>

                {/* Side Buttons */}
                <div className="grid grid-cols-2 gap-1">
                  {(['buy_long', 'sell_long', 'open_short', 'cover_short'] as PaperOrderRequest['action'][]).map(
                    (act) => {
                      const disabled = orderMarket === 'ashare' && (act === 'open_short' || act === 'cover_short');
                      const isBuy = act === 'buy_long' || act === 'cover_short';
                      const active = orderAction === act;
                      return (
                        <button
                          key={act}
                          type="button"
                          disabled={disabled}
                          onClick={() => setOrderAction(act)}
                          className={`h-[25px] text-[11px] border font-semibold ${
                            disabled
                              ? 'bg-[#090c10] border-[#181d26] text-[#454d59] cursor-not-allowed'
                              : active
                              ? isBuy
                                ? 'bg-[#331116] border-[#ff3535] text-[#ff3535]'
                                : 'bg-[#0b2619] border-[#00c853] text-[#00c853]'
                              : 'bg-[#161b24] border-[#252c38] text-[#9aa5b5] hover:text-[#dfe6f0]'
                          }`}
                        >
                          {ACTION_LABEL[act]}
                        </button>
                      );
                    }
                  )}
                </div>

                {/* Symbol + Quick Presets */}
                <div>
                  <div className="flex items-center justify-between text-[10px] text-[#8b95a5] mb-1">
                    <span>交易标的 (代码 / 名称)</span>
                    <button
                      type="button"
                      onClick={() => void loadQuotePreview(orderSymbol, orderMarket)}
                      className="text-[#e5b567] hover:text-[#ff8800] flex items-center gap-1"
                    >
                      <RefreshCw className={`w-2.5 h-2.5 ${loadingQuotePreview ? 'animate-spin' : ''}`} />
                      {orderType === 'LIMIT' ? '限价委托' : '五档IOC撮合'}
                    </button>
                  </div>
                  <div className="grid grid-cols-12 gap-1">
                    <input
                      type="text"
                      value={orderSymbol}
                      onChange={(e) => setOrderSymbol(e.target.value)}
                      placeholder="代码如 300308 / IC0"
                      className="col-span-5 h-[26px] px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#e5b567] font-semibold focus:outline-none focus:border-[#ff8800]"
                    />
                    <input
                      type="text"
                      value={orderName}
                      onChange={(e) => setOrderName(e.target.value)}
                      placeholder="名称(可选)"
                      className="col-span-7 h-[26px] px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(orderMarket === 'ashare'
                      ? [
                          { s: '300308', n: '中际旭创' },
                          { s: '002837', n: '英维克' },
                          { s: '159915', n: '创业板ETF' },
                          { s: '601899', n: '紫金矿业' },
                        ]
                      : [
                          { s: 'IC0', n: '中证500期指' },
                          { s: 'IM0', n: '中证1000期指' },
                          { s: 'AU0', n: '沪金主连' },
                          { s: 'EC0', n: '欧线集运' },
                        ]
                    ).map((item) => (
                      <button
                        key={item.s}
                        type="button"
                        onClick={() => {
                          setOrderSymbol(item.s);
                          setOrderName(item.n);
                        }}
                        className="px-1.5 py-0.5 text-[10px] bg-[#11151d] border border-[#222832] hover:border-[#ff8800] text-[#e5b567]"
                      >
                        {item.s} {item.n}
                      </button>
                    ))}
                  </div>

                  {/* Live 5-Gear Order Book */}
                  {quotePreview && quotePreview.lastPrice > 0 && (
                    <div className="mt-1.5 bg-[#0a0d12] border border-[#222832] p-1.5 text-[10px] tabular-nums">
                      <div className="flex items-center justify-between pb-1 border-b border-[#1c222d] mb-1">
                        <span className="text-[#8b95a5]">
                          现价{' '}
                          <span className="text-[#f0b90b] font-bold">
                            {fmtNum(quotePreview.lastPrice, quotePreview.tickSize < 0.05 ? 3 : 2)}
                          </span>
                        </span>
                        <div className="flex items-center gap-2 text-[9px]">
                          {quotePreview.upperLimit > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setOrderType('LIMIT');
                                setOrderLimitPrice(String(quotePreview.upperLimit));
                              }}
                              className="text-[#ff3535] hover:underline"
                            >
                              涨停 {fmtNum(quotePreview.upperLimit, 2)}
                            </button>
                          )}
                          {quotePreview.lowerLimit > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setOrderType('LIMIT');
                                setOrderLimitPrice(String(quotePreview.lowerLimit));
                              }}
                              className="text-[#00c853] hover:underline"
                            >
                              跌停 {fmtNum(quotePreview.lowerLimit, 2)}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="space-y-0.5">
                          {(quotePreview.asks || []).slice(0, 5).map((lvl) => (
                            <button
                              key={`a-${lvl.level}`}
                              type="button"
                              onClick={() => {
                                setOrderType('LIMIT');
                                setOrderLimitPrice(String(lvl.price));
                              }}
                              className="w-full flex items-center justify-between px-1 hover:bg-[#161b24]"
                              title="点击填入限价单"
                            >
                              <span className="text-[#7d8796]">卖{lvl.level}</span>
                              <span className="text-[#00c853]">{fmtNum(lvl.price, 2)}</span>
                              <span className="text-[#8b95a5]">{lvl.volume}</span>
                            </button>
                          ))}
                        </div>
                        <div className="space-y-0.5">
                          {(quotePreview.bids || []).slice(0, 5).map((lvl) => (
                            <button
                              key={`b-${lvl.level}`}
                              type="button"
                              onClick={() => {
                                setOrderType('LIMIT');
                                setOrderLimitPrice(String(lvl.price));
                              }}
                              className="w-full flex items-center justify-between px-1 hover:bg-[#161b24]"
                              title="点击填入限价单"
                            >
                              <span className="text-[#7d8796]">买{lvl.level}</span>
                              <span className="text-[#ff3535]">{fmtNum(lvl.price, 2)}</span>
                              <span className="text-[#8b95a5]">{lvl.volume}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Order Type (MARKET_IOC / LIMIT) + Slippage */}
                <div className="grid grid-cols-12 gap-1 items-center">
                  <div className="col-span-6 grid grid-cols-2 border border-[#222832]">
                    <button
                      type="button"
                      onClick={() => setOrderType('MARKET_IOC')}
                      className={`h-[22px] text-[10px] font-semibold ${
                        orderType === 'MARKET_IOC'
                          ? 'bg-[#ff8800] text-[#090c10]'
                          : 'bg-[#161b24] text-[#8b95a5]'
                      }`}
                    >
                      五档IOC
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOrderType('LIMIT');
                        if (!orderLimitPrice && quotePreview?.lastPrice) {
                          setOrderLimitPrice(String(quotePreview.lastPrice));
                        }
                      }}
                      className={`h-[22px] text-[10px] font-semibold ${
                        orderType === 'LIMIT'
                          ? 'bg-[#4da3ff] text-[#090c10]'
                          : 'bg-[#161b24] text-[#8b95a5]'
                      }`}
                    >
                      限价LIMIT
                    </button>
                  </div>
                  {orderType === 'LIMIT' ? (
                    <input
                      type="number"
                      step="0.01"
                      value={orderLimitPrice}
                      onChange={(e) => setOrderLimitPrice(e.target.value)}
                      placeholder="限价价格"
                      className="col-span-6 h-[22px] px-1.5 bg-[#090c10] border border-[#4da3ff] text-[10px] text-[#4da3ff] tabular-nums focus:outline-none"
                    />
                  ) : (
                    <div className="col-span-6 flex items-center gap-1 text-[10px] text-[#8b95a5]">
                      <span className="shrink-0">滑点(bps)</span>
                      <input
                        type="number"
                        step="0.5"
                        value={orderSlippageBps}
                        onChange={(e) => setOrderSlippageBps(e.target.value)}
                        className="w-full h-[22px] px-1.5 bg-[#090c10] border border-[#2b3444] text-[10px] text-[#e5b567] tabular-nums focus:outline-none focus:border-[#ff8800]"
                      />
                    </div>
                  )}
                </div>

                {/* Quantity / Allocation % */}
                <div>
                  <div className="flex items-center justify-between text-[10px] text-[#8b95a5] mb-1">
                    <span>委托规模</span>
                    <div className="flex border border-[#222832]">
                      <button
                        type="button"
                        onClick={() => setSizingMode('qty')}
                        className={`px-1.5 py-0.5 text-[10px] ${
                          sizingMode === 'qty' ? 'bg-[#ff8800] text-[#090c10] font-bold' : 'bg-[#161b24] text-[#8b95a5]'
                        }`}
                      >
                        按{orderMarket === 'ashare' ? '股数' : '手数'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSizingMode('pct')}
                        className={`px-1.5 py-0.5 text-[10px] ${
                          sizingMode === 'pct' ? 'bg-[#ff8800] text-[#090c10] font-bold' : 'bg-[#161b24] text-[#8b95a5]'
                        }`}
                      >
                        按净值%
                      </button>
                    </div>
                  </div>

                  {sizingMode === 'qty' ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={orderQty}
                        onChange={(e) => setOrderQty(e.target.value)}
                        className="flex-1 h-[26px] px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#dfe6f0] tabular-nums focus:outline-none focus:border-[#ff8800]"
                      />
                      {(orderMarket === 'ashare' ? ['100', '500', '1000'] : ['1', '2', '5']).map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => setOrderQty(q)}
                          className="h-[26px] px-1.5 bg-[#161b24] border border-[#252c38] hover:border-[#ff8800] text-[10px] text-[#cfd8e3] tabular-nums"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={orderAllocPct}
                        onChange={(e) => setOrderAllocPct(e.target.value)}
                        className="flex-1 h-[26px] px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#f0b90b] tabular-nums focus:outline-none focus:border-[#ff8800]"
                      />
                      {['10', '20', '30'].map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setOrderAllocPct(p)}
                          className="h-[26px] px-1.5 bg-[#161b24] border border-[#252c38] hover:border-[#ff8800] text-[10px] text-[#f0b90b] tabular-nums"
                        >
                          {p}%
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Leverage */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-[#8b95a5]">杠杆倍数:</span>
                  {orderMarket === 'ashare' ? (
                    <span className="px-2 py-0.5 text-[10px] bg-[#11151d] border border-[#222832] text-[#8b95a5]">
                      1x 现货无杠杆 (T+1)
                    </span>
                  ) : (
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 5, 10].map((lv) => (
                        <button
                          key={lv}
                          type="button"
                          onClick={() => setOrderLeverage(lv)}
                          className={`px-1.5 py-0.5 text-[10px] border tabular-nums ${
                            orderLeverage === lv
                              ? 'bg-[#ff8800] border-[#ff8800] text-[#090c10] font-bold'
                              : 'bg-[#161b24] border-[#252c38] text-[#9aa5b5]'
                          }`}
                        >
                          {lv}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pre-set StopLoss & TakeProfit */}
                <div className="grid grid-cols-12 gap-1 items-center">
                  <input
                    type="number"
                    step="0.01"
                    value={orderStopLossPrice}
                    onChange={(e) => setOrderStopLossPrice(e.target.value)}
                    placeholder="证伪止损价(选填)"
                    className="col-span-4 h-[23px] px-1.5 bg-[#090c10] border border-[#2b3444] text-[10px] text-[#f0b90b] tabular-nums focus:outline-none focus:border-[#ff8800]"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={orderTakeProfitPrice}
                    onChange={(e) => setOrderTakeProfitPrice(e.target.value)}
                    placeholder="目标止盈价"
                    className="col-span-4 h-[23px] px-1.5 bg-[#090c10] border border-[#2b3444] text-[10px] text-[#00c853] tabular-nums focus:outline-none focus:border-[#ff8800]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const basePx = preTradeCalc.refPx > 0 ? preTradeCalc.refPx : safeNum(quotePreview?.lastPrice, 0);
                      if (basePx > 0) {
                        const mult = orderAction === 'open_short' ? 1.045 : 0.955;
                        setOrderStopLossPrice((basePx * mult).toFixed(2));
                      }
                    }}
                    className="col-span-4 h-[23px] px-1 bg-[#161b24] border border-[#2b3444] hover:border-[#ff8800] text-[10px] text-[#e5b567]"
                  >
                    按-4.5%设止损
                  </button>
                </div>

                {/* Strategy Tag & Note */}
                <div className="grid grid-cols-2 gap-1">
                  <select
                    value={orderStrategyTag}
                    onChange={(e) => setOrderStrategyTag(e.target.value)}
                    className="h-[25px] px-1.5 bg-[#090c10] border border-[#2b3444] text-[10px] text-[#4da3ff] focus:outline-none focus:border-[#ff8800]"
                  >
                    <option value="CPO五节点门控">CPO五节点门控</option>
                    <option value="PM事件预期差">PM事件预期差</option>
                    <option value="PandaAI因子">PandaAI因子</option>
                    <option value="跨所超前认知">跨所超前认知</option>
                    <option value="手工主观交易">手工主观交易</option>
                  </select>
                  <input
                    type="text"
                    value={orderNote}
                    onChange={(e) => setOrderNote(e.target.value)}
                    placeholder="委托备注..."
                    className="h-[25px] px-1.5 bg-[#090c10] border border-[#2b3444] text-[10px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
                  />
                </div>

                {/* Pre-Trade穿透风控试算卡 */}
                {preTradeCalc.estFillPx > 0 && (
                  <div className="bg-[#0b0e14] border border-[#222832] px-2 py-1 text-[10px] tabular-nums space-y-0.5">
                    <div className="flex items-center justify-between text-[#8b95a5]">
                      <span>预估均价 / 量</span>
                      <span className="text-[#dfe6f0]">
                        {fmtNum(preTradeCalc.estFillPx, 3)} × {preTradeCalc.estQty}
                        {orderMarket === 'ashare' ? '股' : '手'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[#8b95a5]">
                      <span>动用资金 / 占净值</span>
                      <span className={preTradeCalc.overCash ? 'text-[#ff3535] font-bold' : 'text-[#e5b567]'}>
                        ¥{fmtNum(preTradeCalc.marginOrCost, 0)} ({preTradeCalc.postTradePct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[#8b95a5]">
                      <span>预估费税明细</span>
                      <span className="text-[#f0b90b]">
                        ¥{fmtNum(preTradeCalc.estTotalFee, 2)} (佣{fmtNum(preTradeCalc.commission, 1)}
                        {preTradeCalc.stampDuty > 0 ? `+印${fmtNum(preTradeCalc.stampDuty, 1)}` : ''})
                      </span>
                    </div>
                    {preTradeCalc.maxStopRisk > 0 && (
                      <div className="flex items-center justify-between text-[#8b95a5]">
                        <span>止损最大回撤风险</span>
                        <span className="text-[#ff3535]">-¥{fmtNum(preTradeCalc.maxStopRisk, 0)}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Submit Order Button */}
                <button
                  type="button"
                  onClick={() => handlePlaceOrder()}
                  disabled={submittingOrder}
                  className="w-full h-[28px] bg-[#ff8800] hover:bg-[#ff9922] text-[#090c10] text-[12px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  <Play className="w-3.5 h-3.5" />
                  {submittingOrder ? '正在写库撮合...' : '立即下单执行'}
                </button>

                {orderFeedback && (
                  <div
                    className={`px-2 py-1.5 text-[11px] border leading-snug ${
                      orderFeedback.ok
                        ? 'bg-[#0b1f16] border-[#1f5c3a] text-[#00c853]'
                        : 'bg-[#211013] border-[#662229] text-[#ff3535]'
                    }`}
                  >
                    {orderFeedback.text}
                  </div>
                )}
              </div>

              {/* One-Click Signal Launcher */}
              <PaneHeader
                title="一键信号建仓快捷区"
                badge={`${quickSignals.length} 信号`}
                right={
                  <button
                    type="button"
                    onClick={loadQuickSignals}
                    disabled={loadingSignals}
                    className="text-[10px] text-[#ff8800] hover:underline"
                  >
                    {loadingSignals ? '抓取中...' : '刷新信号'}
                  </button>
                }
              />
              <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#1a202b]">
                {quickSignals.length === 0 ? (
                  <div className="p-3 text-[11px] text-[#6d7787] text-center">
                    {loadingSignals ? '正在汇聚 CPO五节点 / PM预期差 / PandaAI Top3...' : '暂无实时策略信号'}
                  </div>
                ) : (
                  quickSignals.map((sig) => (
                    <div key={sig.id} className="p-2 hover:bg-[#11151d] space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="px-1 py-0.5 text-[9px] bg-[#161b24] border border-[#2b3444] text-[#ff8800] shrink-0">
                            {sig.source}
                          </span>
                          <span className="text-[11px] font-bold text-[#e5b567] shrink-0">{sig.symbol}</span>
                          <span className="text-[11px] text-[#dfe6f0] truncate">{sig.name}</span>
                        </div>
                        <span
                          className={`text-[10px] font-semibold shrink-0 ${
                            sig.action === 'open_short' ? 'text-[#00c853]' : 'text-[#ff3535]'
                          }`}
                        >
                          {sig.action === 'open_short' ? '做空' : '做多'} {sig.allocationPct}%
                        </span>
                      </div>
                      <div className="text-[10px] text-[#7d8796] truncate" title={sig.rationale}>
                        {sig.rationale}
                      </div>
                      <div className="flex items-center justify-between gap-1 pt-0.5">
                        <span className="text-[10px] text-[#4da3ff] tabular-nums">{sig.metricBadge}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleImportQuickSignal(sig, false)}
                            className="px-1.5 py-0.5 text-[10px] bg-[#161b24] border border-[#2b3444] hover:border-[#ff8800] text-[#cfd8e3]"
                          >
                            一键导入策略信号建仓
                          </button>
                          <button
                            type="button"
                            onClick={() => handleImportQuickSignal(sig, true)}
                            disabled={submittingOrder}
                            className="px-1.5 py-0.5 text-[10px] bg-[#211508] border border-[#ff8800] text-[#ff8800] hover:bg-[#ff8800] hover:text-[#090c10] font-semibold"
                          >
                            直发
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB [02]: SQLITE BACKTEST ARCHIVE ==================== */}
      {subTab === 'archive-repo' && (
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
          {/* Filter & Action Toolbar */}
          <div className="bg-[#0e1117] px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex flex-wrap items-center gap-1">
              {[
                { id: 'all', label: '全部引擎' },
                { id: 'ashare_t1', label: 'A股T+1' },
                { id: 'pm_event', label: 'PM事件联立' },
                { id: 'cpo_dag', label: 'CPO五节点' },
                { id: 'alt_consensus', label: '超前认知' },
                { id: 'futures_t0', label: '期货T+0' },
              ].map((ef) => (
                <button
                  key={ef.id}
                  type="button"
                  onClick={() => setEngineFilter(ef.id)}
                  className={`h-[24px] px-2.5 text-[11px] border ${
                    engineFilter === ef.id
                      ? 'bg-[#ff8800] border-[#ff8800] text-[#090c10] font-bold'
                      : 'bg-[#161b24] border-[#252c38] text-[#9aa5b5] hover:text-[#dfe6f0]'
                  }`}
                >
                  {ef.label}
                </button>
              ))}
              <input
                type="text"
                value={archiveSearch}
                onChange={(e) => setArchiveSearch(e.target.value)}
                placeholder="筛选标的/策略/参数..."
                className="h-[24px] w-48 ml-2 px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
              />
            </div>

            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-[#e5b567] tabular-nums">已选对比: {comparedRuns.length} / 4</span>
              {comparedRuns.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCompareIds([])}
                  className="h-[22px] px-2 bg-[#161b24] border border-[#2b3444] text-[10px] text-[#8b95a5] hover:text-[#dfe6f0]"
                >
                  清空勾选
                </button>
              )}
              <button
                type="button"
                onClick={() => loadArchives(engineFilter)}
                className="h-[22px] px-2 bg-[#161b24] border border-[#2b3444] hover:border-[#ff8800] text-[10px] text-[#cfd8e3]"
              >
                {loadingArchives ? '加载中...' : '刷新归档'}
              </button>
            </div>
          </div>

          {/* Main Split: Archive Table | Multi-Run Comparison Matrix */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-[1px] bg-[#222832] overflow-hidden">
            {/* Left Archive Table */}
            <div className="flex-1 min-w-0 bg-[#0e1117] flex flex-col overflow-hidden">
              <PaneHeader
                title="SQLite 历史回测归档仓库 (自动持久化 5 大引擎实验)"
                badge={`共 ${filteredSortedArchives.length} 条`}
                right={<span>点击表头指标可排序 · 支持 Markdown 投研报告与 CSV 导出</span>}
              />
              <div className="flex-1 overflow-auto">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th className="text-center w-10">对比</th>
                      <th className="text-left cursor-pointer hover:text-[#ff8800]" onClick={() => toggleArchiveSort('createdAt')}>
                        归档时间 {archiveSortBy === 'createdAt' ? (archiveSortDir === 'desc' ? '↓' : '↑') : ''}
                      </th>
                      <th className="text-left">引擎类型</th>
                      <th className="text-left">标的</th>
                      <th className="text-left">策略名称</th>
                      <th className="text-right cursor-pointer hover:text-[#ff8800]" onClick={() => toggleArchiveSort('totalReturnPct')}>
                        总收益% {archiveSortBy === 'totalReturnPct' ? (archiveSortDir === 'desc' ? '↓' : '↑') : ''}
                      </th>
                      <th className="text-right">超额%</th>
                      <th className="text-right cursor-pointer hover:text-[#ff8800]" onClick={() => toggleArchiveSort('sharpe')}>
                        Sharpe {archiveSortBy === 'sharpe' ? (archiveSortDir === 'desc' ? '↓' : '↑') : ''}
                      </th>
                      <th className="text-right cursor-pointer hover:text-[#ff8800]" onClick={() => toggleArchiveSort('maxDrawdownPct')}>
                        最大回撤% {archiveSortBy === 'maxDrawdownPct' ? (archiveSortDir === 'desc' ? '↓' : '↑') : ''}
                      </th>
                      <th className="text-right cursor-pointer hover:text-[#ff8800]" onClick={() => toggleArchiveSort('winRatePct')}>
                        胜率% {archiveSortBy === 'winRatePct' ? (archiveSortDir === 'desc' ? '↓' : '↑') : ''}
                      </th>
                      <th className="text-center">操作与报告导出</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSortedArchives.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="text-center py-8 text-[#6d7787]">
                          当前筛选下暂无归档记录 — 在 F8/F10/F12 运行任意回测后将自动入库 SQLite
                        </td>
                      </tr>
                    ) : (
                      filteredSortedArchives.map((run) => {
                        const checked = compareIds.includes(run.id);
                        return (
                          <tr key={run.id} className={checked ? 'bg-[#19202e]' : ''}>
                            <td className="text-center">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCompareId(run.id)}
                                className="accent-[#ff8800] cursor-pointer"
                              />
                            </td>
                            <td className="text-[#8b95a5] text-[11px] tabular-nums">{shortTime(run.createdAt)}</td>
                            <td>
                              <span className="px-1.5 py-0.5 text-[10px] bg-[#161b24] border border-[#2b3444] text-[#4da3ff]">
                                {ENGINE_LABEL[run.engineType] || run.engineType}
                              </span>
                            </td>
                            <td>
                              {isAShareSymbol(run.symbol) ? (
                                <button
                                  type="button"
                                  onClick={() => onSelectStock(run.symbol, run.symbolName)}
                                  className="text-[#e5b567] hover:underline font-semibold mr-1"
                                >
                                  {run.symbol}
                                </button>
                              ) : (
                                <span className="text-[#e5b567] font-semibold mr-1">{run.symbol}</span>
                              )}
                              <span className="text-[#cfd8e3] text-[11px]">{run.symbolName}</span>
                            </td>
                            <td className="text-[#dfe6f0] max-w-[200px] truncate" title={`${run.strategyName} (${run.paramsSummary})`}>
                              {run.strategyName}
                            </td>
                            <td className={`text-right font-semibold tabular-nums ${colorUpDown(run.totalReturnPct)}`}>
                              {fmtPct(run.totalReturnPct)}
                            </td>
                            <td className={`text-right tabular-nums ${colorUpDown(run.excessReturnPct)}`}>
                              {fmtPct(run.excessReturnPct)}
                            </td>
                            <td className="text-right tabular-nums text-[#f0b90b]">{fmtNum(run.sharpe, 2)}</td>
                            <td className="text-right tabular-nums text-[#00c853]">-{Math.abs(safeNum(run.maxDrawdownPct)).toFixed(2)}%</td>
                            <td className="text-right tabular-nums">{fmtNum(run.winRatePct, 1)}%</td>
                            <td className="text-center">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    downloadWithAuth(
                                      api.getArchivedBacktestExportUrl(run.id, 'md'),
                                      `research_${run.symbol}_${run.id.slice(0, 8)}.md`
                                    ).catch((err) => notify('err', err.message))
                                  }
                                  className="px-1.5 py-0.5 text-[10px] bg-[#161b24] border border-[#2b3444] hover:border-[#ff8800] text-[#ff8800]"
                                >
                                  导出MD研报
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    downloadWithAuth(
                                      api.getArchivedBacktestExportUrl(run.id, 'csv'),
                                      `trades_${run.symbol}_${run.id.slice(0, 8)}.csv`
                                    ).catch((err) => notify('err', err.message))
                                  }
                                  className="px-1.5 py-0.5 text-[10px] bg-[#161b24] border border-[#2b3444] hover:border-[#4da3ff] text-[#4da3ff]"
                                >
                                  导出CSV
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteArchive(run.id)}
                                  className="px-1.5 py-0.5 text-[10px] bg-[#161b24] border border-[#2b3444] hover:border-[#ff3535] text-[#8b95a5] hover:text-[#ff3535]"
                                >
                                  删除
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Multi-Run Comparison Matrix */}
            <div className="w-full lg:w-[410px] shrink-0 bg-[#0e1117] flex flex-col overflow-hidden">
              <PaneHeader
                title="多策略归档横向对比矩阵 (最多4条)"
                badge={`${comparedRuns.length} 组对比`}
              />
              {comparedRuns.length === 0 ? (
                <div className="p-6 text-center text-[11px] text-[#6d7787]">
                  请在左侧勾选 1-4 条历史回测归档记录进行收益/回撤/夏普同屏对比
                </div>
              ) : (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <div ref={compareChartRef} className="h-[200px] shrink-0 bg-[#0d1015] border-b border-[#222832]" />
                  <div className="flex-1 overflow-auto">
                    <table className="w-table">
                      <thead>
                        <tr>
                          <th className="text-left">指标维度</th>
                          {comparedRuns.map((r) => (
                            <th key={r.id} className="text-right text-[#e5b567]">
                              {r.symbol}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="text-[#8b95a5]">引擎类型</td>
                          {comparedRuns.map((r) => (
                            <td key={r.id} className="text-right text-[11px] text-[#4da3ff]">
                              {ENGINE_LABEL[r.engineType] || r.engineType}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="text-[#8b95a5]">策略名称</td>
                          {comparedRuns.map((r) => (
                            <td key={r.id} className="text-right text-[10px] max-w-[90px] truncate" title={r.strategyName}>
                              {r.strategyName}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="text-[#8b95a5]">总收益率%</td>
                          {comparedRuns.map((r) => (
                            <td key={r.id} className={`text-right font-bold ${colorUpDown(r.totalReturnPct)}`}>
                              {fmtPct(r.totalReturnPct)}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="text-[#8b95a5]">年化收益%</td>
                          {comparedRuns.map((r) => (
                            <td key={r.id} className={`text-right ${colorUpDown(r.annualReturnPct)}`}>
                              {fmtPct(r.annualReturnPct)}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="text-[#8b95a5]">超额收益%</td>
                          {comparedRuns.map((r) => (
                            <td key={r.id} className={`text-right ${colorUpDown(r.excessReturnPct)}`}>
                              {fmtPct(r.excessReturnPct)}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="text-[#8b95a5]">Sharpe 比率</td>
                          {comparedRuns.map((r) => (
                            <td key={r.id} className="text-right text-[#f0b90b] font-semibold">
                              {fmtNum(r.sharpe, 2)}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="text-[#8b95a5]">最大回撤%</td>
                          {comparedRuns.map((r) => (
                            <td key={r.id} className="text-right text-[#00c853]">
                              -{Math.abs(safeNum(r.maxDrawdownPct)).toFixed(2)}%
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="text-[#8b95a5]">胜率%</td>
                          {comparedRuns.map((r) => (
                            <td key={r.id} className="text-right">
                              {fmtNum(r.winRatePct, 1)}%
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="text-[#8b95a5]">交易笔数</td>
                          {comparedRuns.map((r) => (
                            <td key={r.id} className="text-right">
                              {r.tradeCount}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="text-[#8b95a5]">参数摘要</td>
                          {comparedRuns.map((r) => (
                            <td key={r.id} className="text-right text-[10px] text-[#7d8796] max-w-[90px] truncate" title={r.paramsSummary}>
                              {r.paramsSummary}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB [03]: WEBHOOK GATEWAY & ALERTS ==================== */}
      {subTab === 'webhook-gateway' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-[1px] bg-[#222832] overflow-hidden">
          {/* Left: Webhook Channel Config + List */}
          <div className="lg:col-span-6 bg-[#0e1117] flex flex-col overflow-hidden">
            <PaneHeader
              title="飞书 / 钉钉 / 企微 / Telegram Webhook 实盘推送网关"
              badge={`${webhooks.length} 通道`}
            />

            <form onSubmit={handleSaveWebhook} className="p-2.5 border-b border-[#222832] space-y-2 bg-[#11151d] shrink-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-[#8b95a5] mb-0.5">通道名称</label>
                  <input
                    type="text"
                    value={whName}
                    onChange={(e) => setWhName(e.target.value)}
                    placeholder="如: 投研室飞书预警群"
                    className="w-full h-[26px] px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#8b95a5] mb-0.5">Webhook 协议类型</label>
                  <select
                    value={whProvider}
                    onChange={(e) => setWhProvider(e.target.value as WebhookProviderType)}
                    className="w-full h-[26px] px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#e5b567] focus:outline-none focus:border-[#ff8800]"
                  >
                    <option value="feishu">飞书 Feishu (Interactive Card)</option>
                    <option value="dingtalk">钉钉 DingTalk (支持 HmacSHA256 加签)</option>
                    <option value="wecom">企业微信 WeCom (Markdown)</option>
                    <option value="telegram">Telegram Bot (sendMessage)</option>
                    <option value="custom_json">自定义 JSON Webhook</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                <div className="sm:col-span-8">
                  <label className="block text-[10px] text-[#8b95a5] mb-0.5">Webhook Endpoint URL</label>
                  <input
                    type="text"
                    value={whUrl}
                    onChange={(e) => setWhUrl(e.target.value)}
                    placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                    className="w-full h-[26px] px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-[10px] text-[#8b95a5] mb-0.5">加签密钥 / Token (可选)</label>
                  <input
                    type="text"
                    value={whSecret}
                    onChange={(e) => setWhSecret(e.target.value)}
                    placeholder="钉钉 SEC... / 飞书签名"
                    className="w-full h-[26px] px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-[#8b95a5]">订阅事件:</span>
                  {EVENT_FILTERS.map((ef) => {
                    const active = whEvents.includes(ef.id);
                    return (
                      <button
                        key={ef.id}
                        type="button"
                        onClick={() =>
                          setWhEvents((prev) =>
                            prev.includes(ef.id) ? prev.filter((x) => x !== ef.id) : [...prev, ef.id]
                          )
                        }
                        className={`px-1.5 py-0.5 text-[10px] border ${
                          active
                            ? 'bg-[#211508] border-[#ff8800] text-[#ff8800]'
                            : 'bg-[#090c10] border-[#252c38] text-[#7d8796]'
                        }`}
                      >
                        {ef.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] text-[#cfd8e3] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={whEnabled}
                      onChange={(e) => setWhEnabled(e.target.checked)}
                      className="accent-[#ff8800]"
                    />
                    启用推送
                  </label>
                  <button
                    type="submit"
                    disabled={savingWebhook}
                    className="h-[26px] px-3 bg-[#ff8800] hover:bg-[#ff9922] text-[#090c10] text-[11px] font-bold"
                  >
                    {savingWebhook ? '保存中...' : editingWebhookId ? '更新通道' : '保存通道'}
                  </button>
                </div>
              </div>
            </form>

            {webhookTestResult && (
              <div
                className={`px-2.5 py-1.5 text-[11px] border-b border-[#222832] flex items-center justify-between ${
                  webhookTestResult.ok ? 'bg-[#0b1f16] text-[#00c853]' : 'bg-[#211013] text-[#ff3535]'
                }`}
              >
                <span>
                  [Webhook 测试回执] {webhookTestResult.ok ? 'HTTP 成功' : '投递异常'}: {webhookTestResult.statusText}
                </span>
                <button type="button" onClick={() => setWebhookTestResult(null)} className="text-[10px] underline">
                  清除
                </button>
              </div>
            )}

            <div className="flex-1 overflow-auto">
              <table className="w-table">
                <thead>
                  <tr>
                    <th className="text-left">通道名称</th>
                    <th className="text-left">协议</th>
                    <th className="text-left">状态 / 最近回执</th>
                    <th className="text-center">开关</th>
                    <th className="text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {webhooks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-6 text-[#6d7787]">
                        {loadingWebhooks ? '正在读取 SQLite Webhook 通道...' : '暂无已配置通道，请在上方添加飞书/钉钉/企微/TG Webhook'}
                      </td>
                    </tr>
                  ) : (
                    webhooks.map((ch) => (
                      <tr key={ch.id}>
                        <td>
                          <div className="text-[#dfe6f0] font-semibold">{ch.name}</div>
                          <div className="text-[10px] text-[#6d7787] max-w-[190px] truncate" title={ch.webhookUrl}>
                            {ch.webhookUrl}
                          </div>
                        </td>
                        <td>
                          <span className="px-1.5 py-0.5 text-[10px] bg-[#161b24] border border-[#2b3444] text-[#e5b567]">
                            {PROVIDER_LABEL[ch.provider] || ch.provider}
                          </span>
                        </td>
                        <td>
                          <div className="text-[11px] text-[#9aa5b5] max-w-[160px] truncate" title={ch.lastStatus || ''}>
                            {ch.lastStatus || '尚未触发测试'}
                          </div>
                          <div className="text-[10px] text-[#6d7787] tabular-nums">{shortTime(ch.lastSentAt)}</div>
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleWebhook(ch)}
                            className={`px-2 py-0.5 text-[10px] border ${
                              ch.enabled
                                ? 'bg-[#0b1f16] border-[#1f5c3a] text-[#00c853]'
                                : 'bg-[#161b24] border-[#2b3444] text-[#7d8796]'
                            }`}
                          >
                            {ch.enabled ? '已启用' : '已停用'}
                          </button>
                        </td>
                        <td className="text-center">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleTestWebhook(ch.id)}
                              className="px-1.5 py-0.5 text-[10px] bg-[#211508] border border-[#ff8800] text-[#ff8800] hover:bg-[#ff8800] hover:text-[#090c10] inline-flex items-center gap-0.5"
                            >
                              <Send className="w-2.5 h-2.5" />
                              发送实盘测试卡片
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteWebhook(ch.id)}
                              className="px-1.5 py-0.5 text-[10px] bg-[#161b24] border border-[#2b3444] hover:border-[#ff3535] text-[#8b95a5] hover:text-[#ff3535]"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: Active alert_rules + SQLite alert_events audit stream */}
          <div className="lg:col-span-6 bg-[#0e1117] flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
            {/* Active Alert Rules */}
            <div className="bg-[#0e1117] flex flex-col flex-1 min-h-0 overflow-hidden">
              <PaneHeader
                title="活跃预警规则管理器 (SQLite alert_rules)"
                badge={`${alertRules.length} 条规则`}
                right={
                  onNavigate ? (
                    <button
                      type="button"
                      onClick={() => onNavigate('monitor')}
                      className="text-[10px] text-[#4da3ff] hover:underline"
                    >
                      打开 F11 完整监控中心
                    </button>
                  ) : null
                }
              />

              <form onSubmit={handleCreateRule} className="p-2 bg-[#11151d] border-b border-[#222832] flex flex-wrap items-center gap-1.5 shrink-0">
                <input
                  type="text"
                  value={newRuleCode}
                  onChange={(e) => setNewRuleCode(e.target.value)}
                  placeholder="代码(*=全市场)"
                  className="h-[24px] w-24 px-1.5 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#e5b567] focus:outline-none focus:border-[#ff8800]"
                />
                <select
                  value={newRuleMetric}
                  onChange={(e) => setNewRuleMetric(e.target.value as MonitorRule['metric'])}
                  className="h-[24px] px-1.5 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
                >
                  <option value="changePct">盘中涨幅 &gt;= (%)</option>
                  <option value="priceAbove">突破价格 &gt;= (元)</option>
                  <option value="priceBelow">跌破止损 &lt;= (元)</option>
                  <option value="volumeRatio">量比突增 &gt;= (倍)</option>
                  <option value="brokenBoard">涨停炸板告警</option>
                </select>
                <input
                  type="number"
                  step="0.1"
                  value={newRuleThreshold}
                  onChange={(e) => setNewRuleThreshold(e.target.value)}
                  className="h-[24px] w-16 px-1.5 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#f0b90b] tabular-nums focus:outline-none focus:border-[#ff8800]"
                />
                <input
                  type="text"
                  value={newRuleName}
                  onChange={(e) => setNewRuleName(e.target.value)}
                  placeholder="规则备注名(可选)"
                  className="h-[24px] flex-1 min-w-[110px] px-1.5 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
                />
                <button
                  type="submit"
                  disabled={savingRule}
                  className="h-[24px] px-2.5 bg-[#ff8800] text-[#090c10] text-[11px] font-bold"
                >
                  + 添加规则
                </button>
              </form>

              <div className="flex-1 overflow-auto">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th className="text-left">规则名称</th>
                      <th className="text-left">监控标的</th>
                      <th className="text-left">条件阈值</th>
                      <th className="text-center">状态</th>
                      <th className="text-center">删除</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alertRules.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-4 text-[#6d7787]">
                          暂无预警规则
                        </td>
                      </tr>
                    ) : (
                      alertRules.map((r) => (
                        <tr key={r.id}>
                          <td className="text-[#dfe6f0]">{r.name}</td>
                          <td>
                            <span className="text-[#e5b567] font-semibold">{r.code}</span>
                          </td>
                          <td className="text-[#4da3ff] tabular-nums">
                            {r.metric} &gt;= {r.threshold}
                          </td>
                          <td className="text-center">
                            <button
                              type="button"
                              onClick={() => handleToggleRule(r)}
                              className={`px-1.5 py-0.5 text-[10px] border ${
                                r.enabled
                                  ? 'bg-[#0b1f16] border-[#1f5c3a] text-[#00c853]'
                                  : 'bg-[#161b24] border-[#2b3444] text-[#7d8796]'
                              }`}
                            >
                              {r.enabled ? '监控中' : '暂停'}
                            </button>
                          </td>
                          <td className="text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteRule(r.id)}
                              className="text-[#8b95a5] hover:text-[#ff3535]"
                            >
                              <Trash2 className="w-3.5 h-3.5 inline" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SQLite alert_events Audit Stream */}
            <div className="bg-[#0e1117] flex flex-col flex-1 min-h-0 overflow-hidden">
              <PaneHeader
                title="SQLite alert_events 实时预警触发审计流"
                badge={`${alertEvents.length} 条事件`}
                right={
                  <button
                    type="button"
                    onClick={loadWebhooksAndAlerts}
                    className="text-[10px] text-[#ff8800] hover:underline"
                  >
                    刷新事件流
                  </button>
                }
              />
              <div className="flex-1 overflow-auto">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th className="text-left">触发时间</th>
                      <th className="text-left">标的</th>
                      <th className="text-left">命中规则</th>
                      <th className="text-center">级别</th>
                      <th className="text-left">事件详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alertEvents.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-6 text-[#6d7787]">
                          暂无预警触发记录 — 后台守护线程每 35s 扫描异动并自动推送至已启用的 Webhook 通道
                        </td>
                      </tr>
                    ) : (
                      alertEvents.map((ev) => (
                        <tr key={ev.id}>
                          <td className="text-[#8b95a5] text-[11px] tabular-nums">{ev.time}</td>
                          <td>
                            <button
                              type="button"
                              onClick={() => isAShareSymbol(ev.code) && onSelectStock(ev.code, ev.name)}
                              className="text-[#e5b567] hover:underline font-semibold mr-1"
                            >
                              {ev.code}
                            </button>
                            <span className="text-[#cfd8e3]">{ev.name}</span>
                          </td>
                          <td className="text-[#ff8800] text-[11px]">{ev.ruleName}</td>
                          <td className="text-center">
                            <span
                              className={`px-1.5 py-0.5 text-[10px] border ${
                                ev.level === 'critical'
                                  ? 'bg-[#211013] border-[#5c1f24] text-[#ff3535]'
                                  : ev.level === 'warn'
                                  ? 'bg-[#211a0e] border-[#5e4519] text-[#f0b90b]'
                                  : 'bg-[#161b24] border-[#2b3444] text-[#4da3ff]'
                              }`}
                            >
                              {(ev.level || 'info').toUpperCase()}
                            </span>
                          </td>
                          <td className="text-[#9aa5b5] text-[11px] max-w-[260px] truncate" title={ev.message}>
                            {ev.message}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB [04]: MULTI-TENANT · OPENAPI · SQLITE / STREAM / DESKTOP OPS ==================== */}
      {subTab === 'tenant-ops' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-[1px] bg-[#222832] overflow-hidden">
          {/* Left: Tenant Seat Switcher / Auth + OpenAPI Key Manager */}
          <div className="lg:col-span-5 bg-[#0e1117] flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
            {/* Multi-Tenant Seat Isolation */}
            <div className="bg-[#0e1117] flex flex-col shrink-0">
              <PaneHeader
                title="多租户席位隔离与账号中心 (自选股/OMS实盘专户/归档/Webhook 100% 物理隔离)"
                badge={currentUser ? currentUser.planTier.toUpperCase() : 'SAAS'}
              />
              <div className="p-2.5 space-y-2.5">
                {/* Current Seat Info */}
                <div className="bg-[#11151d] border border-[#222832] p-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <UserCheck className="w-4 h-4 text-[#ff8800] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[12px] font-bold text-[#dfe6f0] truncate">
                        {currentUser?.displayName || '首席量化台 (本地旗舰席位)'}
                      </div>
                      <div className="text-[10px] text-[#7d8796] tabular-nums">
                        userId: <span className="text-[#e5b567]">{currentUser?.id || 'u_desk_admin'}</span> · username:{' '}
                        <span className="text-[#4da3ff]">{currentUser?.username || 'desk_admin'}</span>
                      </div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] bg-[#211508] border border-[#ff8800] text-[#ff8800] font-semibold shrink-0">
                    {currentUser ? PLAN_LABELS[currentUser.planTier] || currentUser.planTier : 'Institutional'}
                  </span>
                </div>

                {/* One-click Demo Seat Switcher */}
                <div>
                  <div className="text-[10px] text-[#8b95a5] mb-1 flex items-center gap-1">
                    <Users className="w-3 h-3 text-[#4da3ff]" />
                    一键切换机构/专户隔离席位 (立即刷新全终端租户数据):
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(diagnostics?.availableSeats || []).map((seat) => {
                      const active = seat.id === currentUser?.id;
                      return (
                        <button
                          key={seat.id}
                          type="button"
                          disabled={authBusy}
                          onClick={() => handleSwitchSeat(seat.id)}
                          className={`px-2 py-1 text-[11px] border flex items-center gap-1.5 ${
                            active
                              ? 'bg-[#ff8800] border-[#ff8800] text-[#090c10] font-bold'
                              : 'bg-[#161b24] border-[#2b3444] hover:border-[#ff8800] text-[#cfd8e3]'
                          }`}
                        >
                          <span>{seat.displayName}</span>
                          <span className={`text-[9px] ${active ? 'text-[#090c10]' : 'text-[#e5b567]'}`}>
                            ({seat.username})
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Register / Login Form */}
                <form onSubmit={handleAuthSubmit} className="bg-[#11151d] border border-[#222832] p-2 space-y-1.5">
                  <div className="flex items-center justify-between border-b border-[#222832] pb-1">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setAuthMode('register')}
                        className={`px-2 py-0.5 text-[10px] border ${
                          authMode === 'register'
                            ? 'bg-[#ff8800] border-[#ff8800] text-[#090c10] font-bold'
                            : 'bg-[#161b24] border-[#252c38] text-[#8b95a5]'
                        }`}
                      >
                        注册全新隔离SaaS席位
                      </button>
                      <button
                        type="button"
                        onClick={() => setAuthMode('login')}
                        className={`px-2 py-0.5 text-[10px] border ${
                          authMode === 'login'
                            ? 'bg-[#ff8800] border-[#ff8800] text-[#090c10] font-bold'
                            : 'bg-[#161b24] border-[#252c38] text-[#8b95a5]'
                        }`}
                      >
                        账号密码登录
                      </button>
                    </div>
                    <span className="text-[10px] text-[#6d7787]">scryptSync 加盐哈希</span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="text"
                      value={authUsername}
                      onChange={(e) => setAuthUsername(e.target.value)}
                      placeholder="用户名 (如 quant_fund_a)"
                      className="h-[25px] px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
                    />
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="登录密码"
                      className="h-[25px] px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
                    />
                  </div>

                  {authMode === 'register' && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="text"
                        value={authDisplayName}
                        onChange={(e) => setAuthDisplayName(e.target.value)}
                        placeholder="席位显示名称 (如 Alpha 专户)"
                        className="h-[25px] px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
                      />
                      <select
                        value={authPlanTier}
                        onChange={(e) => setAuthPlanTier(e.target.value as SaasPlanTier)}
                        className="h-[25px] px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#e5b567] focus:outline-none focus:border-[#ff8800]"
                      >
                        <option value="free">Free 个人体验版</option>
                        <option value="pro">Pro 专业投研版</option>
                        <option value="institutional">Institutional 机构旗舰版</option>
                      </select>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={authBusy}
                    className="w-full h-[26px] bg-[#161b24] border border-[#ff8800] text-[#ff8800] hover:bg-[#ff8800] hover:text-[#090c10] text-[11px] font-bold"
                  >
                    {authBusy
                      ? '处理中...'
                      : authMode === 'register'
                      ? '立即创建独立租户并初始化实盘专户'
                      : '登录并切换租户会话'}
                  </button>
                </form>
              </div>
            </div>

            {/* OpenAPI Key Manager */}
            <div className="bg-[#0e1117] flex-1 min-h-0 flex flex-col overflow-hidden">
              <PaneHeader
                title="OpenAPI 密钥管理器 (Programmatic Quant API)"
                badge={`${diagnostics?.apiKeys?.length || 0} 个密钥`}
              />
              <div className="p-2.5 space-y-2 border-b border-[#222832] shrink-0">
                <div className="flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-[#e5b567] shrink-0" />
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="密钥用途备注"
                    className="flex-1 h-[25px] px-2 bg-[#090c10] border border-[#2b3444] text-[11px] text-[#dfe6f0] focus:outline-none focus:border-[#ff8800]"
                  />
                  <button
                    type="button"
                    onClick={handleCreateApiKey}
                    disabled={creatingKey}
                    className="h-[25px] px-2.5 bg-[#ff8800] text-[#090c10] text-[11px] font-bold shrink-0"
                  >
                    {creatingKey ? '生成中...' : '生成 tsp_live_... 密钥'}
                  </button>
                </div>

                {revealedKeyOnce?.rawKeyOnce && (
                  <div className="bg-[#211a0e] border border-[#ff8800] p-2 space-y-1">
                    <div className="text-[10px] text-[#ff8800] font-bold">
                      新签发 OpenAPI 密钥 (仅展示一次，请立即复制保存):
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-[#090c10] px-2 py-1 border border-[#2b3444]">
                      <code className="text-[11px] text-[#f0b90b] break-all select-all">
                        {revealedKeyOnce.rawKeyOnce}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopy('raw-key', revealedKeyOnce.rawKeyOnce!)}
                        className="px-2 py-0.5 text-[10px] bg-[#161b24] border border-[#ff8800] text-[#ff8800] shrink-0 flex items-center gap-1"
                      >
                        {copiedId === 'raw-key' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedId === 'raw-key' ? '已复制' : '复制'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Copyable curl snippet */}
                <div className="bg-[#11151d] border border-[#222832] p-1.5 flex items-center justify-between gap-2">
                  <code className="text-[10px] text-[#4da3ff] truncate select-all" title={curlSnippet}>
                    {curlSnippet}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy('curl-cmd', curlSnippet)}
                    className="px-1.5 py-0.5 text-[10px] bg-[#161b24] border border-[#2b3444] hover:border-[#ff8800] text-[#cfd8e3] shrink-0 flex items-center gap-1"
                  >
                    {copiedId === 'curl-cmd' ? <Check className="w-2.5 h-2.5 text-[#00c853]" /> : <Copy className="w-2.5 h-2.5" />}
                    复制 curl
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th className="text-left">密钥名称</th>
                      <th className="text-left">前缀</th>
                      <th className="text-left">权限域</th>
                      <th className="text-left">创建时间</th>
                      <th className="text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(diagnostics?.apiKeys || []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-4 text-[#6d7787]">
                          当前租户暂无活跃 OpenAPI 密钥
                        </td>
                      </tr>
                    ) : (
                      (diagnostics?.apiKeys || []).map((k) => (
                        <tr key={k.id}>
                          <td className="text-[#dfe6f0]">{k.name}</td>
                          <td className="text-[#e5b567] tabular-nums">{k.keyPrefix}...</td>
                          <td className="text-[10px] text-[#4da3ff]">{(k.scopes || []).join(', ')}</td>
                          <td className="text-[10px] text-[#8b95a5] tabular-nums">{shortTime(k.createdAt)}</td>
                          <td className="text-center">
                            <button
                              type="button"
                              onClick={() => handleRevokeApiKey(k.id)}
                              className="px-1.5 py-0.5 text-[10px] bg-[#161b24] border border-[#2b3444] hover:border-[#ff3535] text-[#8b95a5] hover:text-[#ff3535]"
                            >
                              吊销
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right: SQLite WAL Physical Monitor + SSE/Cron Monitor + Desktop Client Panel */}
          <div className="lg:col-span-7 bg-[#0e1117] flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
            {/* SQLite WAL Physical Monitor */}
            <div className="bg-[#0e1117] flex flex-col flex-[1.15] min-h-0 overflow-hidden">
              <PaneHeader
                title="SQLite WAL 数据库物理底座监控 (Node.js 内置 node:sqlite 引擎)"
                badge={`${diagnostics?.tables?.length || 0} 张表 · ${totalSqliteRows} 行`}
              />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-[1px] bg-[#222832] border-b border-[#222832] shrink-0">
                <KpiCell
                  label="日志事务模式"
                  value={(diagnostics?.journalMode || 'wal').toUpperCase()}
                  sub="PRAGMA synchronous=NORMAL"
                  tone="orange"
                />
                <KpiCell
                  label="主库文件大小"
                  value={`${(safeNum(diagnostics?.dbSizeBytes) / 1024).toFixed(1)} KB`}
                  sub="data/tsp_enterprise.sqlite"
                  tone="blue"
                />
                <KpiCell
                  label="WAL 日志体积"
                  value={`${(safeNum(diagnostics?.walSizeBytes) / 1024).toFixed(1)} KB`}
                  sub="并发读写无锁隔离"
                  tone="gold"
                />
                <KpiCell
                  label="物理库总记录数"
                  value={`${totalSqliteRows} 行`}
                  sub={`跨越 ${diagnostics?.tables?.length || 14} 张关系表`}
                  tone="neutral"
                />
              </div>
              <div className="px-2.5 py-1 bg-[#11151d] border-b border-[#222832] text-[10px] text-[#7d8796] flex items-center gap-1.5 truncate shrink-0">
                <Database className="w-3 h-3 text-[#e5b567] shrink-0" />
                <span className="truncate">物理路径: {diagnostics?.dbPath || 'data/tsp_enterprise.sqlite'}</span>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th className="text-left w-10">#</th>
                      <th className="text-left">SQLite 物理表名</th>
                      <th className="text-right">当前行数</th>
                      <th className="text-left">业务职责说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(diagnostics?.tables || []).map((t, idx) => (
                      <tr key={t.tableName}>
                        <td className="text-[#6d7787] tabular-nums">{String(idx + 1).padStart(2, '0')}</td>
                        <td className="text-[#e5b567] font-semibold">{t.tableName}</td>
                        <td className="text-right tabular-nums font-bold text-[#4da3ff]">{t.rowCount}</td>
                        <td className="text-[#9aa5b5] text-[11px]">{t.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* SSE Realtime Stream + Cron Scheduler Monitor */}
            <div className="bg-[#0e1117] flex flex-col flex-[0.9] min-h-0 overflow-hidden">
              <PaneHeader
                title="SSE 实时流推送与后台守护定时任务调度监控"
                badge={`连接数 ${diagnostics?.stream?.connectedClients ?? 0} · 已推 ${diagnostics?.stream?.totalFramesPushed ?? 0} 帧`}
              />
              <div className="grid grid-cols-4 gap-[1px] bg-[#222832] border-b border-[#222832] shrink-0">
                <KpiCell
                  label="SSE 活跃连接"
                  value={`${diagnostics?.stream?.connectedClients ?? 0}`}
                  tone="orange"
                />
                <KpiCell
                  label="累计推送帧数"
                  value={`${diagnostics?.stream?.totalFramesPushed ?? 0}`}
                  tone="blue"
                />
                <KpiCell
                  label="守护运行时长"
                  value={`${diagnostics?.stream?.uptimeSec ?? 0}s`}
                  tone="gold"
                />
                <KpiCell
                  label="本端流状态"
                  value={streamConnected ? '已实时订阅' : '重连中'}
                  tone={streamConnected ? 'up' : 'neutral'}
                />
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-table">
                  <thead>
                    <tr>
                      <th className="text-left">后台调度任务</th>
                      <th className="text-right">周期</th>
                      <th className="text-right">累计次数</th>
                      <th className="text-center">状态</th>
                      <th className="text-left">上次运行</th>
                      <th className="text-left">最新摘要</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(diagnostics?.stream?.jobs || []).map((job) => (
                      <tr key={job.name}>
                        <td className="text-[#dfe6f0] font-semibold flex items-center gap-1">
                          <Zap className="w-3 h-3 text-[#ff8800]" />
                          {job.name}
                        </td>
                        <td className="text-right tabular-nums text-[#e5b567]">{job.intervalSec}s</td>
                        <td className="text-right tabular-nums">{job.runCount}</td>
                        <td className="text-center">
                          <span
                            className={`px-1.5 py-0.5 text-[10px] border ${
                              job.status === 'ok'
                                ? 'bg-[#0b1f16] border-[#1f5c3a] text-[#00c853]'
                                : job.status === 'error'
                                ? 'bg-[#211013] border-[#662229] text-[#ff3535]'
                                : 'bg-[#161b24] border-[#2b3444] text-[#4da3ff]'
                            }`}
                          >
                            {job.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="text-[10px] text-[#8b95a5] tabular-nums">{shortTime(job.lastRunAt)}</td>
                        <td className="text-[11px] text-[#9aa5b5] max-w-[180px] truncate" title={job.lastDetail || ''}>
                          {job.lastDetail || '--'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Standalone Desktop Client Launch Panel */}
            <div className="bg-[#0e1117] shrink-0">
              <PaneHeader
                title="独立无边框桌面客户端 (TSP_Pro_Desktop.exe) 启动与部署面板"
                badge={diagnostics?.desktopClient?.exeExists ? '二进制已就绪' : '待编译构建'}
              />
              <div className="p-2.5 space-y-2 bg-[#11151d]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Monitor className="w-4 h-4 text-[#ff8800] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-[#dfe6f0] truncate">
                        {diagnostics?.desktopClient?.exePath || 'TSP_Pro_Desktop.exe'}
                      </div>
                      <div className="text-[10px] text-[#7d8796]">
                        原生 Win32/WinForms 独立桌面终端宿主 · 零浏览器地址栏 · 零黑框控制台 · 系统托盘常驻
                      </div>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 text-[10px] border font-semibold ${
                      diagnostics?.desktopClient?.exeExists
                        ? 'bg-[#0b1f16] border-[#1f5c3a] text-[#00c853]'
                        : 'bg-[#211a0e] border-[#5e4519] text-[#f0b90b]'
                    }`}
                  >
                    {diagnostics?.desktopClient?.exeExists ? 'EXE READY' : 'NOT BUILT'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 bg-[#090c10] border border-[#222832] px-2 py-1">
                  <code className="text-[11px] text-[#e5b567] truncate select-all">
                    {diagnostics?.desktopClient?.launchCommand || '.\\TSP_Pro_Desktop.exe'}
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy('desktop-cmd', diagnostics?.desktopClient?.launchCommand || '.\\TSP_Pro_Desktop.exe')
                    }
                    className="px-2 py-0.5 text-[10px] bg-[#161b24] border border-[#2b3444] hover:border-[#ff8800] text-[#cfd8e3] shrink-0 flex items-center gap-1"
                  >
                    {copiedId === 'desktop-cmd' ? <Check className="w-3 h-3 text-[#00c853]" /> : <Copy className="w-3 h-3" />}
                    复制启动命令
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px]">
                  <div className="bg-[#0e1117] border border-[#222832] px-2 py-1 text-[#9aa5b5]">
                    <Shield className="w-3 h-3 inline mr-1 text-[#ff8800]" />
                    单实例互斥锁保护
                  </div>
                  <div className="bg-[#0e1117] border border-[#222832] px-2 py-1 text-[#9aa5b5]">
                    <Server className="w-3 h-3 inline mr-1 text-[#4da3ff]" />
                    静默拉起 3130 服务
                  </div>
                  <div className="bg-[#0e1117] border border-[#222832] px-2 py-1 text-[#9aa5b5]">
                    <Activity className="w-3 h-3 inline mr-1 text-[#00c853]" />
                    Win32 窗口置顶切换
                  </div>
                  <div className="bg-[#0e1117] border border-[#222832] px-2 py-1 text-[#9aa5b5]">
                    <Bell className="w-3 h-3 inline mr-1 text-[#e5b567]" />
                    托盘直达 F12/实盘舱
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
