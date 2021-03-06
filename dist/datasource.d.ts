import * as Druid from 'druid.d';
interface Table {
    type: string;
    columns: any[];
    rows: any[];
}
export default class DruidDatasource {
    id: number;
    name: string;
    url: string;
    q: any;
    backendSrv: any;
    templateSrv: any;
    basicAuth: any;
    supportMetrics: any;
    periodGranularity: any;
    GRANULARITIES: any[][];
    filterTemplateExpanders: {
        "selector": string[];
        "regex": string[];
        "javascript": string[];
        "search": string[];
        "in": string[];
    };
    aggregationTemplateExpanders: {
        "count": any[];
        "cardinality": string[];
        "longSum": string[];
        "doubleSum": string[];
        "approxHistogramFold": string[];
        "hyperUnique": string[];
        "thetaSketch": string[];
    };
    constructor(instanceSettings: any, $q: any, backendSrv: any, templateSrv: any);
    metricFindQuery(query: string, options?: any): any;
    query(options: any): any;
    doQuery(from: any, to: any, granularity: any, target: any, scopedVars: any): any;
    splitCardinalityFields(aggregator: any): any;
    selectQuery(scopedVars: any, datasource: string, intervals: Array<string>, granularity: Druid.Granularity, dimensions: Array<string | Object>, metric: Array<string | Object>, filters: Array<Druid.DruidFilter>, selectThreshold: Object): any;
    timeSeriesQuery(scopedVars: any, datasource: string, intervals: Array<string>, granularity: Druid.Granularity, filters: Array<Druid.DruidFilter>, aggregators: Object, postAggregators: Object): any;
    topNQuery(scopedVars: any, datasource: string, intervals: Array<string>, granularity: Druid.Granularity, filters: Array<Druid.DruidFilter>, aggregators: Object, postAggregators: Object, threshold: number, metric: string | Object, dimension: string | Object): any;
    groupByQuery(scopedVars: any, datasource: string, intervals: Array<string>, granularity: Druid.Granularity, filters: Array<Druid.DruidFilter>, aggregators: Object, postAggregators: Object, groupBy: Array<string>, limitSpec: Druid.LimitSpec): any;
    druidQuery(query: Druid.AbstractDruidQuery): any;
    getLimitSpec(limitNum: any, orderBy: any): {
        "type": string;
        "limit": any;
        "columns": any;
    };
    testDatasource(): any;
    getDataSources(): any;
    getDimensionsAndMetrics(datasource: any): any;
    getFilterValues(target: any, panelRange: any, query: any): any;
    get(relativeUrl: any, params?: any): any;
    buildFilterTree(filters: any, scopedVars: any): Druid.DruidFilter;
    getQueryIntervals(from: any, to: any): string[];
    getMetricNames(aggregators: any, postAggregators: any): any;
    formatTimestamp(ts: any): number;
    convertTimeSeriesData(md: any, metrics: any, targetFormat: any): any;
    convertTimeSeriesDataToTable(md: any, metrics: any): Table;
    convertTimeSeriesDataToTimeSeries(md: any, metrics: any): any;
    getGroupName(groupBy: any, metric: any): any;
    convertTopNData(md: any, dimension: any, metric: any, targetFormat: any): any;
    convertTopNDataToTable(md: any, dimension: any, metric: any): Table;
    convertTopNDataToTimeSeries(md: any, dimension: any, metric: any): any;
    convertGroupByData(md: any, groupBy: any, metrics: any, resultFormat: any): any;
    convertGroupByDataToTable(md: any, groupBy: any, metrics: any): Table;
    convertGroupByDataToTimeSeries(md: any, groupBy: any, metrics: any): any;
    convertSelectData(data: any, targetFormat: any): any;
    convertSelectDataToTable(data: any): Table;
    convertSelectDataToTimeSeries(data: any): any;
    dateToMoment(date: any, roundUp: any): any;
    computeGranularity(from: any, to: any, maxDataPoints: any): any;
    roundUpStartTime(from: any, granularity: any): any;
    replaceTemplateValues(obj: any, scopedVars: any, attrList: any): any;
    arrayFormat(value: any): any;
}
export {};
