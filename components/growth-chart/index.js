const { drawGrowthChart, geometry } = require('../../utils/growth-chart-draw')
Component({
  properties: { model: { type: Object, value: null, observer() { this.scheduleDraw() } } },
  data: { selected: null, error: '' },
  lifetimes: {
    ready() { this._ready = true; this.scheduleDraw() },
    detached() { this._ready = false; this._drawVersion = (this._drawVersion || 0) + 1 },
  },
  methods: {
    scheduleDraw() {
      if (!this._ready || !this.properties.model) return
      const version = this._drawVersion = (this._drawVersion || 0) + 1
      this.setData({ selected: null, error: '' })
      wx.nextTick(() => {
        if (!this._ready || version !== this._drawVersion) return
        this.createSelectorQuery().select('#growth-canvas').fields({ node: true, size: true }).exec(res => {
          if (!this._ready || version !== this._drawVersion) return
          const info = res && res[0]
          if (!info?.node || !info.width) { this.setData({ error: '曲线暂未绘制成功' }); return }
          try {
            const ratio = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio
            const canvas = info.node
            canvas.width = info.width * ratio; canvas.height = info.height * ratio
            const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio)
            this._drawing = { ctx, width: info.width, height: info.height }
            drawGrowthChart(ctx, this.properties.model, info.width, info.height)
          } catch (_) { this.setData({ error: '曲线暂未绘制成功' }) }
        })
      })
    },
    onTouch(e) {
      const touch = e.touches?.[0]
      if (!touch || !this._drawing || !this.properties.model?.points.length) return
      const { ctx, width, height } = this._drawing, model = this.properties.model
      const g = geometry(model, width, height)
      let index = 0
      model.points.forEach((p, i) => { if (Math.abs(g.x(p.x) - touch.x) < Math.abs(g.x(model.points[index].x) - touch.x)) index = i })
      this.setData({ selected: model.points[index] })
      drawGrowthChart(ctx, model, width, height, index)
    },
  },
})
