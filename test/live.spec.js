var _ = require('underscore');
var expect = require('chai').expect;

var test_utils = require('./elastic-test-utils');

var modes = test_utils.modes;

function generate_live_data() {
    return test_utils.generate_sample_data({
        start: Date.now() + 2000,
        tags: {
            name: ['a', 'b']
        }
    });
}

describe('elastic source', function() {
    modes.forEach(function(mode) {
        describe('live reads -- ' + mode, function() {
            afterEach(function() {
                return test_utils.clear_data(mode);
            });

            function test_live(points_to_write, points_to_expect, extra) {
                points_to_expect = points_to_expect || points_to_write;
                extra = extra || '';
                var last_time = new Date(_.last(points_to_write).time).getTime();
                var deactivateAfter = last_time - Date.now() + 5000;
                var options = {id: mode, from: 0, to: 'end', lag: '2s'};

                var read = test_utils.read(options, extra, deactivateAfter)
                .then(function(result) {
                    expect(result.sinks.table).deep.equal(points_to_expect);
                    return result;
                });

                return test_utils.write(points_to_write, {id: mode})
                .then(function(result) {
                    expect(result.errors).deep.equal([]);
                    return test_utils.verify_import(points_to_write, mode);
                })
                .then(function() {
                    return read;
                });
            }

            it('reads live points', function() {
                var points = generate_live_data();

                return test_live(points);
            });

            it('reads live points with a filter', function() {
                var points = generate_live_data();
                var expected = points.filter(function(pt) {
                    return pt.name === 'a';
                });

                return test_live(points, expected, 'name = "a"');
            });

            it('superquery', function() {
                var historical = test_utils.generate_sample_data({
                    tags: {name: ['historical']}
                });

                return test_utils.write(historical, {id: mode})
                    .then(function(result) {
                        expect(result.errors).deep.equal([]);
                        return test_utils.verify_import(historical, mode);
                    })
                    .then(function() {
                        var live = generate_live_data();
                        return test_live(live, historical.concat(live));
                    });
            });

            // depends on https://github.com/juttle/juttle/pull/400
            it.skip('-every', function() {
                var points = generate_live_data();
                return test_live(points, points, '-every :0.5s:')
                    .then(function(result) {
                        var num_queries = result.prog.graph.adapter.executed_queries.length;
                        expect(num_queries).at.least(10);
                    });
            });
        });
    });
});
