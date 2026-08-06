/**
 * 飞书API集成层
 * 负责认证、数据读取、数据写入
 */

const FeishuAPI = {
    token: null,
    tokenExpiry: 0,
    tableIds: {},

    // 获取tenant_access_token
    async getToken() {
        if (this.token && Date.now() < this.tokenExpiry) {
            return this.token;
        }
        if (!CONFIG.APP_ID || !CONFIG.APP_SECRET) {
            console.warn('飞书凭证未配置，使用本地数据模式');
            return null;
        }
        try {
            const resp = await fetch(`${CONFIG.FEISHU_API}/open-apis/auth/v3/tenant_access_token/internal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    app_id: CONFIG.APP_ID,
                    app_secret: CONFIG.APP_SECRET
                })
            });
            const data = await resp.json();
            if (data.code === 0) {
                this.token = data.tenant_access_token;
                this.tokenExpiry = Date.now() + (data.expire - 300) * 1000; // 提前5分钟刷新
                console.log('飞书认证成功');
                return this.token;
            } else {
                console.error('飞书认证失败:', data.msg);
                return null;
            }
        } catch (e) {
            console.error('飞书认证异常:', e);
            return null;
        }
    },

    // 通用请求
    async request(method, path, body = null) {
        const token = await this.getToken();
        if (!token) return null;

        const opts = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        };
        if (body) opts.body = JSON.stringify(body);

        try {
            const resp = await fetch(`${CONFIG.FEISHU_API}${path}`, opts);
            const data = await resp.json();
            if (data.code === 0) return data.data;
            console.error(`API错误 [${path}]:`, data.msg);
            return null;
        } catch (e) {
            console.error(`API异常 [${path}]:`, e);
            return null;
        }
    },

    // 自动发现表ID
    async discoverTables() {
        const data = await this.request('GET',
            `/open-apis/bitable/v1/apps/${CONFIG.BASE_TOKEN}/tables?page_size=100`);
        if (!data || !data.items) return;

        data.items.forEach(item => {
            this.tableIds[item.name] = item.table_id;
        });

        // 更新CONFIG
        Object.assign(CONFIG.TABLE_IDS, this.tableIds);
        console.log('发现表:', Object.keys(this.tableIds));
    },

    // 读取表记录（全部）
    async readAllRecords(tableName, options = {}) {
        const tableId = this.tableIds[tableName] || CONFIG.TABLE_IDS[tableName];
        if (!tableId) {
            console.warn(`表 ${tableName} 未找到`);
            return [];
        }

        const records = [];
        let pageToken = '';
        let hasMore = true;

        while (hasMore) {
            let path = `/open-apis/bitable/v1/apps/${CONFIG.BASE_TOKEN}/tables/${tableId}/records?page_size=100`;
            if (pageToken) path += `&page_token=${pageToken}`;
            if (options.view_id) path += `&view_id=${options.view_id}`;

            const data = await this.request('GET', path);
            if (!data) break;

            if (data.items) {
                records.push(...data.items.map(item => ({
                    record_id: item.record_id,
                    fields: item.fields
                })));
            }
            hasMore = data.has_more;
            pageToken = data.page_token || '';
        }
        return records;
    },

    // 搜索记录
    async searchRecords(tableName, filter = {}) {
        const tableId = this.tableIds[tableName] || CONFIG.TABLE_IDS[tableName];
        if (!tableId) return [];

        const body = { page_size: 100 };
        if (filter.filter) body.filter = filter.filter;
        if (filter.sort) body.sort = filter.sort;

        const data = await this.request('POST',
            `/open-apis/bitable/v1/apps/${CONFIG.BASE_TOKEN}/tables/${tableId}/records/search`,
            body);

        if (!data || !data.items) return [];
        return data.items.map(item => ({
            record_id: item.record_id,
            fields: item.fields
        }));
    },

    // 创建记录
    async createRecord(tableName, fields) {
        const tableId = this.tableIds[tableName] || CONFIG.TABLE_IDS[tableName];
        if (!tableId) return null;

        return await this.request('POST',
            `/open-apis/bitable/v1/apps/${CONFIG.BASE_TOKEN}/tables/${tableId}/records`,
            { fields });
    },

    // 更新记录
    async updateRecord(tableName, recordId, fields) {
        const tableId = this.tableIds[tableName] || CONFIG.TABLE_IDS[tableName];
        if (!tableId) return null;

        return await this.request('PUT',
            `/open-apis/bitable/v1/apps/${CONFIG.BASE_TOKEN}/tables/${tableId}/records/${recordId}`,
            { fields });
    },

    // 删除记录
    async deleteRecord(tableName, recordId) {
        const tableId = this.tableIds[tableName] || CONFIG.TABLE_IDS[tableName];
        if (!tableId) return null;

        return await this.request('DELETE',
            `/open-apis/bitable/v1/apps/${CONFIG.BASE_TOKEN}/tables/${tableId}/records/${recordId}`);
    },

    // 批量创建记录
    async batchCreateRecords(tableName, records) {
        const tableId = this.tableIds[tableName] || CONFIG.TABLE_IDS[tableName];
        if (!tableId) return null;

        return await this.request('POST',
            `/open-apis/bitable/v1/apps/${CONFIG.BASE_TOKEN}/tables/${tableId}/records/batch_create`,
            { records: records.map(r => ({ fields: r })) });
    },

    // ===== 便捷方法 =====

    // 获取宏观数据（手动）
    async getMacroManual() {
        return await this.readAllRecords('宏观数据_手动');
    },

    // 获取宏观数据（自动）
    async getMacroAuto() {
        return await this.readAllRecords('宏观数据_自动');
    },

    // 获取持仓数据
    async getHoldings() {
        return await this.readAllRecords('持仓数据');
    },

    // 获取交易记录
    async getTrades() {
        return await this.readAllRecords('交易记录');
    },

    // 获取指数估值数据
    async getValuation() {
        return await this.readAllRecords('指数估值数据');
    },

    // 获取规则参数
    async getRuleParams() {
        return await this.readAllRecords('规则参数配置');
    },

    // 获取股票历史数据
    async getStockHistory(code) {
        return await this.searchRecords('股票历史数据', {
            filter: {
                conjunction: 'and',
                children: [{
                    field_name: '代码',
                    operator: 'is',
                    value: [code]
                }]
            }
        });
    }
};
