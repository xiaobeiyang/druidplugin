System.register(["lodash", "moment", "app/core/utils/datemath"], function (exports_1, context_1) {
    "use strict";
    var lodash_1, moment_1, dateMath, DRUID_DATASOURCE_PATH, SPLITER, DruidDatasource;
    var __moduleName = context_1 && context_1.id;
    return {
        setters: [
            function (lodash_1_1) {
                lodash_1 = lodash_1_1;
            },
            function (moment_1_1) {
                moment_1 = moment_1_1;
            },
            function (dateMath_1) {
                dateMath = dateMath_1;
            }
        ],
        execute: function () {
            DRUID_DATASOURCE_PATH = '/druid/v2/datasources/';
            SPLITER = '\u001f';
            DruidDatasource = (function () {
                function DruidDatasource(instanceSettings, $q, backendSrv, templateSrv) {
                    this.GRANULARITIES = [
                        ['second', moment_1.default.duration(1, 'second')],
                        ['minute', moment_1.default.duration(1, 'minute')],
                        ['fifteen_minute', moment_1.default.duration(15, 'minute')],
                        ['thirty_minute', moment_1.default.duration(30, 'minute')],
                        ['hour', moment_1.default.duration(1, 'hour')],
                        ['day', moment_1.default.duration(1, 'day')],
                        ['week', moment_1.default.duration(1, 'week')],
                        ['month', moment_1.default.duration(1, 'month')],
                        ['quarter', moment_1.default.duration(1, 'quarter')],
                        ['year', moment_1.default.duration(1, 'year')]
                    ];
                    this.filterTemplateExpanders = {
                        "selector": ['dimension', 'value'],
                        "regex": ['dimension', 'pattern'],
                        "javascript": ['dimension', 'function'],
                        "search": ['dimension', 'query.type', 'query.value'],
                        "in": ['dimension', 'values']
                    };
                    this.aggregationTemplateExpanders = {
                        "count": [],
                        "cardinality": ['fieldName'],
                        "longSum": ['fieldName'],
                        "doubleSum": ['fieldName'],
                        "approxHistogramFold": ['fieldName'],
                        "hyperUnique": ['fieldName'],
                        "thetaSketch": ['fieldName']
                    };
                    this.name = instanceSettings.name;
                    this.id = instanceSettings.id;
                    this.url = instanceSettings.url;
                    this.backendSrv = backendSrv;
                    this.q = $q;
                    this.templateSrv = templateSrv;
                    this.basicAuth = instanceSettings.basicAuth;
                    instanceSettings.jsonData = instanceSettings.jsonData || {};
                    this.supportMetrics = true;
                    this.periodGranularity = instanceSettings.jsonData.periodGranularity;
                }
                DruidDatasource.prototype.metricFindQuery = function (query, options) {
                    var interpolated = this.templateSrv.replace(query, options.scopedVars, 'pipe');
                    var req = {
                        method: 'POST',
                        url: this.url + '/druid/v2/sql/',
                        data: { query: interpolated }
                    };
                    var values = new Set();
                    return this.backendSrv.datasourceRequest(req).then(function (response) {
                        response.data.forEach(function (r) {
                            if (r.__value !== undefined) {
                                values.add({ value: r.__value, text: r.__text });
                            }
                        });
                        return Array.from(values.values());
                    });
                };
                DruidDatasource.prototype.query = function (options) {
                    var _this = this;
                    var from = this.dateToMoment(options.range.from, false);
                    var to = this.dateToMoment(options.range.to, true);
                    var promises = options.targets.map(function (target) {
                        if (target.hide === true || lodash_1.default.isEmpty(target.druidDS) || (lodash_1.default.isEmpty(target.aggregators) && target.queryType !== "select")) {
                            var d = _this.q.defer();
                            d.resolve([]);
                            return d.promise;
                        }
                        var maxDataPointsByResolution = options.maxDataPoints;
                        var maxDataPointsByConfig = target.maxDataPoints ? target.maxDataPoints : Number.MAX_VALUE;
                        var maxDataPoints = Math.min(maxDataPointsByResolution, maxDataPointsByConfig);
                        var granularity = target.shouldOverrideGranularity ?
                            _this.templateSrv.replace(target.customGranularity, options.scopedVars) :
                            _this.computeGranularity(from, to, maxDataPoints);
                        var roundedFrom = granularity === "all" ? from : _this.roundUpStartTime(from, granularity);
                        if (_this.periodGranularity != "") {
                            if (granularity === 'day') {
                                granularity = { "type": "period", "period": "P1D", "timeZone": _this.periodGranularity };
                            }
                        }
                        if (typeof target.groupBy !== 'string') {
                            target.groupBy = '';
                        }
                        return _this.doQuery(roundedFrom, to, granularity, target, options.scopedVars);
                    });
                    return this.q.all(promises).then(function (results) {
                        return { data: lodash_1.default.flatten(results) };
                    });
                };
                DruidDatasource.prototype.doQuery = function (from, to, granularity, target, scopedVars) {
                    var _this = this;
                    target = lodash_1.default.cloneDeep(target);
                    var datasource = target.druidDS;
                    if (target.dimension) {
                        target.dimension = this.templateSrv.replace(target.dimension, scopedVars);
                    }
                    if (target.druidMetric) {
                        target.druidMetric = this.templateSrv.replace(target.druidMetric, scopedVars);
                    }
                    var filters = target.filters;
                    var aggregators = target.aggregators.map(function (aggr) {
                        return _this.replaceTemplateValues(aggr, scopedVars, _this.aggregationTemplateExpanders[aggr.type]);
                    }).map(this.splitCardinalityFields);
                    var postAggregators = lodash_1.default.map(target.postAggregators, function (postAggregator) {
                        if (postAggregator.type === "arithmetic") {
                            delete postAggregator.fieldsNames;
                        }
                        return postAggregator;
                    });
                    var limitSpec = null;
                    var metricNames = this.getMetricNames(aggregators, postAggregators);
                    var intervals = this.getQueryIntervals(from, to);
                    var promise = null;
                    var selectMetrics = target.selectMetrics === undefined ? undefined : target.selectMetrics.map(function (m) {
                        return _this.templateSrv.replace(m, scopedVars);
                    });
                    var selectDimensions = target.selectDimensions === undefined ? undefined : target.selectDimensions.map(function (d) {
                        return _this.templateSrv.replace(d, scopedVars);
                    });
                    var selectThreshold = target.selectThreshold;
                    if (!selectThreshold) {
                        selectThreshold = 5;
                    }
                    if (target.queryType === 'topN') {
                        var threshold = target.limit;
                        var metric_1 = target.druidMetric;
                        var dimension_1 = this.templateSrv.replace(target.dimension, scopedVars);
                        promise = this.topNQuery(scopedVars, datasource, intervals, granularity, filters, aggregators, postAggregators, threshold, metric_1, dimension_1)
                            .then(function (response) {
                            return _this.convertTopNData(response.data, dimension_1, metric_1, target.resultFormat);
                        });
                    }
                    else if (target.queryType === 'groupBy') {
                        var groupBy_1 = lodash_1.default.split(this.templateSrv.replace(lodash_1.default.replace(target.groupBy, /,/g, SPLITER), scopedVars, this.arrayFormat), SPLITER);
                        if (target.orderBy) {
                            target.orderBy = lodash_1.default.split(this.templateSrv.replace(lodash_1.default.replace(target.orderBy, /,/g, SPLITER), scopedVars, this.arrayFormat), SPLITER);
                        }
                        limitSpec = this.getLimitSpec(target.limit, target.orderBy);
                        promise = this.groupByQuery(scopedVars, datasource, intervals, granularity, filters, aggregators, postAggregators, groupBy_1, limitSpec)
                            .then(function (response) {
                            return _this.convertGroupByData(response.data, groupBy_1, metricNames, target.resultFormat);
                        });
                    }
                    else if (target.queryType === 'select') {
                        promise = this.selectQuery(scopedVars, datasource, intervals, granularity, selectDimensions, selectMetrics, filters, selectThreshold)
                            .then(function (response) {
                            return _this.convertSelectData(response.data, target.resultFormat);
                        });
                    }
                    else {
                        promise = this.timeSeriesQuery(scopedVars, datasource, intervals, granularity, filters, aggregators, postAggregators)
                            .then(function (response) {
                            return _this.convertTimeSeriesData(response.data, metricNames, target.resultFormat);
                        });
                    }
                    return promise.then(function (metrics) {
                        var fromMs = _this.formatTimestamp(from);
                        if (target.resultFormat === 'table') {
                            metrics.rows.forEach(function (row) {
                                if (row[0] < fromMs) {
                                    row[0] = fromMs;
                                }
                            });
                            return metrics;
                        }
                        metrics.forEach(function (metric) {
                            if (!lodash_1.default.isEmpty(metric.datapoints[0]) && metric.datapoints[0][1] < fromMs) {
                                metric.datapoints[0][1] = fromMs;
                            }
                        });
                        return metrics;
                    });
                };
                ;
                DruidDatasource.prototype.splitCardinalityFields = function (aggregator) {
                    if (aggregator.type === 'cardinality' && typeof aggregator.fieldNames === 'string') {
                        aggregator.fieldNames = aggregator.fieldNames.split(',');
                    }
                    return aggregator;
                };
                DruidDatasource.prototype.selectQuery = function (scopedVars, datasource, intervals, granularity, dimensions, metric, filters, selectThreshold) {
                    var query = {
                        "queryType": "select",
                        "dataSource": datasource,
                        "granularity": granularity,
                        "pagingSpec": { "pagingIdentifiers": {}, "threshold": selectThreshold },
                        "dimensions": dimensions,
                        "metrics": metric,
                        "intervals": intervals
                    };
                    if (filters && filters.length > 0) {
                        query.filter = this.buildFilterTree(filters, scopedVars);
                    }
                    return this.druidQuery(query);
                };
                ;
                DruidDatasource.prototype.timeSeriesQuery = function (scopedVars, datasource, intervals, granularity, filters, aggregators, postAggregators) {
                    var query = {
                        queryType: "timeseries",
                        dataSource: datasource,
                        granularity: granularity,
                        aggregations: aggregators,
                        postAggregations: postAggregators,
                        intervals: intervals
                    };
                    if (filters && filters.length > 0) {
                        query.filter = this.buildFilterTree(filters, scopedVars);
                    }
                    return this.druidQuery(query);
                };
                ;
                DruidDatasource.prototype.topNQuery = function (scopedVars, datasource, intervals, granularity, filters, aggregators, postAggregators, threshold, metric, dimension) {
                    var query = {
                        queryType: "topN",
                        dataSource: datasource,
                        granularity: granularity,
                        threshold: threshold,
                        dimension: dimension,
                        metric: metric,
                        aggregations: aggregators,
                        postAggregations: postAggregators,
                        intervals: intervals
                    };
                    if (filters && filters.length > 0) {
                        query.filter = this.buildFilterTree(filters, scopedVars);
                    }
                    return this.druidQuery(query);
                };
                ;
                DruidDatasource.prototype.groupByQuery = function (scopedVars, datasource, intervals, granularity, filters, aggregators, postAggregators, groupBy, limitSpec) {
                    var query = {
                        queryType: "groupBy",
                        dataSource: datasource,
                        granularity: granularity,
                        dimensions: groupBy,
                        aggregations: aggregators,
                        postAggregations: postAggregators,
                        intervals: intervals,
                        limitSpec: limitSpec,
                    };
                    if (filters && filters.length > 0) {
                        query.filter = this.buildFilterTree(filters, scopedVars);
                    }
                    return this.druidQuery(query);
                };
                ;
                DruidDatasource.prototype.druidQuery = function (query) {
                    var options = {
                        method: 'POST',
                        url: this.url + '/druid/v2/',
                        data: query
                    };
                    return this.backendSrv.datasourceRequest(options);
                };
                ;
                DruidDatasource.prototype.getLimitSpec = function (limitNum, orderBy) {
                    return {
                        "type": "default",
                        "limit": limitNum,
                        "columns": !orderBy ? null : orderBy.map(function (col) {
                            return { "dimension": col, "direction": "DESCENDING" };
                        })
                    };
                };
                DruidDatasource.prototype.testDatasource = function () {
                    return this.get(DRUID_DATASOURCE_PATH).then(function () {
                        return { status: "success", message: "Druid Data source is working", title: "Success" };
                    });
                };
                DruidDatasource.prototype.getDataSources = function () {
                    return this.get(DRUID_DATASOURCE_PATH).then(function (response) {
                        return response.data;
                    });
                };
                ;
                DruidDatasource.prototype.getDimensionsAndMetrics = function (datasource) {
                    return this.get(DRUID_DATASOURCE_PATH + datasource).then(function (response) {
                        return response.data;
                    });
                };
                ;
                DruidDatasource.prototype.getFilterValues = function (target, panelRange, query) {
                    var topNquery = {
                        "queryType": "topN",
                        "dataSource": target.druidDS,
                        "granularity": 'all',
                        "threshold": 10,
                        "dimension": target.currentFilter.dimension,
                        "metric": "count",
                        "aggregations": [{ "type": "count", "name": "count" }],
                        "intervals": this.getQueryIntervals(panelRange.from, panelRange.to)
                    };
                    var filters = [];
                    if (target.filters) {
                        filters =
                            filters = lodash_1.default.cloneDeep(target.filters);
                    }
                    filters.push({
                        "type": "search",
                        "dimension": target.currentFilter.dimension,
                        "query": {
                            "type": "insensitive_contains",
                            "value": query
                        }
                    });
                    topNquery.filter = this.buildFilterTree(filters, {});
                    return this.druidQuery(topNquery);
                };
                ;
                DruidDatasource.prototype.get = function (relativeUrl, params) {
                    return this.backendSrv.datasourceRequest({
                        method: 'GET',
                        url: this.url + relativeUrl,
                        params: params,
                    });
                };
                ;
                DruidDatasource.prototype.buildFilterTree = function (filters, scopedVars) {
                    var _this = this;
                    var replacedFilters = filters.map(function (filter) {
                        return _this.replaceTemplateValues(filter, scopedVars, _this.filterTemplateExpanders[filter.type]);
                    })
                        .map(function (filter) {
                        var finalFilter = lodash_1.default.omit(filter, 'negate');
                        if (filter.negate) {
                            return { "type": "not", "field": finalFilter };
                        }
                        return finalFilter;
                    });
                    if (replacedFilters) {
                        if (replacedFilters.length === 1) {
                            return replacedFilters[0];
                        }
                        return {
                            "type": "and",
                            "fields": replacedFilters
                        };
                    }
                    return null;
                };
                DruidDatasource.prototype.getQueryIntervals = function (from, to) {
                    return [from.toISOString() + '/' + to.toISOString()];
                };
                DruidDatasource.prototype.getMetricNames = function (aggregators, postAggregators) {
                    var displayAggs = lodash_1.default.filter(aggregators, function (agg) {
                        return agg.type !== 'approxHistogramFold' && agg.hidden != true;
                    });
                    return lodash_1.default.union(lodash_1.default.map(displayAggs, 'name'), lodash_1.default.map(postAggregators, 'name'));
                };
                DruidDatasource.prototype.formatTimestamp = function (ts) {
                    return moment_1.default(ts).format('X') * 1000;
                };
                DruidDatasource.prototype.convertTimeSeriesData = function (md, metrics, targetFormat) {
                    if (targetFormat === 'table') {
                        return this.convertTimeSeriesDataToTable(md, metrics);
                    }
                    else {
                        return this.convertTimeSeriesDataToTimeSeries(md, metrics);
                    }
                };
                DruidDatasource.prototype.convertTimeSeriesDataToTable = function (md, metrics) {
                    var _this = this;
                    var table = { type: 'table', columns: [], rows: [] };
                    table.columns = [
                        { text: 'Time', id: '_time' }
                    ].concat(metrics.map(function (m) { return { text: m, id: m }; }));
                    table.rows = md.map(function (item) {
                        var row = [_this.formatTimestamp(item.timestamp)];
                        metrics.forEach(function (m) {
                            row.push(item.result[m]);
                        });
                        return row;
                    });
                    return table;
                };
                DruidDatasource.prototype.convertTimeSeriesDataToTimeSeries = function (md, metrics) {
                    var _this = this;
                    return metrics.map(function (metric) {
                        return {
                            target: metric,
                            datapoints: md.map(function (item) {
                                return [
                                    item.result[metric],
                                    _this.formatTimestamp(item.timestamp)
                                ];
                            })
                        };
                    });
                };
                DruidDatasource.prototype.getGroupName = function (groupBy, metric) {
                    return groupBy.map(function (dim) {
                        return metric.event[dim];
                    })
                        .join("-");
                };
                DruidDatasource.prototype.convertTopNData = function (md, dimension, metric, targetFormat) {
                    if (targetFormat === 'table') {
                        return this.convertTopNDataToTable(md, dimension, metric);
                    }
                    else {
                        return this.convertTopNDataToTimeSeries(md, dimension, metric);
                    }
                };
                DruidDatasource.prototype.convertTopNDataToTable = function (md, dimension, metric) {
                    var _this = this;
                    var table = { type: 'table', columns: [], rows: [] };
                    table.columns = [
                        { text: 'Time', id: '_time' },
                        { text: dimension, id: dimension },
                        { text: metric, id: metric }
                    ];
                    md.forEach(function (item) {
                        item.result.forEach(function (r) {
                            var row = [_this.formatTimestamp(item.timestamp)];
                            row.push(r[dimension]);
                            row.push(r[metric]);
                            table.rows.push(row);
                        });
                    });
                    return table;
                };
                DruidDatasource.prototype.convertTopNDataToTimeSeries = function (md, dimension, metric) {
                    var _this = this;
                    var dVals = md.reduce(function (dValsSoFar, tsItem) {
                        var dValsForTs = lodash_1.default.map(tsItem.result, dimension);
                        return lodash_1.default.union(dValsSoFar, dValsForTs);
                    }, {});
                    md.forEach(function (tsItem) {
                        var dValsPresent = lodash_1.default.map(tsItem.result, dimension);
                        var dValsMissing = lodash_1.default.difference(dVals, dValsPresent);
                        dValsMissing.forEach(function (dVal) {
                            var nullPoint = {};
                            nullPoint[dimension] = dVal;
                            nullPoint[metric] = null;
                            tsItem.result.push(nullPoint);
                        });
                        return tsItem;
                    });
                    var mergedData = md.map(function (item) {
                        var timestamp = _this.formatTimestamp(item.timestamp);
                        var keys = lodash_1.default.map(item.result, dimension);
                        var vals = lodash_1.default.map(item.result, metric).map(function (val) { return [val, timestamp]; });
                        return lodash_1.default.zipObject(keys, vals);
                    })
                        .reduce(function (prev, curr) {
                        return lodash_1.default.assignWith(prev, curr, function (pVal, cVal) {
                            if (pVal) {
                                pVal.push(cVal);
                                return pVal;
                            }
                            return [cVal];
                        });
                    }, {});
                    return lodash_1.default.map(mergedData, function (vals, key) {
                        return {
                            target: key,
                            datapoints: vals
                        };
                    });
                };
                DruidDatasource.prototype.convertGroupByData = function (md, groupBy, metrics, resultFormat) {
                    if (resultFormat === 'table') {
                        return this.convertGroupByDataToTable(md, groupBy, metrics);
                    }
                    else {
                        return this.convertGroupByDataToTimeSeries(md, groupBy, metrics);
                    }
                };
                DruidDatasource.prototype.convertGroupByDataToTable = function (md, groupBy, metrics) {
                    var _this = this;
                    var table = { type: 'table', columns: [], rows: [] };
                    var firstColumns = [
                        { text: 'Time', id: '_time' },
                    ];
                    table.columns = firstColumns.concat(groupBy.map(function (g) { return { id: g, text: g }; }), metrics.map(function (m) { return { id: m, text: m }; }));
                    table.rows = md.map(function (item) {
                        var row = [_this.formatTimestamp(item.timestamp)];
                        groupBy.forEach(function (g) { return row.push(item.event[g]); });
                        metrics.forEach(function (m) { return row.push(item.event[m]); });
                        return row;
                    });
                    return table;
                };
                DruidDatasource.prototype.convertGroupByDataToTimeSeries = function (md, groupBy, metrics) {
                    var _this = this;
                    var mergedData = md.map(function (item) {
                        var groupName = _this.getGroupName(groupBy, item);
                        var keys = metrics.map(function (metric) {
                            return groupName + ": " + metric;
                        });
                        var vals = metrics.map(function (metric) {
                            return [
                                item.event[metric],
                                _this.formatTimestamp(item.timestamp)
                            ];
                        });
                        return lodash_1.default.zipObject(keys, vals);
                    })
                        .reduce(function (prev, curr) {
                        return lodash_1.default.assignWith(prev, curr, function (pVal, cVal) {
                            if (pVal) {
                                pVal.push(cVal);
                                return pVal;
                            }
                            return [cVal];
                        });
                    }, {});
                    return lodash_1.default.map(mergedData, function (vals, key) {
                        return {
                            target: key,
                            datapoints: vals
                        };
                    });
                };
                DruidDatasource.prototype.convertSelectData = function (data, targetFormat) {
                    if (targetFormat === 'table') {
                        return this.convertSelectDataToTable(data);
                    }
                    else {
                        return this.convertSelectDataToTimeSeries(data);
                    }
                };
                DruidDatasource.prototype.convertSelectDataToTable = function (data) {
                    var resultList = lodash_1.default.map(data, "result");
                    var dimensions = lodash_1.default.uniq(lodash_1.default.flattenDeep(lodash_1.default.map(resultList, "dimensions")));
                    var metrics = lodash_1.default.uniq(lodash_1.default.flattenDeep(lodash_1.default.map(resultList, "metrics")));
                    var eventsList = lodash_1.default.map(resultList, "events");
                    var eventList = lodash_1.default.flatten(eventsList);
                    var table = { type: 'table', columns: [], rows: [] };
                    var columns = [
                        { text: 'Time', id: '_time' },
                    ];
                    dimensions.forEach(function (d) {
                        columns.push({ text: d, id: d });
                    });
                    metrics.forEach(function (m) {
                        columns.push({ text: m, id: m });
                    });
                    table.columns = columns;
                    var _loop_1 = function (i) {
                        var event_1 = eventList[i].event;
                        var timestamp = event_1.timestamp;
                        if (lodash_1.default.isEmpty(timestamp)) {
                            return "continue";
                        }
                        var row = [this_1.formatTimestamp(event_1.timestamp)];
                        dimensions.forEach(function (d) { row.push(event_1[d]); });
                        metrics.forEach(function (m) { return row.push(event_1[m]); });
                        table.rows.push(row);
                    };
                    var this_1 = this;
                    for (var i = 0; i < eventList.length; i++) {
                        _loop_1(i);
                    }
                    return table;
                };
                DruidDatasource.prototype.convertSelectDataToTimeSeries = function (data) {
                    var resultList = lodash_1.default.map(data, "result");
                    var eventsList = lodash_1.default.map(resultList, "events");
                    var eventList = lodash_1.default.flatten(eventsList);
                    var result = {};
                    for (var i = 0; i < eventList.length; i++) {
                        var event_2 = eventList[i].event;
                        var timestamp = event_2.timestamp;
                        if (lodash_1.default.isEmpty(timestamp)) {
                            continue;
                        }
                        for (var key in event_2) {
                            if (key !== "timestamp") {
                                if (!result[key]) {
                                    result[key] = { "target": key, "datapoints": [] };
                                }
                                result[key].datapoints.push([event_2[key], timestamp]);
                            }
                        }
                    }
                    return lodash_1.default.values(result);
                };
                DruidDatasource.prototype.dateToMoment = function (date, roundUp) {
                    if (date === 'now') {
                        return moment_1.default();
                    }
                    date = dateMath.parse(date, roundUp);
                    return moment_1.default(date.valueOf());
                };
                DruidDatasource.prototype.computeGranularity = function (from, to, maxDataPoints) {
                    var intervalSecs = to.unix() - from.unix();
                    var granularityEntry = lodash_1.default.find(this.GRANULARITIES, function (gEntry) {
                        return Math.ceil(intervalSecs / gEntry[1].asSeconds()) <= maxDataPoints;
                    });
                    return granularityEntry[0];
                };
                DruidDatasource.prototype.roundUpStartTime = function (from, granularity) {
                    var duration = lodash_1.default.find(this.GRANULARITIES, function (gEntry) {
                        return gEntry[0] === granularity;
                    })[1];
                    var rounded = null;
                    if (granularity === 'day') {
                        rounded = moment_1.default(+from).startOf('day');
                    }
                    else {
                        rounded = moment_1.default(Math.ceil((+from) / (+duration)) * (+duration));
                    }
                    return rounded;
                };
                DruidDatasource.prototype.replaceTemplateValues = function (obj, scopedVars, attrList) {
                    var _this = this;
                    var substitutedVals = attrList.map(function (attr) {
                        if (obj.type == 'in' && attr == 'values') {
                            return lodash_1.default.split(_this.templateSrv.replace(lodash_1.default.replace(lodash_1.default.get(obj, attr), /,/g, SPLITER), scopedVars, _this.arrayFormat), SPLITER);
                        }
                        else {
                            return _this.templateSrv.replace(lodash_1.default.get(obj, attr), scopedVars);
                        }
                    });
                    return lodash_1.default.assign(lodash_1.default.clone(obj, true), lodash_1.default.zipObjectDeep(attrList, substitutedVals));
                };
                DruidDatasource.prototype.arrayFormat = function (value) {
                    if (lodash_1.default.isArray(value)) {
                        return value.join(SPLITER);
                    }
                    return value;
                };
                return DruidDatasource;
            }());
            exports_1("default", DruidDatasource);
        }
    };
});
//# sourceMappingURL=datasource.js.map