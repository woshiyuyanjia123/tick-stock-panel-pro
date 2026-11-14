import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import type {
  AlertTriggerEvent,
  CpoTransmissionOverviewResponse,
  IndexQuote,
  RealtimePulsePayload,
  SaasSystemDiagnostics,
  StreamJobStat,
} from '../../src/types/market';
import {
  dbAppendAlertEvent,
  dbGetAlerts,
  dbInsertConsensusSnapshot,
  getDb,
} from '../db/sqliteDb';
import {
  fetchAllAShareSnapshots,
  fetchDTPool,
  fetchZBPool,
  fetchZTPool,
} from '../providers/eastmoney';
import { fetchIndices, resolveTradingDates } from '../providers/tencent';
import { cleanCode, getBeijingTimeInfo } from '../utils/marketHelpers';
import { captureConsensusSnapshot } from './altConsensusService';
import { getCpoTransmissionOverview } from './cpoTransmissionService';
import { getActivePortfolioQuickSummary } from './paperTradingService';
import { dispatchAlertToWebhooks } from './webhookAndArchiveService';

export type ServerSseEventType = 'connected' | 'pulse' | 'alert' | 'cpo_gate' | 'job_tick' | string;

interface SseClient {
  id: string;
  tenantUserId: string;
  res: Response;
  connectedAt: string;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

interface CpoStateSnapshot {
  regime: string;
  gatesKey: string;
  trapsKey: string;
}

const clients = new Map<string, SseClient>();
const startedAtMs = Date.now();
let daemonStarted = false;
let totalFramesPushed = 0;

let pulseTimer: ReturnType<typeof setInterval> | null = null;
let alertWatchTimer: ReturnType<typeof setInterval> | null = null;
let consensusTimer: ReturnType<typeof setInterval> | null = null;
let fupengTimer: ReturnType<typeof setInterval> | null = null;
let pulseWarmupTimer: ReturnType<typeof setTimeout> | null = null;
let alertWarmupTimer: ReturnType<typeof setTimeout> | null = null;
let consensusWarmupTimer: ReturnType<typeof setTimeout> | null = null;
let fupengWarmupTimer: ReturnType<typeof setTimeout> | null = null;

let pulseInFlight = false;
let alertWatchInFlight = false;
let consensusInFlight = false;
let fupengInFlight = false;

let latestBasePulse: RealtimePulsePayload | null = null;
let lastCpoState: CpoStateSnapshot | null = null;
const knownAlertIds = new Set<string>();
let alertIdsHydrated = false;

const jobs: Record<
  'market_pulse' | 'alert_and_cpo_watch' | 'consensus_auto_snapshot' | 'fupeng_24h_watch',
  StreamJobStat
> = {
  market_pulse: {
    name: 'market_pulse',
    intervalSec: 8,
    lastRunAt: null,
    runCount: 0,
    status: 'idle',
    lastDetail: '等待首次行情脉搏扫描',
  },
  alert_and_cpo_watch: {
    name: 'alert_and_cpo_watch',
    intervalSec: 35,
    lastRunAt: null,
    runCount: 0,
    status: 'idle',
    lastDetail: '等待首次风控与CPO门控巡检',
  },
  consensus_auto_snapshot: {
    name: 'consensus_auto_snapshot',
    intervalSec: 900,
    lastRunAt: null,
    runCount: 0,
    status: 'idle',
    lastDetail: '每15分钟自动捕获跨所认知快照落库',
  },
  fupeng_24h_watch: {
    name: 'fupeng_24h_watch',
    intervalSec: 600,
    lastRunAt: null,
    runCount: 0,
    status: 'idle',
    lastDetail: '每10分钟全网抓取付鹏24h最新动态并映射FICC标的',
  },
};

function nowBjStr(): string {
  const bj = getBeijingTimeInfo();
  return `${bj.dateStr} ${bj.timeStr}`;
}

function hydrateKnownAlertIds(): void {
  if (alertIdsHydrated) return;
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT id FROM alert_events ORDER BY rowid DESC LIMIT 500`).all() as { id: string }[];
    for (const r of rows) {
      if (r.id) knownAlertIds.add(String(r.id));
    }
    alertIdsHydrated = true;
  } catch {
    // ignore if db not ready yet
  }
}

function removeClient(clientId: string): void {
  const client = clients.get(clientId);
  if (!client) return;
  clearInterval(client.heartbeatTimer);
  clients.delete(clientId);
}

function writeSseFrame(client: SseClient, eventName: string, data: unknown): boolean {
  if (client.res.writableEnded || client.res.destroyed) {
    removeClient(client.id);
    return false;
  }
  try {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    client.res.write(payload);
    totalFramesPushed++;
    return true;
  } catch {
    removeClient(client.id);
    return false;
  }
}

function buildTenantPulse(base: RealtimePulsePayload, tenantUserId: string): RealtimePulsePayload {
  const summary = getActivePortfolioQuickSummary(tenantUserId) || base.paperSummary;
  return {
    ...base,
    connectedClients: clients.size,
    paperSummary: summary || undefined,
  };
}

async function computeFreshPulse(): Promise<RealtimePulsePayload> {
  const [dates, indices, snapshots] = await Promise.all([
    resolveTradingDates().catch(() => ({
      latestDate: getBeijingTimeInfo().dateStr,
      latestCompact: getBeijingTimeInfo().dateStr.replace(/-/g, ''),
      isMarketOpen: false,
    })),
    fetchIndices().catch(() => [] as IndexQuote[]),
    fetchAllAShareSnapshots().catch(() => []),
  ]);

  const [ztPool, dtPool] = await Promise.all([
    fetchZTPool(dates.latestCompact).catch(() => []),
    fetchDTPool(dates.latestCompact).catch(() => []),
  ]);

  let up = 0;
  let flat = 0;
  let down = 0;
  for (const s of snapshots) {
    if (s.changePct > 0.001) up++;
    else if (s.changePct < -0.001) down++;
    else flat++;
  }

  const base: RealtimePulsePayload = {
    timestamp: nowBjStr(),
    connectedClients: clients.size,
    indices,
    breadth: snapshots.length > 0 || ztPool.length > 0 || dtPool.length > 0
      ? {
          up,
          flat,
          down,
          limitUp: ztPool.length,
          limitDown: dtPool.length,
        }
      : undefined,
    paperSummary: getActivePortfolioQuickSummary('u_desk_admin') || undefined,
  };

  latestBasePulse = base;
  return base;
}

export async function runMarketPulseJob(): Promise<void> {
  if (pulseInFlight) return;
  pulseInFlight = true;
  jobs.market_pulse.status = 'running';

  try {
    const base = await computeFreshPulse();
    jobs.market_pulse.lastRunAt = nowBjStr();
    jobs.market_pulse.runCount += 1;
    jobs.market_pulse.status = 'ok';
    jobs.market_pulse.lastDetail = `指数 ${base.indices.length} 条 | 涨${base.breadth?.up ?? 0}/跌${base.breadth?.down ?? 0} | 在线 ${clients.size}`;

    if (clients.size > 0) {
      for (const client of Array.from(clients.values())) {
        writeSseFrame(client, 'pulse', buildTenantPulse(base, client.tenantUserId));
      }
      emitServerEvent('job_tick', {
        job: 'market_pulse',
        timestamp: jobs.market_pulse.lastRunAt,
        runCount: jobs.market_pulse.runCount,
        status: 'ok',
        detail: jobs.market_pulse.lastDetail,
      });
    }
  } catch (err: any) {
    jobs.market_pulse.lastRunAt = nowBjStr();
    jobs.market_pulse.runCount += 1;
    jobs.market_pulse.status = 'error';
    jobs.market_pulse.lastDetail = err?.message || 'market_pulse failed';
  } finally {
    pulseInFlight = false;
  }
}

async function evaluateTenantRulesAndNotify(userId: string): Promise<number> {
  const store = dbGetAlerts(userId);
  const enabledRules = store.rules.filter((r) => r.enabled);
  if (enabledRules.length === 0) return 0;

  const dates = await resolveTradingDates();
  const [snapshots, zbPool] = await Promise.all([
    fetchAllAShareSnapshots().catch(() => []),
    fetchZBPool(dates.latestCompact).catch(() => []),
  ]);
  if (snapshots.length === 0) return 0;

  const zbCodes = new Set(zbPool.map((z) => cleanCode(z.c)));
  const nowTime = getBeijingTimeInfo().timeStr;
  let triggeredCount = 0;

  for (const rule of enabledRules) {
    const candidates =
      rule.code === '*'
        ? snapshots
        : snapshots.filter((s) => cleanCode(s.code) === cleanCode(rule.code));

    let hits = 0;
    for (const s of candidates) {
      if (hits >= 3) break;
      let triggered = false;
      let msg = '';

      if (rule.metric === 'changePct' && s.changePct >= rule.threshold) {
        triggered = true;
        msg = `涨幅 ${s.changePct.toFixed(2)}% >= ${rule.threshold}% (现价 ${s.price.toFixed(2)})`;
      } else if (rule.metric === 'priceAbove' && s.price >= rule.threshold) {
        triggered = true;
        msg = `现价 ${s.price.toFixed(2)} 突破 ${rule.threshold}`;
      } else if (rule.metric === 'priceBelow' && s.price > 0 && s.price <= rule.threshold) {
        triggered = true;
        msg = `现价 ${s.price.toFixed(2)} 跌破 ${rule.threshold}`;
      } else if (rule.metric === 'volumeRatio' && s.volumeRatio >= rule.threshold) {
        triggered = true;
        msg = `量比 ${s.volumeRatio.toFixed(2)}x >= ${rule.threshold}x (涨幅 ${s.changePct.toFixed(2)}%)`;
      } else if (rule.metric === 'brokenBoard' && zbCodes.has(cleanCode(s.code))) {
        triggered = true;
        msg = `触发炸板预警，当前涨幅 ${s.changePct.toFixed(2)}%`;
      }

      if (!triggered) continue;
      hits++;

      const eventId = `${rule.id}-${s.code}-${dates.latestCompact}`;
      if (knownAlertIds.has(eventId) || store.events.some((e) => e.id === eventId)) {
        knownAlertIds.add(eventId);
        continue;
      }

      const ev: AlertTriggerEvent = {
        id: eventId,
        time: `${dates.latestDate} ${nowTime}`,
        ruleId: rule.id,
        ruleName: rule.name,
        code: s.code,
        name: s.name,
        message: msg,
        level: rule.metric === 'brokenBoard' || rule.metric === 'priceBelow' ? 'warn' : 'critical',
      };

      knownAlertIds.add(eventId);
      dbAppendAlertEvent(ev, userId);
      triggeredCount++;

      emitServerEvent('alert', ev, userId);
      await dispatchAlertToWebhooks(userId, {
        eventType: 'anomaly',
        title: `[TSP Pro 实盘预警] ${ev.ruleName}`,
        message: ev.message,
        symbol: `${ev.code} ${ev.name}`,
        level: ev.level,
      }).catch(() => undefined);
    }
  }

  return triggeredCount;
}

function buildCpoStateKey(overview: CpoTransmissionOverviewResponse): CpoStateSnapshot {
  return {
    regime: overview.regime,
    gatesKey: overview.gates.map((g) => `${g.id}:${g.passed ? 1 : 0}`).join(','),
    trapsKey: overview.traps.map((t) => `${t.id}:${t.triggered ? 1 : 0}`).join(','),
  };
}

export async function runAlertAndCpoWatchJob(): Promise<void> {
  if (alertWatchInFlight) return;
  alertWatchInFlight = true;
  jobs.alert_and_cpo_watch.status = 'running';
  hydrateKnownAlertIds();

  try {
    const db = getDb();
    const tenantRows = db.prepare(`
      SELECT DISTINCT user_id FROM alert_rules WHERE enabled = 1
    `).all() as { user_id: string }[];

    const userIds = Array.from(
      new Set(['u_desk_admin', ...tenantRows.map((r) => String(r.user_id))])
    );

    let newRuleAlerts = 0;
    for (const uid of userIds) {
      newRuleAlerts += await evaluateTenantRulesAndNotify(uid).catch(() => 0);
    }

    let cpoTransitioned = false;
    let cpoRegimeText = '';
    try {
      const overview = await getCpoTransmissionOverview();
      cpoRegimeText = `${overview.regime} (P=${overview.bayesianPosteriorProb}%)`;
      const currentState = buildCpoStateKey(overview);

      if (
        lastCpoState &&
        (lastCpoState.regime !== currentState.regime ||
          lastCpoState.gatesKey !== currentState.gatesKey ||
          lastCpoState.trapsKey !== currentState.trapsKey)
      ) {
        cpoTransitioned = true;
        emitServerEvent('cpo_gate', {
          timestamp: nowBjStr(),
          regime: overview.regime,
          bayesianPosteriorProb: overview.bayesianPosteriorProb,
          kellyPositionPct: overview.kellyPositionPct,
          tmtTurnoverSharePct: overview.marketContext.tmtTurnoverSharePct,
          gates: overview.gates,
          traps: overview.traps,
        });

        const bj = getBeijingTimeInfo();
        const level: AlertTriggerEvent['level'] =
          overview.regime.includes('预警') || overview.regime.includes('空头')
            ? 'critical'
            : 'warn';

        const ev: AlertTriggerEvent = {
          id: `cpo-gate-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
          time: `${bj.dateStr} ${bj.timeStr}`,
          ruleId: 'sys-cpo-gate-watch',
          ruleName: 'CPO五节点门控状态切换',
          code: '300308',
          name: 'CPO传导中枢',
          message: `状态切换[${lastCpoState.regime} -> ${overview.regime}] · 后验概率 ${overview.bayesianPosteriorProb}% · TMT拥挤度 ${overview.marketContext.tmtTurnoverSharePct}% · 建议Kelly仓位 ${overview.kellyPositionPct}%`,
          level,
        };

