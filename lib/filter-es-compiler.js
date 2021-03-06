'use strict';
// Compiler that transforms filter expression AST into an Elasticsearch filter.
//
// The filter is returned in the "filter" property of the toplevel AST node.

/* global JuttleAdapterAPI */
var JuttleMoment = JuttleAdapterAPI.types.JuttleMoment;
var StaticFilterCompiler = JuttleAdapterAPI.compiler.StaticFilterCompiler;

var OPS_TO_INVERTED_OPS = {
    '==': '==',
    '!=': '!=',
    '<':  '>',
    '>':  '<',
    '<=': '>=',
    '>=': '<='
};

var OPS_TO_ES_OPS = {
    '<':  'lt',
    '>':  'gt',
    '<=': 'lte',
    '>=': 'gte'
};

var match_all_filter = { match_all : {} };

class FilterESCompiler extends StaticFilterCompiler {
    constructor(options) {
        super(options);
        options = options || {};
        this.skipField = options.skipField;
        this.filtered_fields = [];
    }

    compile(node) {
        var result = this.visit(node);
        result.filtered_fields = this.filtered_fields;
        return result;
    }

    visitNullLiteral(node) {
        return null;
    }

    visitBooleanLiteral(node) {
        return node.value;
    }

    visitNumberLiteral(node) {
        return node.value;
    }

    visitStringLiteral(node) {
        return node.value;
    }

    visitMomentLiteral(node) {
        return node.value;
    }

    visitDurationLiteral(node) {
        return JuttleMoment.duration(node.value).toJSON();
    }

    visitFilterLiteral(node) {
        return this.visit(node.ast);
    }

    visitArrayLiteral(node) {
        return node.elements.map((e) => { return this.visit(e); });
    }

    visitUnaryExpression(node) {
        switch (node.operator) {
            case 'NOT':
                return {
                    filter: {
                        bool: { must_not: [this.visit(node.argument).filter] }
                    }
                };

            default:
                throw new Error('Invalid operator: ' + node.operator + '.');
        }
    }

    visitField(node) {
        this.filtered_fields.push(node.name);
        return node.name;
    }

    visitMemberExpression(node) {
        var object = this.visit(node.object);
        var property = this.visit(node.property);
        return `${object}.${property}`;
    }

    visitBinaryExpression(node) {
        var left, right, filter, elements;

        switch (node.operator) {
            case 'AND':
                left = this.visit(node.left);
                right = this.visit(node.right);

                filter = { bool: { must: [left.filter, right.filter] } };
                break;

            case 'OR':
                left = this.visit(node.left);
                right = this.visit(node.right);

                filter = { bool: { should: [left.filter, right.filter] } };
                break;

            case '==':
                elements = this._getQueryElements(node);

                if (elements.field === this.skipField) {
                    filter = match_all_filter;
                } else if (elements.value === null) {
                    filter = { missing: { field: elements.field } };
                } else {
                    filter = { term: {} };
                    filter.term[elements.field] = elements.value;
                }
                break;

            case '!=':
                elements = this._getQueryElements(node);

                if (elements.field === this.skipField) {
                    filter = match_all_filter;
                } else if (elements.value === null) {
                    filter = { not: { missing: { field: elements.field } } };
                } else {
                    filter = { not: { term: {} } };
                    filter.not.term[elements.field] = elements.value;
                }
                break;

            case '=~':
                elements = {
                    field: this.visit(node.left),
                    value: this.visit(node.right),
                };

                filter = { query: { wildcard: {} } };
                filter.query.wildcard[elements.field] = elements.value;
                break;

            case '!~':
                elements = {
                    field: this.visit(node.left),
                    value: this.visit(node.right),
                };

                filter = { not: { query: { wildcard: {} } } };
                filter.not.query.wildcard[elements.field] = elements.value;
                break;

            case '<':
            case '>':
            case '<=':
            case '>=':
                elements = this._getQueryElements(node);

                if (elements.field === this.skipField) {
                    filter = match_all_filter;
                    break;
                }

                filter = { range: {} };
                filter.range[elements.field] = {};
                filter.range[elements.field][OPS_TO_ES_OPS[elements.operator]] = elements.value;
                break;

            case 'in':
                elements = {
                    field: this.visit(node.left),
                    value: this.visit(node.right),
                };

                if (elements.field === this.skipField) {
                    filter = match_all_filter;
                    break;
                }

                filter = { terms: {} };
                filter.terms[elements.field] = elements.value;
                break;

            default:
                throw new Error('Invalid operator: ' + node.operator + '.');
        }

        return { filter: filter };
    }

    visitExpressionFilterTerm(node) {
        return this.visit(node.expression);
    }

    visitFulltextFilterTerm(node) {
        return {
            filter: { query: { match_phrase: { '_all': node.text } } }
        };
    }

    _getQueryElements(node) {
        function _isValidField(node) {
            return node.type === 'Field' || node.type === 'MemberExpression';
        }
        if (_isValidField(node.left)) {
            return {
                field: this.visit(node.left),
                value: this.visit(node.right),
                operator: node.operator
            };
        } else if (_isValidField(node.right)) {
            return {
                field: this.visit(node.right),
                value: this.visit(node.left),
                operator: OPS_TO_INVERTED_OPS[node.operator]
            };
        } else {
            throw new Error('One operand of the "' + node.operator + '" must be a field reference.');
        }
    }
}

module.exports = FilterESCompiler;
