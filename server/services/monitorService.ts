import type { AlertTriggerEvent, MonitorAnomaliesResponse, MonitorRulesResponse } from '../../src/types/market';
import {
  fetchAllAShareSnapshots,
  fetchStockChanges,
  fetchZBPool,
} from '../providers/eastmoney';
import { resolveTradingDates } from '../providers/tencent';
import { cleanCode, getBeijingTimeInfo } from '../utils/marketHelpers';
import { getAlertsStorage, saveAlertsStorage } from './storageService';

export async function getMonitorAnomalies(): Promise<MonitorAnomaliesResponse> {
  const anomalies = await fetchStockChanges(80).catch(() => []);
  return {
    updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    anomalies,
  };
}

export async function evaluateMonitorRules(): Promise<MonitorRulesResponse> {
  const store = getAlertsStorage();
  const enabledRules = store.rules.filter((r) => r.enabled);
  if (enabledRules.length === 0) {
    return store;
  }

  const dates = await resolveTradingDates();
  const [snapshots, zbPool] = await Promise.all([
    fetchAllAShareSnapshots().catch(() => []),
    fetchZBPool(dates.latestCompact).catch(() => []),
  ]);

  const zbCodes = new Set(zbPool.map((z) => cleanCode(z.c)));
  const bj = getBeijingTimeInfo();
  const nowTime = bj.timeStr;

  const newEvents: AlertTriggerEvent[] = [];
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
        msg = `涨幅 ${s.changePct.toFixed(2)}% ≥ ${rule.threshold}% (现价 ${s.price.toFixed(2)})`;
      } else if (rule.metric === 'priceAbove' && s.price >= rule.threshold) {
        triggered = true;
        msg = `现价 ${s.price.toFixed(2)} 突破 ${rule.threshold}`;
      } else if (rule.metric === 'priceBelow' && s.price > 0 && s.price <= rule.threshold) {
        triggered = true;
        msg = `现价 ${s.price.toFixed(2)} 跌破 ${rule.threshold}`;
      } else if (rule.metric === 'volumeRatio' && s.volumeRatio >= rule.threshold) {
        triggered = true;
        msg = `量比 ${s.volumeRatio.toFixed(2)}x ≥ ${rule.threshold}x (涨幅 ${s.changePct.toFixed(2)}%)`;
      } else if (rule.metric === 'brokenBoard' && zbCodes.has(cleanCode(s.code))) {
        triggered = true;
        msg = `触发炸板预警，当前涨幅 ${s.changePct.toFixed(2)}%`;
      }

      if (triggered) {
        hits++;
        const eventId = `${rule.id}-${s.code}-${dates.latestCompact}`;
        if (!store.events.some((e) => e.id === eventId)) {
          newEvents.push({
            id: eventId,
            time: `${dates.latestDate} ${nowTime}`,
            ruleId: rule.id,
            ruleName: rule.name,
            code: s.code,
            name: s.name,
            message: msg,
            level: rule.metric === 'brokenBoard' || rule.metric === 'priceBelow' ? 'warn' : 'critical',
          });
        }
      }
    }
  }

  if (newEvents.length > 0) {
    store.events = [...newEvents, ...store.events].slice(0, 50);
    saveAlertsStorage(store);
  }
  return store;
}
