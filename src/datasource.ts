///<reference path="../node_modules/grafana-sdk-mocks/app/headers/common.d.ts" />

import _ from 'lodash';
import moment from 'moment';
import * as dateMath from 'app/core/utils/datemath';
import * as Druid from 'druid.d'

const DRUID_DATASOURCE_PATH = '/druid/v2/datasources/';
const SPLITER = '\u001f';

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
  GRANULARITIES = [
    ['second', moment.duration(1, 'second')],
    ['minute', moment.duration(1, 'minute')],
    ['fifteen_minute', moment.duration(15, 'minute')],
    ['thirty_minute', moment.duration(30, 'minute')],
    ['hour', moment.duration(1, 'hour')],
    ['day', moment.duration(1, 'day')],
    ['week', moment.duration(1, 'week')],
    ['month', moment.duration(1, 'month')],
    ['quarter', moment.duration(1, 'quarter')],
    ['year', moment.duration(1, 'year')]
  ];
  filterTemplateExpanders = {
    "selector": ['dimension', 'value'],
    "regex": ['dimension', 'pattern'],
    "javascript": ['dimension', 'function'],
    "search": ['dimension', 'query.type', 'query.value'],
    "in": ['dimension', 'values']
  };
  aggregationTemplateExpanders = {
    "count": [],
    "cardinality": ['fieldName'],
    "longSum": ['fieldName'],
    "doubleSum": ['fieldName'],
    "approxHistogramFold": ['fieldName'],
    "hyperUnique": ['fieldName'],
    "thetaSketch": ['fieldName']
  };


  /** @ngInject */
  constructor(instanceSettings, $q, backendSrv, templateSrv) {
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

  metricFindQuery(query: string, options?: any) {
    const interpolated = this.templateSrv.replace(query, options.scopedVars, 'pipe');
      let req: any = {
        method: 'POST',
        url: this.url + '/druid/v2/sql/',
        data: {query: interpolated}
      };
      let values = new Set();
      return this.backendSrv.datasourceRequest(req).then(response => {
        response.data.forEach(r => {
            if (r.__value !== undefined) {
                values.add({value: r.__value, text: r.__text});
            }
        })
        return Array.from(values.values());
      });
  }

  query(options) {
    const from = this.dateToMoment(options.range.from, false);
    const to = this.dateToMoment(options.range.to, true);
    let promises = options.targets.map(target => {
      if (target.hide === true || _.isEmpty(target.druidDS) || (_.isEmpty(target.aggregators) && target.queryType !== "select")) {
        const d = this.q.defer();
        d.resolve([]);
        return d.promise;
      }
      const maxDataPointsByResolution = options.maxDataPoints;
      const maxDataPointsByConfig = target.maxDataPoints ? target.maxDataPoints : Number.MAX_VALUE;
      const maxDataPoints = Math.min(maxDataPointsByResolution, maxDataPointsByConfig);
      let granularity = target.shouldOverrideGranularity ?
        this.templateSrv.replace(target.customGranularity, options.scopedVars) :
        this.computeGranularity(from, to, maxDataPoints);
      //Round up to start of an interval
      //Width of bar chars in Grafana is determined by size of the smallest interval
      const roundedFrom = granularity === "all" ? from : this.roundUpStartTime(from, granularity);
      if (this.periodGranularity != "") {
        if (granularity === 'day') {
          granularity = { "type": "period", "period": "P1D", "timeZone": this.periodGranularity }
        }
      }
      // ignore default groupBy of grafana
      if (typeof target.groupBy !== 'string') {
        target.groupBy = ''
      }
      return this.doQuery(roundedFrom, to, granularity, target, options.scopedVars);
    });

    return this.q.all(promises).then(results => {
      return { data: _.flatten(results) };
    });
  }

  doQuery(from, to, granularity, target, scopedVars) {
    target = _.cloneDeep(target);
    let datasource = target.druidDS;
    if (target.dimension) {
        target.dimension = this.templateSrv.replace(target.dimension, scopedVars)
    }
    if (target.druidMetric) {
        target.druidMetric = this.templateSrv.replace(target.druidMetric, scopedVars)
    }
    let filters = target.filters;
    let aggregators = target.aggregators.map(aggr => {
        return this.replaceTemplateValues(aggr, scopedVars, this.aggregationTemplateExpanders[aggr.type]);
    }).map(this.splitCardinalityFields);
    let postAggregators = target.postAggregators;
    let limitSpec = null;
    let metricNames = this.getMetricNames(aggregators, postAggregators);
    let intervals = this.getQueryIntervals(from, to);
    let promise = null;

    let selectMetrics = target.selectMetrics === undefined ? undefined : target.selectMetrics.map(m => {
        return this.templateSrv.replace(m, scopedVars);
    });
    let selectDimensions = target.selectDimensions === undefined ? undefined : target.selectDimensions.map(d => {
        return this.templateSrv.replace(d, scopedVars);
    });
    let selectThreshold = target.selectThreshold;
    if (!selectThreshold) {
      selectThreshold = 5;
    }

    if (target.queryType === 'topN') {
      let threshold = target.limit;
      let metric = target.druidMetric;
      let dimension = this.templateSrv.replace(target.dimension, scopedVars);
      promise = this.topNQuery(scopedVars, datasource, intervals, granularity, filters, aggregators, postAggregators, threshold, metric, dimension)
        .then(response => {
          return this.convertTopNData(response.data, dimension, metric, target.resultFormat);
        });
    }
    else if (target.queryType === 'groupBy') {
      const groupBy = _.split(this.templateSrv.replace(
          _.replace(target.groupBy, ',', SPLITER),
          scopedVars, this.arrayFormat), SPLITER);
      if (target.orderBy) {
        target.orderBy = _.split(this.templateSrv.replace(
          _.replace(target.orderBy, ',', SPLITER),
          scopedVars, this.arrayFormat), SPLITER);
      }
      limitSpec = this.getLimitSpec(target.limit, target.orderBy);
      promise = this.groupByQuery(scopedVars, datasource, intervals, granularity, filters, aggregators, postAggregators, groupBy, limitSpec)
        .then(response => {
          return this.convertGroupByData(response.data, groupBy, metricNames, target.resultFormat);
        });
    }
    else if (target.queryType === 'select') {
      promise = this.selectQuery(scopedVars, datasource, intervals, granularity, selectDimensions, selectMetrics, filters, selectThreshold);
      return promise.then(response => {
        return this.convertSelectData(response.data, target.resultFormat);
      });
    }
    else {
      promise = this.timeSeriesQuery(scopedVars, datasource, intervals, granularity, filters, aggregators, postAggregators)
        .then(response => {
          return this.convertTimeSeriesData(response.data, metricNames, target.resultFormat);
        });
    }
    /*
      At this point the promise will return an list of time series of this form
    [
      {
        target: <metric name>,
        datapoints: [
          [<metric value>, <timestamp in ms>],
          ...
        ]
      },
      ...
    ]

    Druid calculates metrics based on the intervals specified in the query but returns a timestamp rounded down.
    We need to adjust the first timestamp in each time series
    */
    return promise.then(metrics => {
      let fromMs = this.formatTimestamp(from);
      if (target.resultFormat === 'table') {
        metrics.rows.forEach(row => {
            if (row[0] < fromMs) {
                row[0] = fromMs;
            }
        });
        return metrics;
      }
      metrics.forEach(metric => {
        if (!_.isEmpty(metric.datapoints[0]) && metric.datapoints[0][1] < fromMs) {
          metric.datapoints[0][1] = fromMs;
        }
      });
      return metrics;
    });
  };

  splitCardinalityFields(aggregator) {
    if (aggregator.type === 'cardinality' && typeof aggregator.fieldNames === 'string') {
      aggregator.fieldNames = aggregator.fieldNames.split(',')
    }
    return aggregator;
  }

  selectQuery(scopedVars, datasource: string, intervals: Array<string>, granularity: Druid.Granularity,
              dimensions: Array<string | Object>, metric: Array<string | Object>, filters: Array<Druid.DruidFilter>,
              selectThreshold: Object) {
    let query: Druid.DruidSelectQuery = {
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

  timeSeriesQuery(scopedVars, datasource: string, intervals: Array<string>, granularity: Druid.Granularity,
                  filters: Array<Druid.DruidFilter>, aggregators: Object, postAggregators: Object) {
    let query: Druid.DruidTimeSeriesQuery = {
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

  topNQuery(scopedVars, datasource: string, intervals: Array<string>, granularity: Druid.Granularity,
            filters: Array<Druid.DruidFilter>, aggregators: Object, postAggregators: Object,
            threshold: number, metric: string | Object, dimension: string | Object) {
    const query: Druid.DruidTopNQuery = {
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

  groupByQuery(scopedVars, datasource: string, intervals: Array<string>, granularity: Druid.Granularity,
               filters: Array<Druid.DruidFilter>, aggregators: Object, postAggregators: Object, groupBy: Array<string>,
               limitSpec: Druid.LimitSpec) {
    const query: Druid.DruidGroupByQuery = {
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

  druidQuery(query: Druid.AbstractDruidQuery) {
    const options = {
      method: 'POST',
      url: this.url + '/druid/v2/',
      data: query
    };
    return this.backendSrv.datasourceRequest(options);
  };

  getLimitSpec(limitNum, orderBy) {
    return {
      "type": "default",
      "limit": limitNum,
      "columns": !orderBy ? null : orderBy.map(col => {
        return { "dimension": col, "direction": "DESCENDING" };
      })
    };
  }

  testDatasource() {
    return this.get(DRUID_DATASOURCE_PATH).then(() => {
      return { status: "success", message: "Druid Data source is working", title: "Success" };
    });
  }

  //Get list of available datasources
  getDataSources() {
    return this.get(DRUID_DATASOURCE_PATH).then(response => {
      return response.data;
    });
  };

  getDimensionsAndMetrics(datasource) {
    return this.get(DRUID_DATASOURCE_PATH + datasource).then(response => {
      return response.data;
    });
  };

  getFilterValues(target, panelRange, query) {
    const topNquery: any = {
      "queryType": "topN",
      "dataSource": target.druidDS,
      "granularity": 'all',
      "threshold": 10,
      "dimension": target.currentFilter.dimension,
      "metric": "count",
      "aggregations": [{ "type": "count", "name": "count" }],
      "intervals": this.getQueryIntervals(panelRange.from, panelRange.to)
    };

    let filters = [];
    if (target.filters) {
      filters =
        filters = _.cloneDeep(target.filters);
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

  get(relativeUrl, params?) {
    return this.backendSrv.datasourceRequest({
      method: 'GET',
      url: this.url + relativeUrl,
      params: params,
    });
  };

  buildFilterTree(filters, scopedVars): Druid.DruidFilter {
    //Do template variable replacement
    const replacedFilters = filters.map(filter => {
      return this.replaceTemplateValues(filter, scopedVars, this.filterTemplateExpanders[filter.type]);
    })
      .map(filter => {
        const finalFilter = _.omit(filter, 'negate');
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
  }

  getQueryIntervals(from, to) {
    return [from.toISOString() + '/' + to.toISOString()];
  }

  getMetricNames(aggregators, postAggregators) {
    const displayAggs = _.filter(aggregators, agg => {
      return agg.type !== 'approxHistogramFold' && agg.hidden != true;
    });
    return _.union(_.map(displayAggs, 'name'), _.map(postAggregators, 'name'));
  }

  formatTimestamp(ts) {
    return moment(ts).format('X') * 1000;
  }

    convertTimeSeriesData(md, metrics, targetFormat) {
        if (targetFormat === 'table') {
            return this.convertTimeSeriesDataToTable(md, metrics);
        } else {
            return this.convertTimeSeriesDataToTimeSeries(md, metrics);
        }
    }

    convertTimeSeriesDataToTable(md, metrics) {
        const table: Table = {type: 'table', columns: [], rows: []};
        table.columns = [
            {text: 'Time', id: '_time'},
            ...metrics.map(m => {return {text: m, id: m}})
        ];
        table.rows = md.map(item => {
            let row = [this.formatTimestamp(item.timestamp)];
            metrics.forEach(m => {
                row.push(item.result[m]);
            });
            return row;
        })
        return table;
    }

  convertTimeSeriesDataToTimeSeries(md, metrics) {
    return metrics.map(metric => {
      return {
        target: metric,
        datapoints: md.map(item => {
          return [
            item.result[metric],
            this.formatTimestamp(item.timestamp)
          ];
        })
      };
    });
  }

  getGroupName(groupBy, metric) {
    return groupBy.map(dim => {
      return metric.event[dim];
    })
      .join("-");
  }

    convertTopNData(md, dimension, metric, targetFormat) {
        if (targetFormat === 'table') {
            return this.convertTopNDataToTable(md, dimension, metric);
        } else {
            return this.convertTopNDataToTimeSeries(md, dimension, metric);
        }
    }

    convertTopNDataToTable(md, dimension, metric) {
        const table: Table = {type: 'table', columns: [], rows: []};
        table.columns = [
            {text: 'Time', id: '_time'},
            {text: dimension, id: dimension},
            {text: metric, id: metric}
        ];
        md.forEach(item => {
            item.result.forEach(r => {
                let row = [this.formatTimestamp(item.timestamp)];
                row.push(r[dimension]);
                row.push(r[metric]);
                table.rows.push(row)
            });
        });
        return table;
    }

  convertTopNDataToTimeSeries(md, dimension, metric) {
    /*
      Druid topN results look like this:
      [
        {
          "timestamp": "ts1",
          "result": [
            {"<dim>": d1, "<metric>": mv1},
            {"<dim>": d2, "<metric>": mv2}
          ]
        },
        {
          "timestamp": "ts2",
          "result": [
            {"<dim>": d1, "<metric>": mv3},
            {"<dim>": d2, "<metric>": mv4}
          ]
        },
        ...
      ]
    */

    /*
      First, we need make sure that the result for each
      timestamp contains entries for all distinct dimension values
      in the entire list of results.

      Otherwise, if we do a stacked bar chart, Grafana doesn't sum
      the metrics correctly.
    */

    //Get the list of all distinct dimension values for the entire result set
    const dVals = md.reduce((dValsSoFar, tsItem) => {
      const dValsForTs = _.map(tsItem.result, dimension);
      return _.union(dValsSoFar, dValsForTs);
    }, {});

    //Add null for the metric for any missing dimension values per timestamp result
    md.forEach(tsItem => {
      const dValsPresent = _.map(tsItem.result, dimension);
      const dValsMissing = _.difference(dVals, dValsPresent);
      dValsMissing.forEach(dVal => {
        const nullPoint = {};
        nullPoint[dimension] = dVal;
        nullPoint[metric] = null;
        tsItem.result.push(nullPoint);
      });
      return tsItem;
    });

    //Re-index the results by dimension value instead of time interval
    const mergedData = md.map(item => {
      /*
        This first map() transforms this into a list of objects
        where the keys are dimension values
        and the values are [metricValue, unixTime] so that we get this:
          [
            {
              "d1": [mv1, ts1],
              "d2": [mv2, ts1]
            },
            {
              "d1": [mv3, ts2],
              "d2": [mv4, ts2]
            },
            ...
          ]
      */
      const timestamp = this.formatTimestamp(item.timestamp);
      const keys = _.map(item.result, dimension);
      const vals = _.map(item.result, metric).map(val => { return [val, timestamp]; });
      return _.zipObject(keys, vals);
    })
      .reduce((prev, curr) => {
        /*
          Reduce() collapses all of the mapped objects into a single
          object.  The keys are dimension values
          and the values are arrays of all the values for the same key.
          The _.assign() function merges objects together and it's callback
          gets invoked for every key,value pair in the source (2nd argument).
          Since our initial value for reduce() is an empty object,
          the _.assign() callback will get called for every new val
          that we add to the final object.
        */
        return _.assignWith(prev, curr, (pVal, cVal) => {
          if (pVal) {
            pVal.push(cVal);
            return pVal;
          }
          return [cVal];
        });
      }, {});

    //Convert object keyed by dimension values into an array
    //of objects {target: <dimVal>, datapoints: <metric time series>}
    return _.map(mergedData, (vals, key) => {
      return {
        target: key,
        datapoints: vals
      };
    });
  }

    convertGroupByData(md, groupBy, metrics, resultFormat) {
        if (resultFormat === 'table') {
            return this.convertGroupByDataToTable(md, groupBy, metrics);
        } else { // timeseries
            return this.convertGroupByDataToTimeSeries(md, groupBy, metrics);
        }
    }

    convertGroupByDataToTable(md, groupBy, metrics) {
        const table: Table = {type: 'table', columns: [], rows: []};
        const firstColumns = [
            {text: 'Time', id: '_time'},
        ];
        table.columns = [
            ...firstColumns,
            ...groupBy.map(g => {return {id: g, text: g}}),
            ...metrics.map(m => {return {id: m, text: m}})
        ];
        table.rows = md.map(item => {
            let row = [this.formatTimestamp(item.timestamp)];
            groupBy.forEach(g => row.push(item.event[g]));
            metrics.forEach(m => row.push(item.event[m]));
            return row;
        });
        return table;
    }

  convertGroupByDataToTimeSeries(md, groupBy, metrics) {
    const mergedData = md.map(item => {
      /*
        The first map() transforms the list Druid events into a list of objects
        with keys of the form "<groupName>: <metric>" and values
        of the form [metricValue, unixTime]
      */
      const groupName = this.getGroupName(groupBy, item);
      const keys = metrics.map(metric => {
        return `${groupName}: ${metric}`;
      });
      const vals = metrics.map(metric => {
        return [
          item.event[metric],
          this.formatTimestamp(item.timestamp)
        ];
      });
      return _.zipObject(keys, vals);
    })
      .reduce((prev, curr) => {
        /*
          Reduce() collapses all of the mapped objects into a single
          object.  The keys are still of the form "<groupName>:<metric>"
          and the values are arrays of all the values for the same key.
          The _.assign() function merges objects together and it's callback
          gets invoked for every key,value pair in the source (2nd argument).
          Since our initial value for reduce() is an empty object,
          the _.assign() callback will get called for every new val
          that we add to the final object.
        */
        return _.assignWith(prev, curr, (pVal, cVal) => {
          if (pVal) {
            pVal.push(cVal);
            return pVal;
          }
          return [cVal];
        });
      }, {});

    return _.map(mergedData, (vals, key) => {
      /*
        Second map converts the aggregated object into an array
      */
      return {
        target: key,
        datapoints: vals
      };
    });
  }

    convertSelectData(data, targetFormat) {
        if (targetFormat === 'table') {
            return this.convertSelectDataToTable(data);
        } else {
            return this.convertSelectDataToTimeSeries(data);
        }
    }

    convertSelectDataToTable(data) {
        const resultList = _.map(data, "result");
        const dimensions = _.uniq(_.flattenDeep(_.map(resultList, "dimensions")));
        const metrics = _.uniq(_.flattenDeep(_.map(resultList, "metrics")));
        const eventsList = _.map(resultList, "events");
        const eventList = _.flatten(eventsList);
        const table: Table = {type: 'table', columns: [], rows: []};
        const columns = [
            {text: 'Time', id: '_time'},
        ];
        dimensions.forEach(d => {
            columns.push({text: d, id: d});
        });
        metrics.forEach(m => {
            columns.push({text: m, id: m});
        });
        table.columns = columns;
        for (let i = 0; i < eventList.length; i++) {
            const event = eventList[i].event;
            const timestamp = event.timestamp;
            if (_.isEmpty(timestamp)) {
              continue;
            }
            let row = [this.formatTimestamp(event.timestamp)];
            dimensions.forEach(d => {row.push(event[d])});
            metrics.forEach(m => row.push(event[m]));
            table.rows.push(row);
        }
        return table;
    }

  convertSelectDataToTimeSeries(data) {
    const resultList = _.map(data, "result");
    const eventsList = _.map(resultList, "events");
    const eventList = _.flatten(eventsList);
    const result = {};
    for (let i = 0; i < eventList.length; i++) {
      const event = eventList[i].event;
      const timestamp = event.timestamp;
      if (_.isEmpty(timestamp)) {
        continue;
      }
      for (const key in event) {
        if (key !== "timestamp") {
          if (!result[key]) {
            result[key] = { "target": key, "datapoints": [] };
          }
          result[key].datapoints.push([event[key], timestamp]);
        }
      }
    }
    return _.values(result);
  }

  dateToMoment(date, roundUp) {
    if (date === 'now') {
      return moment();
    }
    date = dateMath.parse(date, roundUp);
    return moment(date.valueOf());
  }

  computeGranularity(from, to, maxDataPoints) {
    const intervalSecs = to.unix() - from.unix();
    /*
      Find the smallest granularity for which there
      will be fewer than maxDataPoints
    */
    const granularityEntry = _.find(this.GRANULARITIES, gEntry => {
      return Math.ceil(intervalSecs / gEntry[1].asSeconds()) <= maxDataPoints;
    });

    return granularityEntry[0];
  }

  roundUpStartTime(from, granularity) {
    const duration = _.find(this.GRANULARITIES, gEntry => {
      return gEntry[0] === granularity;
    })[1];
    let rounded = null;
    if (granularity === 'day') {
      rounded = moment(+from).startOf('day');
    } else {
      rounded = moment(Math.ceil((+from) / (+duration)) * (+duration));
    }
    return rounded;
  }

  replaceTemplateValues(obj, scopedVars, attrList) {
    const substitutedVals = attrList.map(attr => {
      if (obj.type == 'in' && attr == 'values') {
        return _.split(this.templateSrv.replace(
            _.replace(_.get(obj, attr), ',', SPLITER),
            scopedVars, this.arrayFormat), SPLITER);
      } else {
        return this.templateSrv.replace(_.get(obj, attr), scopedVars);
      }
    });
    return _.assign(_.clone(obj, true), _.zipObjectDeep(attrList, substitutedVals));
  }

  arrayFormat(value) {
    if (_.isArray(value)) {
        return value.join(SPLITER);
    }
    return value;
  }
}
