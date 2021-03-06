var _ = require('underscore');
var Promise = require('bluebird');
var request = Promise.promisifyAll(require('request'));
request.async = Promise.promisify(request);
var retry = require('bluebird-retry');
var expect = require('chai').expect;

var test_utils = require('./elastic-test-utils');
var points = require('./apache-sample');

var modes = test_utils.modes;

describe('elastic source limits', function() {
    modes.forEach(function(mode) {
        describe(mode, function() {
            after(function() {
                return test_utils.clear_data(mode);
            });

            before(function() {
                return retry(function() {
                    return test_utils.write(points, {id: mode})
                    .then(function(result) {
                        return test_utils.verify_import(points, mode);
                    });
                }, {max_tries: 10});
            });

            it('executes multiple fetches', function() {
                var start = '2014-09-17T14:13:47.000Z';
                var end = '2014-09-17T14:14:32.000Z';
                return test_utils.read({from: start, to: end, id: mode})
                .then(function(result) {
                    var expected = points.filter(function(pt) {
                        return pt.time >= start && pt.time < end;
                    });

                    test_utils.check_result_vs_expected_sorting_by(result.sinks.table, expected, 'bytes');
                });
            });

            it('errors if you try to read too many simultaneous points', function() {
                var extra = '-fetchSize 2 -deep_paging_limit 3';
                return test_utils.read({id: mode}, extra)
                .then(function(result) {
                    expect(result.errors).deep.equal([ 'Cannot fetch more than 3 points with the same timestamp' ]);
                });
            });

            it('enforces head across multiple fetches', function() {
                var extra = '-fetchSize 2 | head 3';
                return test_utils.read({id: mode}, extra)
                .then(function(result) {
                    var expected = points.slice(0, 3);
                    test_utils.check_result_vs_expected_sorting_by(result.sinks.table, expected, 'bytes');
                    expect(result.prog.graph.adapter.executed_queries[0].size).equal(2);
                });
            });

            it('doesn\'t optimize tail in excess of fetch size', function() {
                var extra = '-fetchSize 2 | tail 8';
                return test_utils.read({id: mode}, extra)
                .then(function(result) {
                    var expected = _.last(points, 8);
                    test_utils.check_result_vs_expected_sorting_by(result.sinks.table, expected, 'bytes');
                    expect(result.prog.graph.adapter.executed_queries[0].size).equal(2);
                });
            });

            it('catches window errors and reports something usable', function() {
                if (mode === 'aws') {
                    // AWS's ES version doesn't have window overflow errors
                    return;
                }
                function set_window(size) {
                    return request.putAsync({
                        url: 'http://localhost:9200/*/_settings',
                        json: {
                            index: {
                                max_result_window: size
                            }
                        }
                    });
                }

                return set_window(10)
                .spread(function(res, body) {
                    return test_utils.read({id: mode});
                })
                .then(function(result) {
                    var e = 'Tried to read more than 10 points with the same timestamp, increase the max_result_window setting on the relevant indices to read more';
                    expect(result.errors).deep.equal([e]);
                })
                .finally(function() {
                    return set_window(10000);
                });
            });

            it('unoptimized tail over multiple fetches', function() {
                return test_utils.read({id: mode, fetchSize: 2}, ' | tail 8')
                    .then(function(result) {
                        var expected = _.last(points, 8);
                        test_utils.check_result_vs_expected_sorting_by(result.sinks.table, expected, 'bytes');
                    });
            });

            it('unoptimized tail with small queueSize', function() {
                return test_utils.read({id: mode, fetchSize: 3, queueSize: 3, optimize: false}, ' | tail 8')
                    .then(function(result) {
                        var expected = _.last(points, 8);
                        test_utils.check_result_vs_expected_sorting_by(result.sinks.table, expected, 'bytes');
                    });
            });

            it('queueSize becomes fetchSize when it\'s smaller', function() {
                return test_utils.read({id: mode, queueSize: 2})
                    .then(function(result) {
                        expect(result.prog.graph.adapter.executed_queries[0].size).equal(2);
                        test_utils.check_result_vs_expected_sorting_by(result.sinks.table, points, 'bytes');
                    });
            });
        });
    });
});
