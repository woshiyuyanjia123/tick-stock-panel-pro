import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import type { BoardFilter, DataSourceStatus, LadderPool } from '../src/types/market';
import {
  fetchAllAShareSnapshots,
  fetchConceptBoards,
  fetchIndustryBoards,
  fetchStockChanges,
  fetchZTPool,
} from './providers/eastmoney';
import { fetchIndices, resolveTradingDates } from './providers/tencent';
import { chatWithAi } from './services/aiService';
import { getDashboardData } from './services/dashboardService';
import { getLadderData } from './services/ladderService';
import { getMarketEnvData } from './services/marketEnvService';
import { evaluateMonitorRules, getMonitorAnomalies } from './services/monitorService';
import {
  fetchFuturesKLines,
  getPandaPmOverview,
  runFuturesBacktest,
  scanWithPandaFactor,
} from './services/pandaPmService';
import {
  discoverPmRelations,
  getPmRelationMatrix,
  runPmEventBacktest,
} from './services/pmCorrelationService';
import {
  getCpoTransmissionOverview,
  runCpoTransmissionBacktest,
} from './services/cpoTransmissionService';
import {
  captureConsensusSnapshot,
  getAltConsensusOverview,
  runAltConsensusBacktest,
  saveCollectorConfig,
} from './services/altConsensusService';
import {
  getAssetFactDetail,
  getFactBuyPointOverview,
  runFactBuyPointBacktest,
} from './services/factBuyPointService';
import {
  getFupengFrameworkOverview,
  ingestCustomFupengNote,
  runFupengBarbellBacktest,
  scrapeFupengLatestIntel,
} from './services/fupengMacroService';
import { runBacktest, runScreener } from './services/quantService';
import { getConceptsData, getIndustriesData, getIndustryDetail } from './services/sectorService';
import { getStockDetail, getWatchlistWithQuotes, searchStocks } from './services/stockService';
import {
  createApiKey,
  getSqliteDiagnostics,
  loginSaasUser,
  registerSaasUser,
  resolveTenantUser,
  revokeApiKey,
  switchDemoSeat,
} from './services/authTenantService';
import {
  closePaperPosition,
  createPaperPortfolio,
  exportPaperOrdersCsv,
  getOmsQuotePreview,
  getPaperDeskOverview,
  placePaperOrder,
  resetPaperPortfolio,
  updatePositionStops,
} from './services/paperTradingService';
import {
  dbGetOmsPolicy,
  dbSaveOmsPolicy,
} from './db/sqliteDb';
import {
  getGlobalCommandStripSummary,
  getStreamDiagnostics,
  handleSseConnection,
  startRealtimeDaemon,
  stopRealtimeDaemon,
} from './services/realtimeStreamService';
import {
  createWatchlistGroup,
  deleteMonitorRuleById,
  getAlertsStorage,
  getPublicAiConfig,
  getStoredWatchlist,
  getWatchlistGroups,
  removeStoredWatchlist,
  saveStoredAiConfig,
  upsertMonitorRule,
  upsertStoredWatchlist,
} from './services/storageService';
import {
  archiveBacktestRun,
  deleteArchivedBacktest,
  deleteWebhookChannel,
  exportBacktestCsv,
  exportBacktestMarkdown,
  listArchivedBacktests,
  listWebhookChannels,
  saveWebhookChannel,
  testWebhookChannel,
} from './services/webhookAndArchiveService';
import { APP_ROOT_DIR, clearMemoryCache } from './utils/httpCache';

