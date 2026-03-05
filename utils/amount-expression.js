/**
 * 金额表达式计算：支持数字、小数点、+/- 运算，用于预算/已使用额度的输入。
 */

function formatAmount(value) {
  const num = Number(value || 0)
  if (Number.isNaN(num)) return '0'
  return num.toFixed(2).replace(/\.00$/, '')
}

function isOperator(char) {
  return char === '+' || char === '-'
}

function getLastNumberSegment(expression) {
  const plusIdx = expression.lastIndexOf('+')
  const minusIdx = expression.lastIndexOf('-')
  const splitIndex = Math.max(plusIdx, minusIdx)
  return splitIndex < 0 ? expression : expression.slice(splitIndex + 1)
}

function replaceLastNumberSegment(expression, nextSegment) {
  const plusIdx = expression.lastIndexOf('+')
  const minusIdx = expression.lastIndexOf('-')
  const splitIndex = Math.max(plusIdx, minusIdx)
  if (splitIndex < 0) return nextSegment
  return `${expression.slice(0, splitIndex + 1)}${nextSegment}`
}

function appendNumberKey(expression, key) {
  let expr = expression || '0'
  if (expr === '0') {
    if (key === '00' || key === '0') return '0'
    return key
  }

  const lastChar = expr.slice(-1)
  if (isOperator(lastChar)) {
    if (key === '00') return `${expr}0`
    return `${expr}${key}`
  }

  const segment = getLastNumberSegment(expr)
  if (segment === '0' && !segment.includes('.')) {
    if (key === '0' || key === '00') return expr
    return replaceLastNumberSegment(expr, key)
  }

  if (segment.includes('.')) {
    const decimals = segment.split('.')[1] || ''
    if (decimals.length >= 2) return expr
    let appendPart = key
    if (decimals.length + appendPart.length > 2) {
      appendPart = appendPart.slice(0, 2 - decimals.length)
    }
    return appendPart ? `${expr}${appendPart}` : expr
  }

  return `${expr}${key}`
}

function appendDotKey(expression) {
  const expr = expression || '0'
  if (isOperator(expr.slice(-1))) return `${expr}0.`
  const segment = getLastNumberSegment(expr)
  if (segment.includes('.')) return expr
  return `${expr}.`
}

function appendOperatorKey(expression, operator) {
  let expr = expression || '0'
  if (expr === '0' && operator === '+') return expr
  const lastChar = expr.slice(-1)
  if (isOperator(lastChar)) {
    expr = `${expr.slice(0, -1)}${operator}`
  } else {
    expr = `${expr}${operator}`
  }
  return expr
}

function removeExpressionTail(expression) {
  const expr = expression || '0'
  if (expr.length <= 1) return '0'
  const next = expr.slice(0, -1)
  return next || '0'
}

function evaluateExpression(expression) {
  const source = (expression || '').trim()
  if (!source) return 0
  const normalized = isOperator(source.slice(-1))
    ? source.slice(0, -1)
    : source
  if (!normalized) return 0
  let current = ''
  let total = 0
  let pending = '+'
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i]
    if (isOperator(char)) {
      const num = Number(current || 0)
      if (pending === '+') total += num
      else total -= num
      pending = char
      current = ''
      continue
    }
    current += char
  }
  if (current) {
    const num = Number(current || 0)
    if (pending === '+') total += num
    else total -= num
  }
  if (Number.isNaN(total)) return 0
  return total
}

function getExpressionFormula(expression, resultText) {
  if (!/[+-]/.test(expression)) return ''
  const pretty = expression.replace(/([+-])/g, ' $1 ').replace(/\s+/g, ' ').trim()
  if (isOperator(expression.slice(-1))) return pretty
  return `${pretty} = ${resultText}`
}

/**
 * @param {string} expression 当前表达式
 * @param {string} key 按键：数字、'.'、'+'、'-'
 * @returns {{ expression: string, valueText: string, formulaText: string }}
 */
function buildExpressionState(expression, key) {
  if (key === '.') {
    const expr = appendDotKey(expression)
    const value = evaluateExpression(expr)
    const valueText = formatAmount(value)
    return {
      expression: expr,
      valueText,
      formulaText: getExpressionFormula(expr, valueText),
    }
  }
  if (isOperator(key)) {
    const expr = appendOperatorKey(expression, key)
    const value = evaluateExpression(expr)
    const valueText = formatAmount(value)
    return {
      expression: expr,
      valueText,
      formulaText: getExpressionFormula(expr, valueText),
    }
  }
  const expr = appendNumberKey(expression, key)
  const value = evaluateExpression(expr)
  const valueText = formatAmount(value)
  return {
    expression: expr,
    valueText,
    formulaText: getExpressionFormula(expr, valueText),
  }
}

module.exports = {
  formatAmount,
  buildExpressionState,
  removeExpressionTail,
  evaluateExpression,
  getExpressionFormula,
}