        knownAlertIds.add(ev.id);
        dbAppendAlertEvent(ev, 'u_desk_admin');
        emitServerEvent('alert', ev, 'u_desk_admin');
        await dispatchAlertToWebhooks('u_desk_admin', {
          eventType: 'cpo_gate',
          title: `[TSP Pro CPO门控切换] ${overview.regime}`,
          message: ev.message,
          symbol: '300308 / 159915',
          level,
        }).catch(() => undefined);
      }

      lastCpoState = currentState;
    } catch {
      cpoRegimeText = 'CPO巡检暂不可用';
    }

    jobs.alert_and_cpo_watch.lastRunAt = nowBjStr();
    jobs.alert_and_cpo_watch.runCount += 1;
    jobs.alert_and_cpo_watch.status = 'ok';
    jobs.alert_and_cpo_watch.lastDetail = `规则新增告警 ${newRuleAlerts} 条 | CPO: ${cpoRegimeText}${cpoTransitioned ? ' [已触发切换通知]' : ''}`;

    if (clients.size > 0) {
      emitServerEvent('job_tick', {
        job: 'alert_and_cpo_watch',
        timestamp: jobs.alert_and_cpo_watch.lastRunAt,
        runCount: jobs.alert_and_cpo_watch.runCount,
        status: 'ok',
        detail: jobs.alert_and_cpo_watch.lastDetail,
      });
    }
  } catch (err: any) {
    jobs.alert_and_cpo_watch.lastRunAt = nowBjStr();
    jobs.alert_and_cpo_watch.runCount += 1;
    jobs.alert_and_cpo_watch.status = 'error';
    jobs.alert_and_cpo_watch.lastDetail = err?.message || 'alert_and_cpo_watch failed';
  } finally {
    alertWatchInFlight = false;
  }
}

