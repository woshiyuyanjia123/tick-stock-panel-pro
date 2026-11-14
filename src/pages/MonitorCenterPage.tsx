import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatPct } from '../api/client';
import type {
  AlertTriggerEvent,
  AnomalyItem,
  MonitorRule,
  MonitorRulesResponse,
} from '../types/market';

interface MonitorCenterPageProps {
  onSelectStock: (code: string, name?: string, date?: string) => void;
  initialTab?: 'monitor' | 'anomaly';
}

function upDownCls(val?: number | null): string {
  if (val === undefined || val === null || val === 0) return 'text-[#8b949e]';
  return val > 0 ? 'text-[#ff3535]' : 'text-[#00c853]';
}

const METRIC_LABELS: Record<MonitorRule['metric'], string> = {
  changePct: '盘中涨幅 >= (%)',
  priceAbove: '突破价格 >= (元)',
  priceBelow: '跌破止损 <= (元)',
  volumeRatio: '量比突增 >= (倍)',
  brokenBoard: '涨停炸板告警 (次)',
};

const ANOMALY_TYPES = [
  '全部类型',
  '火箭发射',
  '大笔买入',
  '封涨停板',
  '打开涨停',
  '快速反弹',
  '高台跳水',
  '大笔卖出',
];

function playAlertBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    // ignore
  }
}

