import type {
  AiChatMessage,
  AiChatResponse,
  AiConfig,
  AlertTriggerEvent,
  AltConsensusBacktestRequest,
  AltConsensusBacktestResponse,
  AltConsensusOverviewResponse,
  ArchivedBacktestItem,
  AssetFactDetailResponse,
  BacktestRequest,
  BacktestResponse,
  BoardFilter,
  ConceptsResponse,
  ConsensusCollectorConfig,
  ConsensusSnapshotRecord,
  CpoTransmissionBacktestRequest,
  CpoTransmissionBacktestResponse,
  CpoTransmissionOverviewResponse,
  DashboardData,
  FactBuyPointBacktestRequest,
  FactBuyPointBacktestResponse,
  FactBuyPointOverviewResponse,
  FupengBarbellBacktestRequest,
  FupengBarbellBacktestResponse,
  FupengIntelItem,
  FupengOverviewResponse,
  FuturesBacktestRequest,
  FuturesBacktestResponse,
  FuturesKlinesResponse,
  GlobalCommandStripSummary,
  HealthResponse,
  IndustriesResponse,
  IndustryDetailResponse,
  LadderPool,
  LadderResponse,
  MarketEnvResponse,
  MonitorAnomaliesResponse,
  MonitorRule,
  MonitorRulesResponse,
  PandaFactorScanRequest,
  PandaFactorScanResponse,
  PandaPmOverviewResponse,
  PaperDeskOverviewResponse,
  PaperOrderRequest,
  PmAssetUniverse,
  PmDiscoverRelationsRequest,
  PmEventBacktestRequest,
  PmEventBacktestResponse,
  PmRelationMatrixResponse,
  RealtimePulsePayload,
  SaasApiKeyItem,
  SaasAuthResponse,
  SaasPlanTier,
  SaasSystemDiagnostics,
  ScreenerRequest,
  ScreenerResponse,
  StockDetailResponse,
  StockSearchItem,
  StreamJobTickPayload,
  WatchlistItem,
  WebhookChannelItem,
} from '../types/market';

const TOKEN_STORAGE_KEY = 'tsp_saas_token';
const TENANT_STORAGE_KEY = 'tsp_tenant_user';

export function getSaasSession(): { token: string | null; userId: string | null } {
  try {
    return {
      token: localStorage.getItem(TOKEN_STORAGE_KEY),
      userId: localStorage.getItem(TENANT_STORAGE_KEY),
    };
  } catch {
    return { token: null, userId: null };
  }
}