export async function runConsensusAutoSnapshotJob(): Promise<void> {
  if (consensusInFlight) return;
  consensusInFlight = true;
  jobs.consensus_auto_snapshot.status = 'running';

  try {
    const result = await captureConsensusSnapshot();
    dbInsertConsensusSnapshot(result.record);

    jobs.consensus_auto_snapshot.lastRunAt = nowBjStr();
    jobs.consensus_auto_snapshot.runCount += 1;
    jobs.consensus_auto_snapshot.status = 'ok';
    jobs.consensus_auto_snapshot.lastDetail = `累计 ${result.totalSnapshots} 条 | PAXG $${result.record.paxgPrice} | TopBack ${result.record.topBackVariety}`;

    if (clients.size > 0) {
      emitServerEvent('job_tick', {
        job: 'consensus_auto_snapshot',
        timestamp: jobs.consensus_auto_snapshot.lastRunAt,
        runCount: jobs.consensus_auto_snapshot.runCount,
        status: 'ok',
        detail: jobs.consensus_auto_snapshot.lastDetail,
      });
    }
  } catch (err: any) {
    jobs.consensus_auto_snapshot.lastRunAt = nowBjStr();
    jobs.consensus_auto_snapshot.runCount += 1;
    jobs.consensus_auto_snapshot.status = 'error';
    jobs.consensus_auto_snapshot.lastDetail = err?.message || 'consensus_auto_snapshot failed';
  } finally {
    consensusInFlight = false;
  }
}