const PORT = Number(process.env.PORT || 3130);
const BIND_HOST = process.env.TSP_BIND_HOST || '0.0.0.0';
const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Health & Live Data Source Diagnostics
app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    const t0 = Date.now();
    const dates = await resolveTradingDates();
    const checks: { name: string; fn: () => Promise<any> }[] = [
      { name: '腾讯指数行情', fn: () => fetchIndices() },
      { name: '东财全A股快照', fn: () => fetchAllAShareSnapshots() },
      { name: '东财涨停池', fn: () => fetchZTPool(dates.latestCompact) },
      { name: '东财概念板块', fn: () => fetchConceptBoards() },
      { name: '东财行业板块', fn: () => fetchIndustryBoards() },
      { name: '东财盘中异动', fn: () => fetchStockChanges(10) },
      { name: '交易日历解析', fn: async () => dates.latestDate },
    ];

    const dataSources: DataSourceStatus[] = await Promise.all(
      checks.map(async (c) => {
        const s = Date.now();
        try {
          const out = await c.fn();
          const ok = Array.isArray(out) ? out.length > 0 : Boolean(out);
          return {
            name: c.name,
            ok,
            latencyMs: Date.now() - s,
            detail: Array.isArray(out) ? `${out.length}条` : String(out),
          };
        } catch (err: any) {
          return {
            name: c.name,
            ok: false,
            latencyMs: Date.now() - s,
            detail: err?.message || 'error',
          };
        }
      })
    );

    const indices = await fetchIndices().catch(() => []);
    const healthyCount = dataSources.filter((d) => d.ok).length;
    const aiCfg = getPublicAiConfig();

    res.json({
      ok: true,
      version: 'v1.2.1-enterprise',
      tradingDate: dates.latestDate,
      isMarketOpen: dates.isMarketOpen,
      serverTime: new Date().toISOString().replace('T', ' ').slice(0, 19),
      elapsedMs: Date.now() - t0,
      healthyCount,
      totalCount: dataSources.length,
      dataSources,
      activeModel: aiCfg.model || 'deepseek-flash',
      indices,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Health check failed' });
  }
});

app.post('/api/cache/clear', (_req: Request, res: Response) => {
  clearMemoryCache();
  res.json({ ok: true });
});

app.get('/api/dashboard', async (req: Request, res: Response) => {
  try {
    const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : undefined;
    const data = await getDashboardData(date);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Dashboard failed' });
  }
});

app.get('/api/ladder', async (req: Request, res: Response) => {
  try {
    const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : undefined;
    const pool = (typeof req.query.pool === 'string' ? req.query.pool : 'zt') as LadderPool;
    const board = (typeof req.query.board === 'string' ? req.query.board : 'all') as BoardFilter;
    const data = await getLadderData({ date, pool, board });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Ladder failed' });
  }
});

app.get('/api/market-env', async (req: Request, res: Response) => {
  try {
    const r = req.query.range;
    const range = r === '2y' || r === 'all' ? r : '1y';
    const data = await getMarketEnvData(range);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Market env failed' });
  }
});

app.get('/api/concepts', async (_req: Request, res: Response) => {
  try {
    const data = await getConceptsData();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Concepts failed' });
  }
});

app.get('/api/industries', async (_req: Request, res: Response) => {
  try {
    const data = await getIndustriesData();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Industries failed' });
  }
});

app.get('/api/industries/:code/detail', async (req: Request, res: Response) => {
  try {
    const data = await getIndustryDetail(req.params.code);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Industry detail failed' });
  }
});

app.get('/api/stock/search', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const data = await searchStocks(q);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Stock search failed' });
  }
});

app.get('/api/stock/:code', async (req: Request, res: Response) => {
  try {
    const days = Number(req.query.days || 120);
    const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : undefined;
    const data = await getStockDetail(req.params.code, days, date);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Stock detail failed' });
  }
});

app.get('/api/watchlist/groups', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    res.json({ groups: getWatchlistGroups(user.id) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Watchlist groups failed' });
  }
});

app.post('/api/watchlist/groups', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const name = String(req.body?.name || '').trim();
    if (!name) {
      res.status(400).json({ error: 'Missing group name' });
      return;
    }
    res.json({ groups: createWatchlistGroup(name, user.id) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Watchlist group create failed' });
  }
});

app.get('/api/watchlist', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const group = typeof req.query.group === 'string' && req.query.group ? req.query.group : undefined;
    const list = getStoredWatchlist(user.id, group);
    const hydrated = await getWatchlistWithQuotes(list);
    res.json(hydrated);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Watchlist get failed' });
  }
});

app.post('/api/watchlist', async (req: Request, res: Response) => {
  try {
    if (!req.body?.code) {
      res.status(400).json({ error: 'Missing stock code' });
      return;
    }
    const user = resolveTenantUser(req);
    const list = upsertStoredWatchlist(req.body, user.id);
    const hydrated = await getWatchlistWithQuotes(list);
    res.json(hydrated);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Watchlist save failed' });
  }
});