export function setSaasSession(token: string | null, userId?: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);

    if (userId !== undefined) {
      if (userId) localStorage.setItem(TENANT_STORAGE_KEY, userId);
      else localStorage.removeItem(TENANT_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

function buildAuthQuerySuffix(hasExistingQuery: boolean): string {
  const { token, userId } = getSaasSession();
  const sp = new URLSearchParams();
  if (token) sp.set('token', token);
  if (userId) sp.set('tenantUser', userId);
  const qs = sp.toString();
  if (!qs) return '';
  return (hasExistingQuery ? '&' : '?') + qs;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const { token, userId } = getSaasSession();
  const extraHeaders: Record<string, string> = {};
  if (token) extraHeaders['Authorization'] = `Bearer ${token}`;
  if (userId) extraHeaders['X-TSP-Tenant-User'] = userId;

  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
      ...(options?.headers || {}),
    },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      msg = errBody?.error || errBody?.message || msg;
    } catch {
      // ignore parse failure
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getHealth: () => request<HealthResponse>('/api/health'),

  getDashboard: (date?: string) => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    const qs = params.toString();
    return request<DashboardData>(`/api/dashboard${qs ? `?${qs}` : ''}`);
  },

  getLadder: (params?: { date?: string; pool?: LadderPool; board?: BoardFilter }) => {
    const sp = new URLSearchParams();
    if (params?.date) sp.set('date', params.date);
    if (params?.pool) sp.set('pool', params.pool);
    if (params?.board) sp.set('board', params.board);
    const qs = sp.toString();
    return request<LadderResponse>(`/api/ladder${qs ? `?${qs}` : ''}`);
  },

  getMarketEnv: (range: '1y' | '2y' | 'all' = '1y') =>
    request<MarketEnvResponse>(`/api/market-env?range=${encodeURIComponent(range)}`),

  getConcepts: () => request<ConceptsResponse>('/api/concepts'),

  getIndustries: () => request<IndustriesResponse>('/api/industries'),

  getIndustryDetail: (code: string) =>
    request<IndustryDetailResponse>(`/api/industries/${encodeURIComponent(code)}/detail`),

  getStockDetail: (code: string, params?: { days?: number; date?: string }) => {
    const sp = new URLSearchParams();
    if (params?.days) sp.set('days', String(params.days));
    if (params?.date) sp.set('date', params.date);
    const qs = sp.toString();
    return request<StockDetailResponse>(
      `/api/stock/${encodeURIComponent(code)}${qs ? `?${qs}` : ''}`
    );
  },

  searchStocks: (q: string) =>
    request<StockSearchItem[]>(`/api/stock/search?q=${encodeURIComponent(q)}`),

  getWatchlist: (groupName?: string) =>
    request<WatchlistItem[]>(
      '/api/watchlist' + (groupName ? '?group=' + encodeURIComponent(groupName) : '')
    ),

  getWatchlistGroups: () =>
    request<{ groups: { name: string; count: number }[] }>('/api/watchlist/groups'),

  createWatchlistGroup: (name: string) =>
    request<{ groups: { name: string; count: number }[] }>('/api/watchlist/groups', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  upsertWatchlist: (item: Partial<WatchlistItem> & { code: string }) =>
    request<WatchlistItem[]>('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify(item),
    }),

  removeWatchlist: (code: string) =>
    request<WatchlistItem[]>(`/api/watchlist/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    }),

  runScreener: (payload: ScreenerRequest) =>
    request<ScreenerResponse>('/api/screener/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runBacktest: (payload: BacktestRequest) =>
    request<BacktestResponse>('/api/backtest/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAnomalies: () => request<MonitorAnomaliesResponse>('/api/monitor/anomalies'),

  getMonitorRules: () => request<MonitorRulesResponse>('/api/monitor/rules'),

  saveMonitorRule: (rule: Partial<MonitorRule>) =>
    request<MonitorRulesResponse>('/api/monitor/rules', {
      method: 'POST',
      body: JSON.stringify(rule),
    }),

  deleteMonitorRule: (id: string) =>
    request<MonitorRulesResponse>(`/api/monitor/rules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getAiConfig: () => request<AiConfig>('/api/ai/config'),

  saveAiConfig: (cfg: AiConfig) =>
    request<AiConfig>('/api/ai/config', {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),

  chatAi: (messages: AiChatMessage[], context?: Record<string, any>) =>
    request<AiChatResponse>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, context }),
    }),

  getPandaPmOverview: () => request<PandaPmOverviewResponse>('/api/panda-pm/overview'),

  runPandaFactorScan: (payload: PandaFactorScanRequest) =>
    request<PandaFactorScanResponse>('/api/panda-pm/factor-scan', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getFuturesKlines: (symbol: string) =>
    request<FuturesKlinesResponse>(
      `/api/panda-pm/futures/${encodeURIComponent(symbol)}/klines`
    ),

  runFuturesBacktest: (payload: FuturesBacktestRequest) =>
    request<FuturesBacktestResponse>('/api/panda-pm/futures-backtest', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getPmRelationMatrix: (universe: PmAssetUniverse = 'all') =>
    request<PmRelationMatrixResponse>(
      '/api/panda-pm/relation-matrix?universe=' + encodeURIComponent(universe)
    ),

  discoverPmRelations: (payload: PmDiscoverRelationsRequest) =>
    request<PmRelationMatrixResponse>('/api/panda-pm/discover-relations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runPmEventBacktest: (payload: PmEventBacktestRequest) =>
    request<PmEventBacktestResponse>('/api/panda-pm/event-backtest', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getCpoTransmissionOverview: () =>
    request<CpoTransmissionOverviewResponse>('/api/cpo-dag/overview'),

  runCpoTransmissionBacktest: (payload: CpoTransmissionBacktestRequest) =>
    request<CpoTransmissionBacktestResponse>('/api/cpo-dag/backtest', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAltConsensusOverview: () =>
    request<AltConsensusOverviewResponse>('/api/consensus/overview'),

  captureConsensusSnapshot: () =>
    request<{ ok: boolean; record: ConsensusSnapshotRecord; totalSnapshots: number }>(
      '/api/consensus/capture-snapshot',
      { method: 'POST' }
    ),

  saveCollectorConfig: (cfg: Partial<ConsensusCollectorConfig>) =>
    request<ConsensusCollectorConfig>('/api/consensus/collector-config', {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),

  runAltConsensusBacktest: (payload: AltConsensusBacktestRequest) =>
    request<AltConsensusBacktestResponse>('/api/consensus/backtest', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // ================= V6: SaaS 多租户 · 模拟实盘舱 · 归档 · Webhook · 实时流 =================

  getSaasDiagnostics: () => request<SaasSystemDiagnostics>('/api/saas/diagnostics'),

  loginSaas: (payload: { username: string; password?: string }) =>
    request<SaasAuthResponse>('/api/saas/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  registerSaas: (payload: {
    username: string;
    displayName: string;
    password: string;
    planTier?: SaasPlanTier;
  }) =>
    request<SaasAuthResponse>('/api/saas/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  switchDemoSeat: (userId: string) =>
    request<SaasAuthResponse>('/api/saas/switch-seat', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),

  createSaasApiKey: (name: string) =>
    request<SaasApiKeyItem>('/api/saas/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  revokeSaasApiKey: (id: string) =>
    request<{ ok: boolean }>('/api/saas/api-keys/' + encodeURIComponent(id), {
      method: 'DELETE',
    }),

  getPaperDesk: (portfolioId?: string) =>
    request<PaperDeskOverviewResponse>(
      '/api/paper/overview' + (portfolioId ? '?portfolioId=' + encodeURIComponent(portfolioId) : '')
    ),

  createPaperPortfolio: (payload: { name: string; initialCapital: number }) =>
    request<PaperDeskOverviewResponse>('/api/paper/portfolios', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  resetPaperPortfolio: (portfolioId: string) =>
    request<PaperDeskOverviewResponse>(
      '/api/paper/portfolios/' + encodeURIComponent(portfolioId) + '/reset',
      { method: 'POST' }
    ),

  placePaperOrder: (payload: PaperOrderRequest) =>
    request<PaperDeskOverviewResponse>('/api/paper/order', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  closePaperPosition: (positionId: string) =>
    request<PaperDeskOverviewResponse>(
      '/api/paper/positions/' + encodeURIComponent(positionId) + '/close',
      { method: 'POST' }
    ),

  getPaperOrdersCsvUrl: (portfolioId?: string) => {
    const base =
      '/api/paper/export.csv' +
      (portfolioId ? '?portfolioId=' + encodeURIComponent(portfolioId) : '');
    return base + buildAuthQuerySuffix(Boolean(portfolioId));
  },

  getArchivedBacktests: (engineType?: string) =>
    request<ArchivedBacktestItem[]>(
      '/api/archive/backtests' +
        (engineType && engineType !== 'all' ? '?engineType=' + encodeURIComponent(engineType) : '')
    ),

  deleteArchivedBacktest: (id: string) =>
    request<ArchivedBacktestItem[]>('/api/archive/backtests/' + encodeURIComponent(id), {
      method: 'DELETE',
    }),

  getArchivedBacktestExportUrl: (id: string, format: 'md' | 'csv') => {
    const base = '/api/archive/backtests/' + encodeURIComponent(id) + '/export.' + format;
    return base + buildAuthQuerySuffix(false);
  },

  getWebhookChannels: () => request<WebhookChannelItem[]>('/api/webhooks'),

  saveWebhookChannel: (payload: Partial<WebhookChannelItem>) =>
    request<WebhookChannelItem[]>('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteWebhookChannel: (id: string) =>
    request<WebhookChannelItem[]>('/api/webhooks/' + encodeURIComponent(id), {
      method: 'DELETE',
    }),

  testWebhookChannel: (id: string) =>
    request<{ ok: boolean; statusText: string; channels: WebhookChannelItem[] }>(
      '/api/webhooks/' + encodeURIComponent(id) + '/test',
      { method: 'POST' }
    ),

  // V7 多标的专属事实因子历史大复盘 & 付鹏24h宏观FICC框架
  getFactBuyPointOverview: () =>
    request<FactBuyPointOverviewResponse>('/api/fact-buypoint/overview'),

  getAssetFactDetail: (symbol: string, days = 180) =>
    request<AssetFactDetailResponse>(
      '/api/fact-buypoint/asset/' + encodeURIComponent(symbol) + '?days=' + days
    ),

  runFactBuyPointBacktest: (payload: FactBuyPointBacktestRequest) =>
    request<FactBuyPointBacktestResponse>('/api/fact-buypoint/backtest', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getFupengOverview: () => request<FupengOverviewResponse>('/api/fupeng/overview'),

  scrapeFupengNow: () =>
    request<{
      ok: boolean;
      newlyAdded: number;
      totalCount: number;
      overview: FupengOverviewResponse;
    }>('/api/fupeng/scrape-now', { method: 'POST' }),

  ingestFupengNote: (payload: { title: string; content: string; sourceUrl?: string }) =>
    request<{ ok: boolean; item: FupengIntelItem; overview: FupengOverviewResponse }>(
      '/api/fupeng/ingest-note',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  runFupengBarbellBacktest: (payload: FupengBarbellBacktestRequest) =>
    request<FupengBarbellBacktestResponse>('/api/fupeng/backtest', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getCommandStrip: () => request<GlobalCommandStripSummary>('/api/stream/command-strip'),
};

export function subscribeRealtimeStream(handlers: {
  onConnected?: (d: any) => void;
  onPulse?: (p: RealtimePulsePayload) => void;
  onAlert?: (a: AlertTriggerEvent) => void;
  onJobTick?: (t: StreamJobTickPayload) => void;
  onStatusChange?: (connected: boolean) => void;
}): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed || typeof EventSource === 'undefined') return;
    const url = '/api/stream/events' + buildAuthQuerySuffix(false);
    es = new EventSource(url);

    es.onopen = () => {
      handlers.onStatusChange?.(true);
    };

    es.addEventListener('connected', (evt: MessageEvent) => {
      handlers.onStatusChange?.(true);
      try {
        handlers.onConnected?.(JSON.parse(evt.data));
      } catch {
        // ignore
      }
    });

    es.addEventListener('pulse', (evt: MessageEvent) => {
      handlers.onStatusChange?.(true);
      try {
        handlers.onPulse?.(JSON.parse(evt.data) as RealtimePulsePayload);
      } catch {
        // ignore
      }
    });

    es.addEventListener('alert', (evt: MessageEvent) => {
      try {
        handlers.onAlert?.(JSON.parse(evt.data) as AlertTriggerEvent);
      } catch {
        // ignore
      }
    });

    es.addEventListener('job_tick', (evt: MessageEvent) => {
      try {
        const tick = JSON.parse(evt.data) as StreamJobTickPayload;
        handlers.onJobTick?.(tick);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('tsp:job-tick', { detail: tick }));
        }
      } catch {
        // ignore
      }
    });

    es.onerror = () => {
      handlers.onStatusChange?.(false);
      if (es) {
        es.close();
        es = null;
      }
      if (!closed) {
        retryTimer = setTimeout(connect, 4000);
      }
    };
  };

  connect();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (es) {
      es.close();
      es = null;
    }
    handlers.onStatusChange?.(false);
  };
}

export function formatAmount(val?: number | null): string {
  if (val === undefined || val === null || Number.isNaN(val)) return '-';
  const abs = Math.abs(val);
  if (abs >= 1e12) return `${(val / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${(val / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(val / 1e4).toFixed(1)}万`;
  return val.toFixed(0);
}

export function formatPct(val?: number | null, digits = 2): string {
  if (val === undefined || val === null || Number.isNaN(val)) return '-';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(digits)}%`;
}

export function aShareColorClass(val?: number | null): string {
  if (val === undefined || val === null || val === 0) return 'text-slate-300';
  return val > 0 ? 'text-red-500' : 'text-emerald-500';
}