export async function runFupeng24hWatchJob(): Promise<void> {
  if (fupengInFlight) return;
  fupengInFlight = true;
  jobs.fupeng_24h_watch.status = 'running';
  hydrateKnownAlertIds();

  try {
    const { scrapeFupengLatestIntel } = await import('./fupengMacroService');
    const result = await scrapeFupengLatestIntel();

    jobs.fupeng_24h_watch.lastRunAt = nowBjStr();
    jobs.fupeng_24h_watch.runCount += 1;
    jobs.fupeng_24h_watch.status = 'ok';
    jobs.fupeng_24h_watch.lastDetail = `全网抓取完成: 新增 ${result.newlyAdded} 条 | SQLite总库 ${result.totalCount} 条`;

    if (result.newlyAdded > 0 && Array.isArray(result.newItems) && result.newItems.length > 0) {
      const topItem = result.newItems[0];
      const topTarget = topItem.mappedTargets?.[0];
      const mappedText = (topItem.mappedTargets || [])
        .slice(0, 3)
        .map((t) => `${t.symbol}(${t.direction})`)
        .join(', ');
      const eventId = `fupeng-${topItem.id}`;

      if (!knownAlertIds.has(eventId)) {
        const level: AlertTriggerEvent['level'] =
          topItem.stance.includes('警惕') || topItem.stance.includes('回避') ? 'warn' : 'info';
        const ev: AlertTriggerEvent = {
          id: eventId,
          time: nowBjStr(),
          ruleId: 'sys-fupeng-24h-watch',
          ruleName: '付鹏24h全网情报雷达',
          code: topTarget?.symbol || 'AU0',
          name: topTarget?.name || topItem.pillar,
          message: `[${topItem.sourceChannel}][${topItem.pillar}/${topItem.stance}] ${topItem.title}${mappedText ? ` -> 映射: ${mappedText}` : ''}${result.newlyAdded > 1 ? ` (本轮共新增 ${result.newlyAdded} 条)` : ''}`,
          level,
        };

        knownAlertIds.add(eventId);
        dbAppendAlertEvent(ev, 'u_desk_admin');
        emitServerEvent('alert', ev);
        await dispatchAlertToWebhooks('u_desk_admin', {
          eventType: 'pm_shock',
          title: `[TSP Pro 付鹏24h雷达] 新增 ${result.newlyAdded} 条FICC观点`,
          message: ev.message,
          symbol: mappedText || `${ev.code} ${ev.name}`,
          level,
        }).catch(() => undefined);
      }
    }

    if (clients.size > 0) {
      emitServerEvent('job_tick', {
        job: 'fupeng_24h_watch',
        timestamp: jobs.fupeng_24h_watch.lastRunAt,
        runCount: jobs.fupeng_24h_watch.runCount,
        status: 'ok',
        detail: jobs.fupeng_24h_watch.lastDetail,
      });
    }
  } catch (err: any) {
    jobs.fupeng_24h_watch.lastRunAt = nowBjStr();
    jobs.fupeng_24h_watch.runCount += 1;
    jobs.fupeng_24h_watch.status = 'error';
    jobs.fupeng_24h_watch.lastDetail = err?.message || 'fupeng_24h_watch failed';
  } finally {
    fupengInFlight = false;
  }
}