app.delete('/api/watchlist/:code', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const list = removeStoredWatchlist(req.params.code, user.id);
    const hydrated = await getWatchlistWithQuotes(list);
    res.json(hydrated);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Watchlist delete failed' });
  }
});

app.post('/api/screener/run', async (req: Request, res: Response) => {
  try {
    const data = await runScreener(req.body || {});
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Screener failed' });
  }
});

app.post('/api/backtest/run', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const data = await runBacktest(req.body || {});
    try {
      archiveBacktestRun({
        userId: user.id,
        engineType: 'ashare_t1',
        symbol: data.code,
        symbolName: data.name || data.code,
        strategyName: data.strategy,
        totalReturnPct: Number(data.metrics.totalReturnPct ?? 0),
        excessReturnPct: Number((data.metrics.totalReturnPct - data.metrics.benchmarkReturnPct).toFixed(2)),
        annualReturnPct: Number(data.metrics.annualReturnPct ?? 0),
        sharpe: Number(data.metrics.sharpe ?? 0),
        maxDrawdownPct: Number(data.metrics.maxDrawdownPct ?? 0),
        winRatePct: Number(data.metrics.winRatePct ?? 0),
        tradeCount: Number(data.metrics.totalTrades ?? data.trades.length),
        paramsSummary: `${Number(req.body?.days || 180)}日 · T+1 · 胜率${data.metrics.winRatePct}%`,
        payload: { metrics: data.metrics, trades: data.trades },
      });
    } catch {
      // non-fatal archive write
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Backtest failed' });
  }
});

app.get('/api/monitor/anomalies', async (_req: Request, res: Response) => {
  try {
    const data = await getMonitorAnomalies();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Anomalies failed' });
  }
});

app.get('/api/monitor/rules', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const data =
      user.id === 'u_desk_admin'
        ? await evaluateMonitorRules()
        : getAlertsStorage(user.id);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Monitor rules failed' });
  }
});

app.post('/api/monitor/rules', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    upsertMonitorRule(req.body || {}, user.id);
    const data =
      user.id === 'u_desk_admin'
        ? await evaluateMonitorRules()
        : getAlertsStorage(user.id);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Save rule failed' });
  }
});

app.delete('/api/monitor/rules/:id', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const data = deleteMonitorRuleById(req.params.id, user.id);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Delete rule failed' });
  }
});

app.get('/api/ai/config', (_req: Request, res: Response) => {
  res.json(getPublicAiConfig());
});

app.post('/api/ai/config', (req: Request, res: Response) => {
  saveStoredAiConfig(req.body || {});
  res.json(getPublicAiConfig());
});

app.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const data = await chatWithAi(messages, req.body?.context);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'AI chat failed' });
  }
});

// ================= PandaAI × Polymarket × 期货跨市策略中枢 =================

app.get('/api/panda-pm/overview', async (_req: Request, res: Response) => {
  try {
    const data = await getPandaPmOverview();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'PandaPM overview failed' });
  }
});

app.post('/api/panda-pm/factor-scan', async (req: Request, res: Response) => {
  try {
    const data = await scanWithPandaFactor(req.body || {});
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'PandaPM factor scan failed' });
  }
});

app.get('/api/panda-pm/futures/:symbol/klines', async (req: Request, res: Response) => {
  try {
    const days = Number(req.query.days || 180);
    const data = await fetchFuturesKLines(req.params.symbol, days);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Futures klines failed' });
  }
});

app.post('/api/panda-pm/futures-backtest', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const data = await runFuturesBacktest(req.body || {});
    try {
      archiveBacktestRun({
        userId: user.id,
        engineType: 'futures_t0',
        symbol: data.symbol || String(req.body?.symbol || 'AU0'),
        symbolName: data.name || data.symbol || '国内期货',
        strategyName: String(req.body?.strategy || '期货T+0策略'),
        totalReturnPct: Number(data.metrics.totalReturnPct ?? 0),
        excessReturnPct: Number(data.metrics.totalReturnPct ?? 0),
        annualReturnPct: Number(data.metrics.annualReturnPct ?? 0),
        sharpe: Number(data.metrics.sharpe ?? 0),
        maxDrawdownPct: Number(data.metrics.maxDrawdownPct ?? 0),
        winRatePct: Number(data.metrics.winRatePct ?? 0),
        tradeCount: Number(data.metrics.tradeCount ?? data.trades.length),
        paramsSummary: `杠杆${req.body?.leverage ?? 3}x · T+0双向`,
        payload: { metrics: data.metrics, trades: data.trades },
      });
    } catch {
      // non-fatal
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Futures backtest failed' });
  }
});

