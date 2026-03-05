const {
  buildExpressionState,
  removeExpressionTail,
  evaluateExpression,
  getExpressionFormula,
  formatAmount,
} = require('../../utils/amount-expression')

const KEYBOARD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '00'],
]

function vibrateLight() {
  if (typeof wx === 'undefined' || !wx.vibrateShort) return
  wx.vibrateShort()
}

Component({
  properties: {
    /** 主按钮文案，如「保存预算项」「保存」 */
    primaryButtonText: { type: String, value: '保存' },
    /** 变化时组件会重置表达式，用于弹窗打开时传 Date.now() */
    initialReset: { type: Number, value: 0 },
    /** 重置时的初始表达式，如 '0' 或 '123.45' */
    initialExpression: { type: String, value: '0' },
  },

  data: {
    keyboardRows: KEYBOARD_ROWS,
    expression: '0',
  },

  observers: {
    'initialReset'() {
      const initial = (this.properties.initialExpression || '0').trim() || '0'
      this.setData({ expression: initial })
      this.emitChange(initial)
    },
  },

  methods: {
    emitChange(expression) {
      const value = expression === undefined ? this.data.expression : expression
      const num = evaluateExpression(value)
      const valueText = formatAmount(num)
      const formulaText = getExpressionFormula(value, valueText)
      this.triggerEvent('change', {
        valueText,
        formulaText,
        expression: value,
      })
    },

    onKeyTap(e) {
      vibrateLight()
      const key = e.currentTarget.dataset.key
      const state = buildExpressionState(this.data.expression || '0', key)
      this.setData({ expression: state.expression })
      this.triggerEvent('change', {
        valueText: state.valueText,
        formulaText: state.formulaText,
        expression: state.expression,
      })
    },

    onBackspace() {
      vibrateLight()
      const nextExpr = removeExpressionTail(this.data.expression || '0')
      const valueText = formatAmount(evaluateExpression(nextExpr))
      this.setData({ expression: nextExpr })
      this.triggerEvent('change', {
        valueText,
        formulaText: getExpressionFormula(nextExpr, valueText),
        expression: nextExpr,
      })
    },

    onClear() {
      vibrateLight()
      this.setData({ expression: '0' })
      this.triggerEvent('change', {
        valueText: '0',
        formulaText: '',
        expression: '0',
      })
    },

    onPrimary() {
      vibrateLight()
      this.triggerEvent('primary')
    },
  },
})