export function handleSseConnection(
  req: Request,
  res: Response,
  tenantUserId = 'u_desk_admin'
): void {
  startRealtimeDaemon();

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const streamId = `sse_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const heartbeatTimer = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      removeClient(streamId);
      return;
    }
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
    } catch {
      removeClient(streamId);
    }
  }, 20_000);
  heartbeatTimer.unref();

  const client: SseClient = {
    id: streamId,
    tenantUserId: tenantUserId || 'u_desk_admin',
    res,
    connectedAt: nowBjStr(),
    heartbeatTimer,
  };
  clients.set(streamId, client);

  const initialPulse = latestBasePulse
    ? buildTenantPulse(latestBasePulse, client.tenantUserId)
    : {
        timestamp: nowBjStr(),
        connectedClients: clients.size,
        indices: [],
        paperSummary: getActivePortfolioQuickSummary(client.tenantUserId) || undefined,
      };

  writeSseFrame(client, 'connected', {
    streamId,
    tenantUserId: client.tenantUserId,
    connectedClients: clients.size,
    jobs: getStreamDiagnostics().jobs,
    latestPulse: initialPulse,
  });

  // Immediately push a live/cached pulse frame for this client so short-lived SSE consumers receive pulse promptly
  void (async () => {
    try {
      const base = latestBasePulse || (await computeFreshPulse());
      if (!clients.has(streamId) || res.writableEnded || res.destroyed) return;
      writeSseFrame(client, 'pulse', buildTenantPulse(base, client.tenantUserId));
    } catch {
      // ignore initial async pulse error; next 8s job will push
    }
  })();

  const cleanup = () => removeClient(streamId);
  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
}

export function startRealtimeDaemon(): void {
  if (daemonStarted) return;
  daemonStarted = true;
  hydrateKnownAlertIds();

  pulseWarmupTimer = setTimeout(() => {
    void runMarketPulseJob();
  }, 1_500);
  pulseWarmupTimer.unref();

  alertWarmupTimer = setTimeout(() => {
    void runAlertAndCpoWatchJob();
  }, 5_000);
  alertWarmupTimer.unref();

  consensusWarmupTimer = setTimeout(() => {
    try {
      const db = getDb();
      const latest = db
        .prepare(`SELECT timestamp FROM consensus_snapshots_sql ORDER BY id DESC LIMIT 1`)
        .get() as { timestamp?: string } | undefined;
      const ageMs = latest?.timestamp ? Date.now() - Date.parse(latest.timestamp) : Infinity;
      if (!Number.isFinite(ageMs) || ageMs >= 900_000) {
        void runConsensusAutoSnapshotJob();
      } else {
        jobs.consensus_auto_snapshot.lastRunAt = latest?.timestamp || nowBjStr();
        jobs.consensus_auto_snapshot.status = 'ok';
        jobs.consensus_auto_snapshot.lastDetail = 'SQLite 已存在近期认知快照，等待下个15分钟周期';
      }
    } catch {
      void runConsensusAutoSnapshotJob();
    }
  }, 15_000);
  consensusWarmupTimer.unref();

  pulseTimer = setInterval(() => {
    void runMarketPulseJob();
  }, 8_000);
  pulseTimer.unref();

  alertWatchTimer = setInterval(() => {
    void runAlertAndCpoWatchJob();
  }, 35_000);
  alertWatchTimer.unref();

  consensusTimer = setInterval(() => {
    void runConsensusAutoSnapshotJob();
  }, 15 * 60 * 1000);
  consensusTimer.unref();

  fupengWarmupTimer = setTimeout(() => {
    void runFupeng24hWatchJob();
  }, 8_000);
  fupengWarmupTimer.unref();

  fupengTimer = setInterval(() => {
    void runFupeng24hWatchJob();
  }, 600_000);
  fupengTimer.unref();
}

export function stopRealtimeDaemon(): void {
  if (pulseTimer) clearInterval(pulseTimer);
  if (alertWatchTimer) clearInterval(alertWatchTimer);
  if (consensusTimer) clearInterval(consensusTimer);
  if (fupengTimer) clearInterval(fupengTimer);
  if (pulseWarmupTimer) clearTimeout(pulseWarmupTimer);
  if (alertWarmupTimer) clearTimeout(alertWarmupTimer);
  if (consensusWarmupTimer) clearTimeout(consensusWarmupTimer);
  if (fupengWarmupTimer) clearTimeout(fupengWarmupTimer);
  pulseTimer = null;
  alertWatchTimer = null;
  consensusTimer = null;
  fupengTimer = null;
  pulseWarmupTimer = null;
  alertWarmupTimer = null;
  consensusWarmupTimer = null;
  fupengWarmupTimer = null;
  daemonStarted = false;

  for (const client of Array.from(clients.values())) {
    removeClient(client.id);
    try {
      client.res.end();
    } catch {
      // ignore
    }
  }
}

export function emitServerEvent(
  type: ServerSseEventType,
  payload: unknown,
  targetUserId?: string
): number {
  let delivered = 0;
  for (const client of Array.from(clients.values())) {
    if (targetUserId && client.tenantUserId !== targetUserId) continue;
    if (writeSseFrame(client, type, payload)) {
      delivered++;
    }
  }
  return delivered;
}

export function getStreamDiagnostics(): SaasSystemDiagnostics['stream'] {
  return {
    connectedClients: clients.size,
    totalFramesPushed,
    uptimeSec: Math.max(0, Math.round((Date.now() - startedAtMs) / 1000)),
    jobs: [
      { ...jobs.market_pulse },
      { ...jobs.alert_and_cpo_watch },
      { ...jobs.consensus_auto_snapshot },
      { ...jobs.fupeng_24h_watch },
    ],
  };
}