app.get('/api/panda-pm/relation-matrix', async (req: Request, res: Response) => {
  try {
    const rawUni = typeof req.query.universe === 'string' ? req.query.universe : 'all';
    const universe =
      rawUni === 'futures' || rawUni === 'ashare_stock' || rawUni === 'sector'
        ? rawUni
        : 'all';
    const data = await getPmRelationMatrix(universe);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'PM relation matrix failed' });
  }
});

app.post('/api/panda-pm/discover-relations', async (req: Request, res: Response) => {
  try {
    const data = await discoverPmRelations(req.body || {});
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Discover PM relations failed' });
  }
});

app.post('/api/panda-pm/event-backtest', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const data = await runPmEventBacktest(req.body || {});
    try {
      archiveBacktestRun({
        userId: user.id,
        engineType: 'pm_event',
        symbol: data.assetSymbol,
        symbolName: data.assetName,
        strategyName: `${data.signalMode} (${data.eventTitle.slice(0, 24)})`,
        totalReturnPct: Number(data.metrics.totalReturnPct ?? 0),
        excessReturnPct: Number(data.metrics.excessReturnPct ?? 0),
        annualReturnPct: Number(data.metrics.annualReturnPct ?? 0),
        sharpe: Number(data.metrics.sharpe ?? 0),
        maxDrawdownPct: Number(data.metrics.maxDrawdownPct ?? 0),
        winRatePct: Number(data.metrics.winRatePct ?? 0),
        tradeCount: Number(data.metrics.tradeCount ?? data.trades.length),
        paramsSummary: `PM事件 ${data.eventId} · Lag ${data.relationSummary.optimalLagDays}D`,
        payload: { metrics: data.metrics, trades: data.trades },
      });
    } catch {
      // non-fatal
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'PM event backtest failed' });
  }
});

// V5: CPO 5-Node Bayesian Gated Transmission DAG
app.get('/api/cpo-dag/overview', async (_req: Request, res: Response) => {
  try {
    const data = await getCpoTransmissionOverview();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'CPO DAG overview failed' });
  }
});

app.post('/api/cpo-dag/backtest', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const data = await runCpoTransmissionBacktest(req.body || {});
    try {
      archiveBacktestRun({
        userId: user.id,
        engineType: 'cpo_dag',
        symbol: data.targetSymbol,
        symbolName: data.targetName,
        strategyName: 'CPO五节点门控贝叶斯传导',
        totalReturnPct: Number(data.gatedMetrics.totalReturnPct ?? 0),
        excessReturnPct: Number((data.gatedMetrics.totalReturnPct - data.benchmarkReturnPct).toFixed(2)),
        annualReturnPct: Number(data.gatedMetrics.annualReturnPct ?? 0),
        sharpe: Number(data.gatedMetrics.sharpe ?? 0),
        maxDrawdownPct: Number(data.gatedMetrics.maxDrawdownPct ?? 0),
        winRatePct: Number(data.gatedMetrics.winRatePct ?? 0),
        tradeCount: Number(data.gatedMetrics.tradeCount ?? data.trades.length),
        paramsSummary: `门控vs线性追高(${data.naiveMetrics.totalReturnPct}%) · Kelly=${data.gatedMetrics.kellySuggestedPct}%`,
        payload: { metrics: data.gatedMetrics, trades: data.trades },
      });
    } catch {
      // non-fatal
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'CPO DAG backtest failed' });
  }
});

// V5: Cross-Venue Alt-Consensus Radar & Collector
app.get('/api/consensus/overview', async (_req: Request, res: Response) => {
  try {
    const data = await getAltConsensusOverview();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Alt-consensus overview failed' });
  }
});

app.post('/api/consensus/capture-snapshot', async (_req: Request, res: Response) => {
  try {
    const data = await captureConsensusSnapshot();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Consensus snapshot capture failed' });
  }
});

app.post('/api/consensus/collector-config', async (req: Request, res: Response) => {
  try {
    const data = saveCollectorConfig(req.body || {});
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Save collector config failed' });
  }
});