export default function MonitorCenterPage({
  onSelectStock,
  initialTab = 'monitor',
}: MonitorCenterPageProps) {
  const [activeTab, setActiveTab] = useState<'monitor' | 'anomaly'>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const [rulesData, setRulesData] = useState<MonitorRulesResponse>({ rules: [], events: [] });
  const [loadingRules, setLoadingRules] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);

  const [pollIntervalSec, setPollIntervalSec] = useState<0 | 15 | 30>(15);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [toastEnabled, setToastEnabled] = useState(true);
  const [toastAlert, setToastAlert] = useState<AlertTriggerEvent | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());

  const [ruleName, setRuleName] = useState('');
  const [ruleCode, setRuleCode] = useState('*');
  const [ruleMetric, setRuleMetric] = useState<MonitorRule['metric']>('changePct');
  const [ruleThreshold, setRuleThreshold] = useState<string>('5');
  const [savingRule, setSavingRule] = useState(false);

  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [anomalyUpdatedAt, setAnomalyUpdatedAt] = useState('');
  const [loadingAnomaly, setLoadingAnomaly] = useState(true);
  const [anomalyError, setAnomalyError] = useState<string | null>(null);
  const [directionFilter, setDirectionFilter] = useState<'all' | 'bull' | 'bear'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('全部类型');
  const [anomalySearch, setAnomalySearch] = useState('');

  const loadRules = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingRules(true);
      setRulesError(null);
      try {
        const res = await api.getMonitorRules();
        const incomingEvents = res.events || [];
        if (seenEventIdsRef.current.size > 0) {
          const fresh = incomingEvents.find((ev) => !seenEventIdsRef.current.has(ev.id));
          if (fresh) {
            if (soundEnabled) playAlertBeep();
            if (toastEnabled) {
              setToastAlert(fresh);
              setTimeout(() => setToastAlert((c) => (c?.id === fresh.id ? null : c)), 4000);
            }
          }
        }
        incomingEvents.forEach((ev) => seenEventIdsRef.current.add(ev.id));
        setRulesData({ rules: res.rules || [], events: incomingEvents });
      } catch (e: any) {
        setRulesError(e?.message || '获取监控规则失败');
      } finally {
        setLoadingRules(false);
      }
    },
    [soundEnabled, toastEnabled]
  );

  const loadAnomalies = useCallback(async (silent = false) => {
    if (!silent) setLoadingAnomaly(true);
    setAnomalyError(null);
    try {
      const res = await api.getAnomalies();
      setAnomalies(Array.isArray(res.anomalies) ? res.anomalies : []);
      setAnomalyUpdatedAt(res.updatedAt || '');
    } catch (e: any) {
      setAnomalyError(e?.message || '获取盘中异动雷达失败');
    } finally {
      setLoadingAnomaly(false);
    }
  }, []);

  useEffect(() => {
    loadRules(false);
    loadAnomalies(false);
  }, [loadRules, loadAnomalies]);

  useEffect(() => {
    if (pollIntervalSec === 0) return;
    const timer = setInterval(() => {
      loadRules(true);
      loadAnomalies(true);
    }, pollIntervalSec * 1000);
    return () => clearInterval(timer);
  }, [pollIntervalSec, loadRules, loadAnomalies]);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(ruleThreshold);
    if (!Number.isFinite(num)) return;
    setSavingRule(true);
    try {
      const name =
        ruleName.trim() ||
        `${ruleCode === '*' ? '全市场' : ruleCode} ${METRIC_LABELS[ruleMetric].split(' ')[0]} ${num}`;
      const res = await api.saveMonitorRule({
        name,
        code: ruleCode.trim() || '*',
        metric: ruleMetric,
        threshold: num,
        enabled: true,
      });
      setRulesData({ rules: res.rules || [], events: res.events || [] });
      setRuleName('');
    } catch (err: any) {
      setRulesError(err?.message || '创建规则失败');
    } finally {
      setSavingRule(false);
    }
  };

  const handleQuickPresetRule = async (preset: {
    name: string;
    code: string;
    metric: MonitorRule['metric'];
    threshold: number;
  }) => {
    try {
      const res = await api.saveMonitorRule({ ...preset, enabled: true });
      setRulesData({ rules: res.rules || [], events: res.events || [] });
    } catch {
      // ignore
    }
  };

  const handleToggleRule = async (rule: MonitorRule) => {
    try {
      const res = await api.saveMonitorRule({ ...rule, enabled: !rule.enabled });
      setRulesData({ rules: res.rules || [], events: res.events || [] });
    } catch {
      // ignore
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      const res = await api.deleteMonitorRule(id);
      setRulesData({ rules: res.rules || [], events: res.events || [] });
    } catch {
      // ignore
    }
  };

  const anomalyStats = useMemo(() => {
    let bull = 0;
    let bear = 0;
    for (const a of anomalies) {
      if (a.direction === 'bull') bull += 1;
      else bear += 1;
    }
    return { total: anomalies.length, bull, bear };
  }, [anomalies]);

  const filteredAnomalies = useMemo(() => {
    const q = anomalySearch.trim().toLowerCase();
    return anomalies.filter((a) => {
      if (directionFilter !== 'all' && a.direction !== directionFilter) return false;
      if (typeFilter !== '全部类型' && a.type !== typeFilter) return false;
      if (
        q &&
        !a.code.toLowerCase().includes(q) &&
        !a.name.toLowerCase().includes(q) &&
        !a.detail.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [anomalies, directionFilter, typeFilter, anomalySearch]);

  return (
    <div className="h-full w-full flex flex-col bg-[#222832] gap-[1px] overflow-hidden">
      {toastAlert && (
        <div className="fixed top-9 right-3 z-50 w-80 bg-[#141923] border border-[#ff8800] p-2.5 text-[11px]">
          <div className="font-bold text-[#ff9500]">
            [{toastAlert.ruleName}] {toastAlert.code} {toastAlert.name}
          </div>
          <div className="text-[#e8edf5] mt-0.5">{toastAlert.message}</div>
          <div className="font-mono text-[#7d8796] mt-0.5">{toastAlert.time}</div>
        </div>
      )}

      {/* Top 28px Wind Tab + Control Bar */}
      <div className="h-[28px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center h-full gap-3">
          <div className="flex items-center">
            <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
            <span className="text-[12px] font-bold text-[#dfe6f0]">
              F11 盘口异动短线精灵与规则盯盘
            </span>
          </div>

          <div className="flex items-center h-full border-l border-[#232a36]">
            <button
              onClick={() => setActiveTab('anomaly')}
              className={`h-full px-3 text-[11px] font-medium border-r border-[#232a36] ${
                activeTab === 'anomaly'
                  ? 'bg-[#0e1117] text-[#ff9500] border-t-2 border-t-[#ff8800]'
                  : 'text-[#8b95a5] hover:text-[#e8edf5]'
              }`}
            >
              [01] 盘口异动短线精灵 ({anomalyStats.total})
            </button>
            <button
              onClick={() => setActiveTab('monitor')}
              className={`h-full px-3 text-[11px] font-medium border-r border-[#232a36] ${
                activeTab === 'monitor'
                  ? 'bg-[#0e1117] text-[#ff9500] border-t-2 border-t-[#ff8800]'
                  : 'text-[#8b95a5] hover:text-[#e8edf5]'
              }`}
            >
              [02] 条件盯盘规则引擎 ({rulesData.rules.filter((r) => r.enabled).length}/{rulesData.rules.length})
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-[#7d8796]">轮询:</span>
          {([0, 15, 30] as const).map((sec) => (
            <button
              key={sec}
              onClick={() => setPollIntervalSec(sec)}
              className={`px-1.5 h-[20px] rounded-[2px] border font-mono ${
                pollIntervalSec === sec
                  ? 'bg-[#0e1117] border-[#ff8800] text-[#ff9500]'
                  : 'border-[#2b3342] text-[#8b95a5]'
              }`}
            >
              {sec === 0 ? '停' : `${sec}s`}
            </button>
          ))}
          <button
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              if (next) playAlertBeep();
            }}
            className={`px-2 h-[20px] rounded-[2px] border ${
              soundEnabled
                ? 'border-[#f0b90b] text-[#f0b90b] bg-[#211b0c]'
                : 'border-[#2b3342] text-[#7d8796]'
            }`}
          >
            声音:{soundEnabled ? '开' : '关'}
          </button>
          <button
            onClick={() => setToastEnabled((v) => !v)}
            className={`px-2 h-[20px] rounded-[2px] border ${
              toastEnabled
                ? 'border-[#4da3ff] text-[#4da3ff] bg-[#101c2c]'
                : 'border-[#2b3342] text-[#7d8796]'
            }`}
          >
            弹窗:{toastEnabled ? '开' : '关'}
          </button>
          <button
            onClick={() => {
              loadRules(true);
              loadAnomalies(true);
            }}
            className="px-2 h-[20px] rounded-[2px] bg-[#1a202c] hover:bg-[#232b3b] border border-[#2b3342] text-[#dfe6f0]"
          >
            扫描
          </button>
        </div>
      </div>

      {activeTab === 'monitor' ? (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-[1px] bg-[#222832] overflow-hidden">
          {/* Left 7 cols: Rule Form + Rules Table */}
          <div className="lg:col-span-7 flex flex-col gap-[1px] bg-[#222832] min-h-0 overflow-hidden">
            <div className="bg-[#0e1117] p-2.5 shrink-0 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold text-[#dfe6f0]">新建自动化盯盘规则</span>
                <div className="flex items-center gap-1.5">
                  {[
                    {
                      label: '+涨幅>=5%',
                      name: '全市场强势冲高预警',
                      code: '*',
                      metric: 'changePct' as const,
                      threshold: 5,
                    },
                    {
                      label: '+量比>=3x',
                      name: '主力放量抢筹预警',
                      code: '*',
                      metric: 'volumeRatio' as const,
                      threshold: 3,
                    },
                    {
                      label: '+炸板监控',
                      name: '核心连板炸板预警',
                      code: '*',
                      metric: 'brokenBoard' as const,
                      threshold: 1,
                    },
                  ].map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() =>
                        handleQuickPresetRule({
                          name: p.name,
                          code: p.code,
                          metric: p.metric,
                          threshold: p.threshold,
                        })
                      }
                      className="px-2 h-[20px] rounded-[2px] bg-[#161b24] hover:border-[#ff8800] border border-[#2b3342] text-[#4da3ff]"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <form onSubmit={handleCreateRule} className="grid grid-cols-12 gap-1.5 text-[11px]">
                <input
                  type="text"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="规则名称 (如: 茅台突破1600)"
                  className="col-span-4 h-[26px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-2 text-[#e8edf5] placeholder-[#5c6675] focus:outline-none"
                />
                <input
                  type="text"
                  value={ruleCode}
                  onChange={(e) => setRuleCode(e.target.value)}
                  placeholder="*或代码"
                  className="col-span-2 h-[26px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-2 font-mono text-[#e5b567] focus:outline-none"
                />
                <select
                  value={ruleMetric}
                  onChange={(e) => setRuleMetric(e.target.value as MonitorRule['metric'])}
                  className="col-span-3 h-[26px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-1.5 text-[#e8edf5] focus:outline-none"
                >
                  {(Object.keys(METRIC_LABELS) as MonitorRule['metric'][]).map((k) => (
                    <option key={k} value={k}>
                      {METRIC_LABELS[k]}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.1"
                  value={ruleThreshold}
                  onChange={(e) => setRuleThreshold(e.target.value)}
                  className="col-span-2 h-[26px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#ff8800] rounded-[2px] px-2 font-mono text-[#f0b90b] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={savingRule}
                  className="col-span-1 h-[26px] rounded-[2px] bg-[#ff8800] text-[#090c10] font-bold hover:bg-[#ff9922]"
                >
                  +加
                </button>
              </form>
            </div>

            <div className="flex-1 min-h-0 bg-[#0e1117] flex flex-col overflow-hidden">
              <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between shrink-0">
                <div className="flex items-center">
                  <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
                  <span className="text-[12px] font-bold text-[#dfe6f0]">
                    已部署规则 ({rulesData.rules.filter((r) => r.enabled).length}/{rulesData.rules.length})
                  </span>
                </div>
                <span className="text-[11px] text-[#7d8796]">后台自动核验行情快照</span>
              </div>

              <div className="flex-1 min-h-0 overflow-auto">
                {rulesError ? (
                  <div className="p-4 text-center text-[12px] text-[#ff3535]">{rulesError}</div>
                ) : loadingRules ? (
                  <div className="p-6 text-center text-[12px] text-[#7d8796]">加载规则中...</div>
                ) : rulesData.rules.length === 0 ? (
                  <div className="p-6 text-center text-[12px] text-[#7d8796]">暂无规则</div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#151a23] border-b border-[#252c38] text-[11px] text-[#8b95a5]">
                      <tr className="h-[26px]">
                        <th className="px-2.5">状态</th>
                        <th className="px-2.5">规则名称</th>
                        <th className="px-2.5">标的</th>
                        <th className="px-2.5">条件</th>
                        <th className="px-2.5 text-right">阈值</th>
                        <th className="px-2.5 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="text-[12px] tabular-nums">
                      {rulesData.rules.map((rule) => (
                        <tr
                          key={rule.id}
                          className="h-[26px] border-b border-[#181d26] even:bg-[#11151d] hover:bg-[#1b2434]"
                        >
                          <td className="px-2.5">
                            <span
                              className={`inline-block w-2 h-2 mr-1.5 ${
                                rule.enabled ? 'bg-[#00c853]' : 'bg-[#5c6675]'
                              }`}
                            />
                            <span className={rule.enabled ? 'text-[#00c853]' : 'text-[#7d8796]'}>
                              {rule.enabled ? '开' : '停'}
                            </span>
                          </td>
                          <td className="px-2.5 text-[#e8edf5] font-medium">{rule.name}</td>
                          <td className="px-2.5 font-mono text-[#e5b567]">
                            {rule.code === '*' ? '全市场' : rule.code}
                          </td>
                          <td className="px-2.5 text-[11px] text-[#8b95a5]">
                            {METRIC_LABELS[rule.metric]}
                          </td>
                          <td className="px-2.5 text-right font-mono text-[#f0b90b]">
                            {rule.threshold}
                          </td>
                          <td className="px-2.5 text-right whitespace-nowrap">
                            <button
                              onClick={() => handleToggleRule(rule)}
                              className="px-1.5 py-0.5 text-[10px] rounded-[2px] border border-[#2b3342] text-[#dfe6f0] hover:border-[#ff8800] mr-1"
                            >
                              {rule.enabled ? '停用' : '启用'}
                            </button>
                            <button
                              onClick={() => handleDeleteRule(rule.id)}
                              className="px-1.5 py-0.5 text-[10px] rounded-[2px] border border-[#2b3342] text-[#7d8796] hover:text-[#ff3535]"
                            >
                              删
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Right 5 cols: Triggered Event Blotter */}
          <div className="lg:col-span-5 bg-[#0e1117] flex flex-col min-h-0 overflow-hidden">
            <div className="h-[26px] bg-[#161b24] border-b border-[#232a36] px-2.5 flex items-center justify-between shrink-0">
              <div className="flex items-center">
                <span className="w-[2px] h-3 bg-[#ff8800] mr-2 inline-block" />
                <span className="text-[12px] font-bold text-[#dfe6f0]">
                  触发告警流水 ({rulesData.events.length})
                </span>
              </div>
              <span className="text-[11px] text-[#7d8796]">点击跳转个股K线</span>
            </div>

            <div className="flex-1 min-h-0 overflow-auto">
              {rulesData.events.length === 0 ? (
                <div className="p-8 text-center text-[12px] text-[#7d8796]">暂无触发告警记录</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#151a23] border-b border-[#252c38] text-[11px] text-[#8b95a5]">
                    <tr className="h-[26px]">
                      <th className="px-2">时间</th>
                      <th className="px-2">级别</th>
                      <th className="px-2">代码/名称</th>
                      <th className="px-2">触发信息</th>
                    </tr>
                  </thead>
                  <tbody className="text-[12px] tabular-nums">
                    {rulesData.events.map((ev) => (
                      <tr
                        key={ev.id}
                        onClick={() => ev.code && ev.code !== '*' && onSelectStock(ev.code, ev.name)}
                        className="h-[26px] border-b border-[#181d26] even:bg-[#11151d] hover:bg-[#1b2434] cursor-pointer"
                      >
                        <td className="px-2 font-mono text-[11px] text-[#7d8796] whitespace-nowrap">
                          {ev.time.slice(-8)}
                        </td>
                        <td className="px-2 whitespace-nowrap">
                          <span
                            className={`text-[10px] px-1 py-0.5 rounded-[2px] border ${
                              ev.level === 'critical'
                                ? 'border-[#ff3535] text-[#ff3535]'
                                : ev.level === 'warn'
                                ? 'border-[#ff8800] text-[#ff9500]'
                                : 'border-[#4da3ff] text-[#4da3ff]'
                            }`}
                          >
                            {ev.level === 'critical' ? '急' : ev.level === 'warn' ? '警' : '讯'}
                          </span>
                        </td>
                        <td className="px-2 whitespace-nowrap">
                          <span className="font-mono text-[#e5b567] mr-1.5">{ev.code}</span>
                          <span className="text-[#e8edf5]">{ev.name}</span>
                        </td>
                        <td className="px-2 text-[11px] text-[#dfe6f0] truncate max-w-[260px]" title={ev.message}>
                          {ev.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Anomaly Short-Line Sprite Table (同花顺短线精灵) */
        <div className="flex-1 min-h-0 flex flex-col gap-[1px] bg-[#222832] overflow-hidden">
          <div className="h-[30px] bg-[#0e1117] px-2.5 flex items-center justify-between shrink-0 text-[11px]">
            <div className="flex items-center gap-2">
              {(
                [
                  { id: 'all', label: `全部(${anomalyStats.total})` },
                  { id: 'bull', label: `多头异动(${anomalyStats.bull})` },
                  { id: 'bear', label: `空头异动(${anomalyStats.bear})` },
                ] as const
              ).map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDirectionFilter(d.id)}
                  className={`px-2 h-[22px] rounded-[2px] border font-mono ${
                    directionFilter === d.id
                      ? 'bg-[#161b24] border-[#ff8800] text-[#ff9500]'
                      : 'border-[#2b3342] text-[#8b95a5] hover:text-[#e8edf5]'
                  }`}
                >
                  {d.label}
                </button>
              ))}

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="h-[22px] bg-[#0a0d12] border border-[#2b3342] rounded-[2px] px-2 text-[#e8edf5] focus:outline-none"
              >
                {ANOMALY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={anomalySearch}
                onChange={(e) => setAnomalySearch(e.target.value)}
                placeholder="过滤代码/名称/异动说明..."
                className="w-48 h-[22px] bg-[#0a0d12] border border-[#2b3342] focus:border-[#4da3ff] rounded-[2px] px-2 text-[#e8edf5] placeholder-[#5c6675] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-3 font-mono">
              <span className="text-[#ff3535]">多:{anomalyStats.bull}</span>
              <span className="text-[#00c853]">空:{anomalyStats.bear}</span>
              <span className="text-[#7d8796]">更新: {anomalyUpdatedAt || '-'}</span>
            </div>
          </div>

          <div className="flex-1 min-h-0 bg-[#0e1117] overflow-auto">
            {anomalyError ? (
              <div className="p-6 text-center text-[12px] text-[#ff3535]">{anomalyError}</div>
            ) : loadingAnomaly ? (
              <div className="p-8 text-center text-[12px] text-[#7d8796]">
                正在扫描全市场盘口异动脉冲...
              </div>
            ) : filteredAnomalies.length === 0 ? (
              <div className="p-8 text-center text-[12px] text-[#7d8796]">暂无匹配异动</div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#151a23] border-b border-[#252c38] text-[11px] text-[#8b95a5]">
                  <tr className="h-[26px]">
                    <th className="px-2.5 w-20">时间</th>
                    <th className="px-2.5 w-14">方向</th>
                    <th className="px-2.5 w-24">异动类型</th>
                    <th className="px-2.5 w-24">代码</th>
                    <th className="px-2.5 w-28">名称</th>
                    <th className="px-2.5 w-24 text-right">触发价</th>
                    <th className="px-2.5 w-24 text-right">涨跌幅</th>
                    <th className="px-2.5">盘口短线异动详情</th>
                  </tr>
                </thead>
                <tbody className="text-[12px] tabular-nums">
                  {filteredAnomalies.map((item) => {
                    const isBull = item.direction === 'bull';
                    return (
                      <tr
                        key={item.id}
                        onClick={() => onSelectStock(item.code, item.name)}
                        className="h-[26px] border-b border-[#181d26] even:bg-[#11151d] hover:bg-[#1b2434] cursor-pointer"
                      >
                        <td className="px-2.5 font-mono text-[#7d8796]">{item.time}</td>
                        <td className="px-2.5">
                          <span
                            className={`text-[10px] px-1 py-0.5 rounded-[2px] border font-bold ${
                              isBull
                                ? 'border-[#ff3535] text-[#ff3535]'
                                : 'border-[#00c853] text-[#00c853]'
                            }`}
                          >
                            {isBull ? '多头' : '空头'}
                          </span>
                        </td>
                        <td
                          className={`px-2.5 font-medium ${
                            isBull ? 'text-[#ff3535]' : 'text-[#00c853]'
                          }`}
                        >
                          {item.type}
                        </td>
                        <td className="px-2.5 font-mono text-[#e5b567]">{item.code}</td>
                        <td className="px-2.5 text-[#e8edf5] font-medium">{item.name}</td>
                        <td
                          className={`px-2.5 text-right font-mono font-semibold ${upDownCls(
                            item.changePct
                          )}`}
                        >
                          {item.price.toFixed(2)}
                        </td>
                        <td
                          className={`px-2.5 text-right font-mono font-semibold ${upDownCls(
                            item.changePct
                          )}`}
                        >
                          {formatPct(item.changePct)}
                        </td>
                        <td className="px-2.5 font-mono text-[11px] text-[#f0b90b]">
                          {item.detail}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
