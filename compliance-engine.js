/**
 * 交易合规检查引擎 v1.4
 * 实现v1.4规则框架的合规性检查
 */

const ComplianceEngine = {
    params: {}, // 从配置加载

    init(params) {
        this.params = params;
    },

    /**
     * 执行完整合规检查
     * @param {Object} action - {type, code, name, amount, emotion, ...}
     * @param {Object} context - {holdings, macroData, valuationData, ...}
     * @returns {Object} - {pass, checks[], summary}
     */
    check(action, context) {
        const checks = [];
        const p = this.params;

        // ===== 情绪管理检查（所有操作通用）=====
        checks.push(this.checkEmotion(action, p));

        // ===== 按操作类型执行特定检查 =====
        switch (action.type) {
            case 'buy':
                checks.push(...this.checkBuy(action, context, p));
                break;
            case 'sell':
                checks.push(...this.checkSell(action, context, p));
                break;
            case 'add':
                checks.push(...this.checkAdd(action, context, p));
                break;
            case 'rebalance':
                checks.push(...this.checkRebalance(action, context, p));
                break;
        }

        // ===== 通用检查 =====
        checks.push(this.checkSingleLimit(action, context, p));
        checks.push(this.checkIndustryLimit(action, context, p));

        // 计算汇总
        const passed = checks.filter(c => c.status === 'pass').length;
        const failed = checks.filter(c => c.status === 'fail').length;
        const warned = checks.filter(c => c.status === 'warn').length;

        return {
            pass: failed === 0,
            checks,
            summary: { passed, failed, warned, total: checks.length }
        };
    },

    // ===== 情绪管理 =====
    checkEmotion(action, p) {
        const emotion = action.emotion || 20;
        if (emotion > p.E04_禁止阈值) {
            return {
                status: 'fail',
                rule: 'E-04',
                title: '情绪禁止交易',
                desc: `情绪评分${emotion}>阈值${p.E04_禁止阈值}，禁止任何非计划操作`
            };
        } else if (emotion > p.E03_冷静期阈值) {
            return {
                status: 'fail',
                rule: 'E-03',
                title: '强制冷静期',
                desc: `情绪评分${emotion}>阈值${p.E03_冷静期阈值}，需等待${p.C06_冷静期}天冷静期`
            };
        } else if (emotion > p.E02_减仓阈值) {
            return {
                status: 'warn',
                rule: 'E-02',
                title: '情绪减仓提醒',
                desc: `情绪评分${emotion}处于${p.E02_减仓阈值}-${p.E03_冷静期阈值}区间，单笔金额应≤日常50%`
            };
        }
        return {
            status: 'pass',
            rule: 'E-01',
            title: '情绪正常',
            desc: `情绪评分${emotion}≤${p.E01_正常阈值}，可正常操作`
        };
    },

    // ===== 买入检查 =====
    checkBuy(action, context, p) {
        const checks = [];
        const pe = context.overallPEPercentile || 50;

        // V-02/V-03: PE百分位检查
        if (pe >= p.V03_PE止盈阈值) {
            checks.push({
                status: 'fail',
                rule: 'V-03',
                title: 'PE极高-禁止买入',
                desc: `整体PE百分位${pe.toFixed(1)}%≥${p.V03_PE止盈阈值}%，已进入止盈区间，禁止买入`
            });
        } else if (pe >= p.V03_PE暂停阈值) {
            checks.push({
                status: 'warn',
                rule: 'V-03',
                title: 'PE偏高-减配买入',
                desc: `整体PE百分位${pe.toFixed(1)}%≥${p.V03_PE暂停阈值}%，应减少股票配置`
            });
        } else if (pe < p.V02_PE低估阈值) {
            checks.push({
                status: 'pass',
                rule: 'V-02',
                title: 'PE低估-可加倍',
                desc: `整体PE百分位${pe.toFixed(1)}%<${p.V02_PE低估阈值}%，处于低估区间，可增加配置`
            });
        } else {
            checks.push({
                status: 'pass',
                rule: 'V-02',
                title: 'PE合理区间',
                desc: `整体PE百分位${pe.toFixed(1)}%在合理区间`
            });
        }

        // V-04: 月投上限检查
        const monthTotal = context.monthTotalInvest || 0;
        if (monthTotal + (action.amount || 0) > p.V04_月投上限) {
            checks.push({
                status: 'fail',
                rule: 'V-04',
                title: '月投超限',
                desc: `本月已投${monthTotal}元+本次${action.amount}元=${monthTotal + action.amount}元，超过月投上限${p.V04_月投上限}元`
            });
        } else {
            checks.push({
                status: 'pass',
                rule: 'V-04',
                title: '月投额度充足',
                desc: `本月已投${monthTotal}元，剩余${p.V04_月投上限 - monthTotal}元额度`
            });
        }

        // TF-05: 200日均线检查
        if (context.sma200 !== undefined && context.currentPrice !== undefined) {
            if (context.currentPrice < context.sma200 * (1 - p.TF08_偏离极值 / 100)) {
                checks.push({
                    status: 'fail',
                    rule: 'TF-05/08',
                    title: '深度破位-暂停定投',
                    desc: `价格${context.currentPrice}低于200日均线${context.sma200}超过${p.TF08_偏离极值}%`
                });
            } else if (context.currentPrice < context.sma200) {
                checks.push({
                    status: 'warn',
                    rule: 'TF-05',
                    title: '价格低于200日均线',
                    desc: `价格${context.currentPrice}<200日均线${context.sma200}，定投金额应×0.5`
                });
            } else {
                checks.push({
                    status: 'pass',
                    rule: 'TF-05',
                    title: '趋势正常',
                    desc: `价格${context.currentPrice}≥200日均线${context.sma200}`
                });
            }
        }

        // TF-12: 12-1月动量检查
        if (context.momentum12_1 !== undefined) {
            if (context.momentum12_1 <= 0) {
                checks.push({
                    status: 'fail',
                    rule: 'TF-12',
                    title: '中期动量恶化',
                    desc: `12-1月动量${context.momentum12_1.toFixed(2)}%≤0，暂停该标的定投`
                });
            } else {
                checks.push({
                    status: 'pass',
                    rule: 'TF-12',
                    title: '中期动量正向',
                    desc: `12-1月动量${context.momentum12_1.toFixed(2)}%>0`
                });
            }
        }

        // TF-10/11: 急涨检查
        if (context.priceChange20d !== undefined) {
            if (context.priceChange20d > p.TF11_急涨极端) {
                checks.push({
                    status: 'fail',
                    rule: 'TF-11',
                    title: '极端急涨-暂停2周',
                    desc: `20日涨幅${context.priceChange20d.toFixed(1)}%>极端阈值${p.TF11_急涨极端}%，暂停2周`
                });
            } else if (context.priceChange20d > p.TF11_急涨警戒) {
                checks.push({
                    status: 'warn',
                    rule: 'TF-11',
                    title: '短期急涨-推迟1周',
                    desc: `20日涨幅${context.priceChange20d.toFixed(1)}%>警戒阈值${p.TF11_急涨警戒}%，建议推迟1周`
                });
            } else {
                checks.push({
                    status: 'pass',
                    rule: 'TF-11',
                    title: '无急涨信号',
                    desc: `20日涨幅${context.priceChange20d.toFixed(1)}%≤${p.TF11_急涨警戒}%`
                });
            }
        }

        // S-01: 标的级暂停检查
        if (context.holdingLoss !== undefined && context.holdingLoss < -p.S01_标的级暂停) {
            checks.push({
                status: 'fail',
                rule: 'S-01',
                title: '标的级暂停',
                desc: `该标的浮亏${context.holdingLoss.toFixed(1)}%>阈值${p.S01_标的级暂停}%，暂停定投`
            });
        }

        // S-03: 系统级检查
        if (pe >= p.S03_系统级降仓 && context.peHighDays >= 30) {
            checks.push({
                status: 'fail',
                rule: 'S-03',
                title: '系统级降仓',
                desc: `PE百分位${pe}%>${p.S03_系统级降仓}%已持续${context.peHighDays}天(>30天)，股票仓位需降至30%以下`
            });
        }

        return checks;
    },

    // ===== 卖出检查 =====
    checkSell(action, context, p) {
        const checks = [];
        const pe = context.overallPEPercentile || 50;

        // P-01/02/03: 止盈检查
        if (pe >= p.P03_止盈三档下限) {
            checks.push({
                status: 'pass',
                rule: 'P-03',
                title: '止盈三档-全部赎回',
                desc: `PE百分位${pe.toFixed(1)}%≥${p.P03_止盈三档下限}%，应全部赎回`
            });
        } else if (pe >= p.P02_止盈二档下限) {
            checks.push({
                status: 'pass',
                rule: 'P-02',
                title: '止盈二档-赎回30%',
                desc: `PE百分位${pe.toFixed(1)}%≥${p.P02_止盈二档下限}%，应累计赎回50%`
            });
        } else if (pe >= p.P01_止盈一档下限) {
            checks.push({
                status: 'pass',
                rule: 'P-01',
                title: '止盈一档-赎回20%',
                desc: `PE百分位${pe.toFixed(1)}%≥${p.P01_止盈一档下限}%，开始止盈`
            });
        } else {
            checks.push({
                status: 'warn',
                rule: 'P-01',
                title: '未达止盈条件',
                desc: `PE百分位${pe.toFixed(1)}%<${p.P01_止盈一档下限}%，非止盈区间`
            });
        }

        // 冷静期提醒
        checks.push({
            status: 'pass',
            rule: 'C-06',
            title: '冷静期提醒',
            desc: `卖出后同一标的需等待${p.C06_冷静期}天冷静期才能回补`
        });

        return checks;
    },

    // ===== 加仓检查 =====
    checkAdd(action, context, p) {
        const checks = [];

        // 加仓次数检查
        if (context.addCount !== undefined && context.addCount >= 3) {
            checks.push({
                status: 'fail',
                rule: 'C-05',
                title: '加仓次数已满',
                desc: `已加仓${context.addCount}次，达到最大3次限制`
            });
        } else {
            checks.push({
                status: 'pass',
                rule: 'C-05',
                title: '加仓次数',
                desc: `已加仓${context.addCount || 0}次，剩余${3 - (context.addCount || 0)}次`
            });
        }

        // 加仓递减金额检查
        const expectedRatio = context.addCount === 0 ? 1 : context.addCount === 1 ? 0.5 : 0.25;
        if (context.addAmount && context.baseAmount) {
            const actualRatio = context.addAmount / context.baseAmount;
            if (actualRatio > expectedRatio * 1.1) {
                checks.push({
                    status: 'warn',
                    rule: 'C-05',
                    title: '加仓金额偏大',
                    desc: `第${(context.addCount||0)+1}次加仓比例应为${(expectedRatio*100).toFixed(0)}%，实际${(actualRatio*100).toFixed(0)}%`
                });
            }
        }

        // 止损优先级检查
        if (context.stopLossTriggered) {
            checks.push({
                status: 'fail',
                rule: 'S-01',
                title: '止损优先',
                desc: '止损已触发，禁止加仓'
            });
        }

        // 复用买入的趋势检查
        checks.push(...this.checkBuy(action, context, p).filter(c =>
            ['TF-05', 'TF-05/08', 'TF-12', 'TF-11'].includes(c.rule)));

        return checks;
    },

    // ===== 再平衡检查 =====
    checkRebalance(action, context, p) {
        const checks = [];

        if (context.deviation !== undefined) {
            const dev = Math.abs(context.deviation);
            if (dev > p.R02_强制再平衡) {
                checks.push({
                    status: 'fail',
                    rule: 'R-02',
                    title: '强制再平衡',
                    desc: `偏离${context.deviation.toFixed(1)}%>${p.R02_强制再平衡}%，需暂停超配标的定投`
                });
            } else if (dev > p.R01_偏离提示) {
                checks.push({
                    status: 'warn',
                    rule: 'R-01',
                    title: '偏离提醒',
                    desc: `偏离${context.deviation.toFixed(1)}%>${p.R01_偏离提示}%，建议微调`
                });
            } else {
                checks.push({
                    status: 'pass',
                    rule: 'R-01',
                    title: '偏离正常',
                    desc: `偏离${context.deviation.toFixed(1)}%≤${p.R01_偏离提示}%`
                });
            }
        }

        // 组合级止损检查
        if (context.totalLoss !== undefined && context.totalLoss < -p.S02_组合级审视) {
            checks.push({
                status: 'fail',
                rule: 'S-02',
                title: '组合级审视',
                desc: `组合浮亏${context.totalLoss.toFixed(1)}%>${p.S02_组合级审视}%，需全面审视`
            });
        }

        return checks;
    },

    // ===== 单标的上限 =====
    checkSingleLimit(action, context, p) {
        if (!context.holdings || !action.amount) {
            return { status: 'pass', rule: 'V-05', title: '单标的上限', desc: '数据不足，跳过' };
        }

        const totalAssets = context.totalAssets || 100000;
        const targetHolding = (context.currentHolding || 0) + (action.amount || 0);
        const ratio = targetHolding / totalAssets * 100;

        if (ratio > p.V05_单标的上限) {
            return {
                status: 'fail',
                rule: 'V-05',
                title: '单标的超限',
                desc: `该标的占比${ratio.toFixed(1)}%>${p.V05_单标的上限}%`
            };
        }
        return {
            status: 'pass',
            rule: 'V-05',
            title: '单标的合规',
            desc: `该标的占比${ratio.toFixed(1)}%≤${p.V05_单标的上限}%`
        };
    },

    // ===== 行业上限 =====
    checkIndustryLimit(action, context, p) {
        if (!context.industryTotal) {
            return { status: 'pass', rule: 'C-07', title: '行业上限', desc: '数据不足，跳过' };
        }

        const totalAssets = context.totalAssets || 100000;
        const industryRatio = context.industryTotal / totalAssets * 100;

        if (industryRatio > p.C07_单行业上限) {
            return {
                status: 'fail',
                rule: 'C-07',
                title: '行业超限',
                desc: `该行业占比${industryRatio.toFixed(1)}%>${p.C07_单行业上限}%（铁律）`
            };
        }
        return {
            status: 'pass',
            rule: 'C-07',
            title: '行业合规',
            desc: `该行业占比${industryRatio.toFixed(1)}%≤${p.C07_单行业上限}%`
        };
    },

    // ===== 止损计算辅助 =====
    calcStopLoss(position, totalAssets) {
        const p = this.params;

        // 心理止损
        const psych = p.C01_心理止损系数 / Math.pow(position * 100, p.C01_心理止损指数);

        // 风险预算
        const R = p.C03_风险预算R上限 - (p.C03_风险预算R上限 - p.C03_风险预算R下限) *
            Math.min(1, Math.log10(totalAssets / 10000) / 2);
        const riskBudget = totalAssets * R / 100 / totalAssets * 100;

        // 最终止损 = min(max(心理, ATR), 风险预算)
        const finalStop = Math.min(Math.max(psych, 0), riskBudget);

        return {
            psychological: Math.max(p.C04_止损下限, Math.min(p.C04_止损上限, psych)),
            riskBudget: Math.max(p.C04_止损下限, Math.min(p.C04_止损上限, riskBudget)),
            final: Math.max(p.C04_止损下限, Math.min(p.C04_止损上限, finalStop))
        };
    },

    // ===== 宏观评分计算 =====
    calcMacroScore(indicators) {
        const p = this.params;
        let score = 0;

        // VIX评分
        if (indicators.vix !== undefined) {
            if (indicators.vix > p.M02_VIX恐慌阈值) score += 2;
            else if (indicators.vix > p.M01_VIX正常上限) score += 1;
            else if (indicators.vix < p.M01_VIX正常下限) score -= 2;
        }

        // ERP评分
        if (indicators.erp !== undefined) {
            if (indicators.erp < p.M03_ERP正常下限) score -= 2;
            else if (indicators.erp < p.M03_ERP正常下限 + 1) score -= 1;
            else if (indicators.erp > 7) score += 2;
            else if (indicators.erp > 6) score += 1;
        }

        // DXY评分
        if (indicators.dxy !== undefined) {
            if (indicators.dxy > p.M04_DXY正常上限) score -= 1;
            else if (indicators.dxy < p.M04_DXY正常下限) score += 1;
        }

        // 市场温度评分
        if (indicators.marketTemp !== undefined) {
            if (indicators.marketTemp < 20) score += 2;
            else if (indicators.marketTemp < p.M05_市场温度正常下限) score += 1;
            else if (indicators.marketTemp > 80) score -= 1;
        }

        // ETF净流入评分
        if (indicators.etfFlow !== undefined) {
            if (indicators.etfFlow < -30) score += 2;
            else if (indicators.etfFlow > 50) score -= 1;
        }

        // 仓位修正
        const adjustment = Math.max(-p.M06_宏观修正上限, Math.min(p.M06_宏观修正上限, score * 1.5));

        return { rawScore: score, adjustment, status: this.getScoreStatus(score) };
    },

    getScoreStatus(score) {
        if (score <= -3) return { text: '极度看空', color: 'red' };
        if (score <= -1) return { text: '偏空', color: 'red' };
        if (score === 0) return { text: '中性', color: 'blue' };
        if (score <= 3) return { text: '偏多', color: 'green' };
        return { text: '极度看多', color: 'green' };
    }
};