app.post('/api/consensus/backtest', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const data = await runAltConsensusBacktest(req.body || {});
    try {
      archiveBacktestRun({
        userId: user.id,
        engineType: 'alt_consensus',
        symbol: data.assetSymbol,
        symbolName: data.assetName,
        strategyName: data.sourceLabel,
        totalReturnPct: Number(data.metrics.totalReturnPct ?? 0),
        excessReturnPct: Number(data.metrics.excessReturnPct ?? 0),
        annualReturnPct: Number(data.metrics.annualReturnPct ?? 0),
        sharpe: Number(data.metrics.sharpe ?? 0),
        maxDrawdownPct: Number(data.metrics.maxDrawdownPct ?? 0),
        winRatePct: Number(data.metrics.winRatePct ?? 0),
        tradeCount: Number(data.metrics.tradeCount ?? data.trades.length),
        paramsSummary: `${data.sourceType} · Lag ${data.optimalLagDays}D · Hit ${data.shockHitRate}%`,
        payload: { metrics: data.metrics, trades: data.trades },
      });
    } catch {
      // non-fatal
    }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Alt-consensus backtest failed' });
  }
});

// ================= V6–V8 (v1.2.1-enterprise) 多租户SaaS · 机构OMS实盘交易柜台 · SQLite归档 · Webhook · SSE流 =================

app.get('/api/saas/diagnostics', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    res.json(getSqliteDiagnostics(user, getStreamDiagnostics()));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'SaaS diagnostics failed' });
  }
});

app.post('/api/saas/login', (req: Request, res: Response) => {
  try {
    res.json(loginSaasUser(req.body || {}));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Login failed' });
  }
});

app.post('/api/saas/register', (req: Request, res: Response) => {
  try {
    res.json(registerSaasUser(req.body || {}));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Registration failed' });
  }
});

app.post('/api/saas/switch-seat', (req: Request, res: Response) => {
  try {
    const target = String(req.body?.userId || req.body?.username || '').trim();
    if (!target) {
      res.status(400).json({ error: 'Missing userId or username' });
      return;
    }
    res.json(switchDemoSeat(target));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Switch seat failed' });
  }
});

app.post('/api/saas/api-keys', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const name = String(req.body?.name || '量化终端密钥').trim();
    res.json(createApiKey(user.id, name));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Create API key failed' });
  }
});

app.delete('/api/saas/api-keys/:id', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    revokeApiKey(user.id, req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Revoke API key failed' });
  }
});

// Institutional OMS Execution Desk (A-Share T+1 & Domestic Futures T+0)
app.get('/api/paper/overview', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const pfId = typeof req.query.portfolioId === 'string' && req.query.portfolioId ? req.query.portfolioId : undefined;
    const data = await getPaperDeskOverview(user.id, pfId);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'OMS desk overview failed' });
  }
});

app.get('/api/paper/quote-preview', async (req: Request, res: Response) => {
  try {
    const symbol = String(req.query.symbol || '').trim();
    const market =
      req.query.market === 'ashare' || req.query.market === 'futures'
        ? req.query.market
        : undefined;
    if (!symbol) {
      res.status(400).json({ error: 'Missing symbol query parameter' });
      return;
    }
    const preview = await getOmsQuotePreview(symbol, market);
    res.json(preview);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'OMS quote preview failed' });
  }
});

app.get('/api/paper/policy', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    res.json(dbGetOmsPolicy(user.id));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Load OMS policy failed' });
  }
});

app.post('/api/paper/policy', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    res.json(dbSaveOmsPolicy(user.id, req.body || {}));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Save OMS policy failed' });
  }
});

app.post('/api/paper/portfolios', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const data = await createPaperPortfolio(user.id, {
      name: String(req.body?.name || '新建策略实盘专户'),
      initialCapital: Number(req.body?.initialCapital || 1_000_000),
    });
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Create portfolio failed' });
  }
});

app.post('/api/paper/portfolios/:id/reset', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const data = await resetPaperPortfolio(user.id, req.params.id);
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Reset portfolio failed' });
  }
});

app.post('/api/paper/order', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const data = await placePaperOrder(user.id, req.body || {});
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'OMS order failed' });
  }
});

app.post('/api/paper/positions/:id/close', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const ratio = req.body?.ratio !== undefined ? Number(req.body.ratio) : 1;
    const pfId = typeof req.body?.portfolioId === 'string' ? req.body.portfolioId : undefined;
    const data = await closePaperPosition(user.id, req.params.id, pfId, ratio);
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Close position failed' });
  }
});

