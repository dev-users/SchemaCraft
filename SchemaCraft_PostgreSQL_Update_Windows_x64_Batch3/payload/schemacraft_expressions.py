"""Bounded, non-executable infix expressions over validated finance operands.

The persisted grammar is a list: {'operand': zero_based_index}, arithmetic
operators, parentheses, commas, and whitelisted function names. No Python/JS/SQL
is evaluated. Parsing is also used during schema validation.
"""
from __future__ import annotations
from decimal import Decimal, localcontext, InvalidOperation, DivisionByZero

class ExpressionError(ValueError):
    pass

FUNCTIONS = {'sum', 'average', 'count', 'min', 'max'}
SYMBOLS = {'+', '-', '*', '/', '(', ')', ','} | FUNCTIONS
MAX_TOKENS = 256
MAX_DEPTH = 32


def normalize(raw, operand_count):
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_TOKENS:
        raise ExpressionError('أضف صيغة حساب صالحة؛ الحد الأقصى 256 عنصرًا.')
    result = []
    for token in raw:
        if isinstance(token, dict) and set(token) == {'operand'}:
            index = token['operand']
            if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < operand_count:
                raise ExpressionError('أحد مصادر صيغة الحساب محذوف أو غير صالح.')
            result.append({'operand': index})
        elif isinstance(token, str) and token in SYMBOLS:
            result.append(token)
        else:
            raise ExpressionError('عنصر غير مسموح في صيغة الحساب.')
    # Build an AST for syntax validation only; a literal zero denominator is a
    # runtime input error, not an excuse to execute placeholders during parsing.
    Parser(result).parse()
    return result


class Parser:
    def __init__(self, tokens):
        self.tokens, self.pos, self.depth = tokens, 0, 0

    def peek(self):
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def take(self):
        t = self.peek()
        self.pos += 1
        return t

    def parse(self):
        node = self.expression(0)
        if self.peek() is not None:
            raise ExpressionError('الصيغة تحتاج عامل حساب بين المصادر أو أقواسًا متوازنة.')
        return node

    def expression(self, minimum):
        self.depth += 1
        if self.depth > MAX_DEPTH:
            raise ExpressionError('تداخل صيغة الحساب يتجاوز الحد المسموح.')
        t = self.take()
        if isinstance(t, dict):
            node = ('operand', t['operand'])
        elif t in ('+', '-'):
            node = ('unary', t, self.expression(30))
        elif t == '(':
            node = self.expression(0)
            if self.take() != ')':
                raise ExpressionError('أقواس صيغة الحساب غير متوازنة.')
        elif isinstance(t, str) and t in FUNCTIONS:
            if self.take() != '(':
                raise ExpressionError('دالة الحساب تحتاج أقواسًا.')
            args = [self.expression(0)]
            while self.peek() == ',':
                self.take()
                args.append(self.expression(0))
            if self.take() != ')':
                raise ExpressionError('افصل معاملات الدالة بفواصل وأغلق الأقواس.')
            node = ('function', t, args)
        else:
            raise ExpressionError('صيغة الحساب غير مكتملة؛ اختر مصدر قيمة.')
        while isinstance(self.peek(), str) and self.peek() in ('+', '-', '*', '/'):
            op = self.peek()
            precedence = 10 if op in ('+', '-') else 20
            if precedence < minimum:
                break
            self.take()
            node = ('binary', op, node, self.expression(precedence + 1))
        self.depth -= 1
        return node


def evaluate(tokens, values):
    normalized = normalize(tokens, len(values))
    root = Parser(normalized).parse()

    def visit(node):
        kind = node[0]
        if kind == 'operand':
            return values[node[1]]
        if kind == 'unary':
            value = visit(node[2])
            return None if value is None else (-value if node[1] == '-' else value)
        if kind == 'binary':
            left, right = visit(node[2]), visit(node[3])
            if left is None or right is None:
                return None
            op = node[1]
            if op == '+': return left + right
            if op == '-': return left - right
            if op == '*': return left * right
            if not right:
                raise ExpressionError('لا يمكن القسمة على صفر في صيغة الحساب.')
            return left / right
        args = [v for v in (visit(n) for n in node[2]) if v is not None]
        op = node[1]
        if op == 'count': return Decimal(len(args))
        if not args: return Decimal(0) if op == 'sum' else None
        if op == 'sum': return sum(args, Decimal(0))
        if op == 'average': return sum(args, Decimal(0)) / len(args)
        if op == 'min': return min(args)
        return max(args)

    try:
        with localcontext() as ctx:
            ctx.prec = 60
            result = visit(root)
            if result is not None and (not result.is_finite() or (result and abs(result.adjusted()) > 60)):
                raise ExpressionError('نتيجة صيغة الحساب تتجاوز النطاق المسموح.')
            return result
    except (InvalidOperation, DivisionByZero, OverflowError) as exc:
        raise ExpressionError('تعذر تنفيذ صيغة الحساب بدقة صالحة.') from exc