app.patch('/api/paper/positions/:id/stops', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const data = await updatePositionStops(user.id, req.params.id, req.body || {});
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Update position stops failed' });
  }
});

app.get('/api/paper/export.csv', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const pfId = typeof req.query.portfolioId === 'string' && req.query.portfolioId ? req.query.portfolioId : undefined;
    const csv = exportPaperOrdersCsv(user.id, pfId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tsp_oms_orders.csv"');
    res.send(csv.startsWith('\uFEFF') ? csv : `\uFEFF${csv}`);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Export OMS orders CSV failed' });
  }
});

// SQLite Backtest Archive & Export
app.get('/api/archive/backtests', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const engineType = typeof req.query.engineType === 'string' ? req.query.engineType : undefined;
    res.json(listArchivedBacktests(user.id, engineType));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'List archived backtests failed' });
  }
});

app.delete('/api/archive/backtests/:id', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    res.json(deleteArchivedBacktest(user.id, req.params.id));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Delete archived backtest failed' });
  }
});

app.get('/api/archive/backtests/:id/export.md', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const out = exportBacktestMarkdown(user.id, req.params.id);
    if (!out) {
      res.status(404).json({ error: 'Archived backtest not found' });
      return;
    }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(out.filename)}"`);
    res.send(out.content);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Export markdown failed' });
  }
});

app.get('/api/archive/backtests/:id/export.csv', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const out = exportBacktestCsv(user.id, req.params.id);
    if (!out) {
      res.status(404).json({ error: 'Archived backtest not found' });
      return;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(out.filename)}"`);
    res.send(out.content.startsWith('\uFEFF') ? out.content : `\uFEFF${out.content}`);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Export CSV failed' });
  }
});

// Webhook Alert Gateway
app.get('/api/webhooks', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    res.json(listWebhookChannels(user.id));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'List webhooks failed' });
  }
});

app.post('/api/webhooks', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    res.json(saveWebhookChannel(user.id, req.body || {}));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Save webhook failed' });
  }
});

app.delete('/api/webhooks/:id', (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    res.json(deleteWebhookChannel(user.id, req.params.id));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Delete webhook failed' });
  }
});

app.post('/api/webhooks/:id/test', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const result = await testWebhookChannel(user.id, req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Test webhook failed' });
  }
});

// Real-Time SSE Event Stream & Global Alpha Command Strip
app.get('/api/stream/events', (req: Request, res: Response) => {
  const user = resolveTenantUser(req);
  handleSseConnection(req, res, user.id);
});

app.get('/api/stream/command-strip', async (_req: Request, res: Response) => {
  try {
    const summary = await getGlobalCommandStripSummary();
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to compute command strip' });
  }
});

// ================= V7 (v1.2.1-enterprise) 多标的专属事实因子确定性买点 & 付鹏24h宏观FICC框架 =================

app.get('/api/fact-buypoint/overview', async (_req: Request, res: Response) => {
  try {
    const data = await getFactBuyPointOverview();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Fact buy-point overview failed' });
  }
});

app.get('/api/fact-buypoint/asset/:symbol', async (req: Request, res: Response) => {
  try {
    const days = Number(req.query.days || 180);
    const data = await getAssetFactDetail(req.params.symbol, days);
    res.json(data);
  } catch (err: any) {
    res.status(404).json({ error: err?.message || 'Fact buy-point asset detail failed' });
  }
});

app.post('/api/fact-buypoint/backtest', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const data = await runFactBuyPointBacktest(req.body || {});
    try {
      archiveBacktestRun({
        userId: user.id,
        engineType: 'fact_buypoint',
        symbol: data.symbol,
        symbolName: data.name,
        strategyName: '四维确定性买点复盘回测',
        totalReturnPct: Number(data.deterministicMetrics.totalReturnPct ?? 0),
        excessReturnPct: Number((data.deterministicMetrics.totalReturnPct - data.rawMetrics.totalReturnPct).toFixed(2)),
        annualReturnPct: Number(data.deterministicMetrics.annualReturnPct ?? 0),
        sharpe: Number(data.deterministicMetrics.sharpe ?? 0),
        maxDrawdownPct: Number(data.deterministicMetrics.maxDrawdownPct ?? 0),
        winRatePct: Number(data.deterministicMetrics.winRatePct ?? 0),
        tradeCount: Number(data.deterministicMetrics.tradeCount ?? 0),
        paramsSummary: `确定买点(${data.deterministicMetrics.winRatePct}%) vs 粗糙(${data.rawMetrics.winRatePct}%)`,
        payload: {
          metrics: data.deterministicMetrics,
          rawMetrics: data.rawMetrics,
          trades: data.episodes,
        },
      });
    } catch {
      // non-fatal
    }
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Fact buy-point backtest failed' });
  }
});

app.get('/api/fupeng/overview', async (_req: Request, res: Response) => {
  try {
    const data = await getFupengFrameworkOverview();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Fu Peng overview failed' });
  }
});

app.post('/api/fupeng/scrape-now', async (_req: Request, res: Response) => {
  try {
    const scrapeRes = await scrapeFupengLatestIntel();
    const overview = await getFupengFrameworkOverview();
    res.json({
      ok: scrapeRes.ok,
      newlyAdded: scrapeRes.newlyAdded,
      totalCount: scrapeRes.totalCount,
      overview,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Fu Peng scrape failed' });
  }
});

app.post('/api/fupeng/ingest-note', async (req: Request, res: Response) => {
  try {
    const title = String(req.body?.title || '').trim();
    const content = String(req.body?.content || '').trim();
    if (!title && !content) {
      res.status(400).json({ error: 'Missing title or content' });
      return;
    }
    const data = await ingestCustomFupengNote({
      title: title || '付鹏宏观纪要即时解析',
      content: content || title,
      sourceUrl: typeof req.body?.sourceUrl === 'string' ? req.body.sourceUrl : undefined,
    });
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Fu Peng ingest note failed' });
  }
});

app.post('/api/fupeng/backtest', async (req: Request, res: Response) => {
  try {
    const user = resolveTenantUser(req);
    const data = await runFupengBarbellBacktest(req.body || {});
    try {
      archiveBacktestRun({
        userId: user.id,
        engineType: 'fupeng_barbell',
        symbol: 'FICC_BARBELL',
        symbolName: '付鹏动态杠铃宏观组合',
        strategyName: '付鹏全球宏观FICC动态杠铃',
        totalReturnPct: Number(data.barbellMetrics.totalReturnPct ?? 0),
        excessReturnPct: Number(data.barbellMetrics.excessVsHs300Pct ?? 0),
        annualReturnPct: Number(data.barbellMetrics.annualReturnPct ?? 0),
        sharpe: Number(data.barbellMetrics.sharpe ?? 0),
        maxDrawdownPct: Number(data.barbellMetrics.maxDrawdownPct ?? 0),
        winRatePct: Number(data.barbellMetrics.winRateMonthsPct ?? 0),
        tradeCount: Number(data.deleverageEventsCount ?? data.rebalanceLogs.length),
        paramsSummary: `${Number(req.body?.days || 180)}日 · 去杠杆${data.deleverageEventsCount}次 · 胜率${data.barbellMetrics.winRateMonthsPct}%`,
        payload: {
          metrics: data.barbellMetrics,
          staticEqualMetrics: data.staticEqualMetrics,
          trades: data.rebalanceLogs,
        },
      });
    } catch {
      // non-fatal
    }
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Fu Peng barbell backtest failed' });
  }
});

// Production static files (dist/)
const distDir = process.env.TSP_DIST_DIR
  ? path.resolve(process.env.TSP_DIST_DIR)
  : path.resolve(APP_ROOT_DIR, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req: Request, res: Response, next) => {
    if (req.path.startsWith('/api/')) return next();
    const indexHtml = path.join(distDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.sendFile(indexHtml);
    } else {
      next();
    }
  });
}

export function startTspServer(port = PORT) {
  const server = app.listen(port, BIND_HOST, () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : port;
    startRealtimeDaemon();
    console.log(`[TSP-Pro Server] Listening on http://127.0.0.1:${actualPort}`);
  });

  const shutdown = () => {
    try {
      stopRealtimeDaemon();
    } catch {
      // ignore
    }
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return server;
}

if (process.env.TSP_NO_AUTOSTART !== '1') {
  startTspServer(PORT);
}
