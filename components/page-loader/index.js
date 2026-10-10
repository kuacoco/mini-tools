Component({
  properties: {
    label: {
      type: String,
      value: '小工具',
    },
    duration: {
      type: Number,
      value: 520,
    },
    ready: {
      type: Boolean,
      value: true,
      observer() {
        this.tryFinish()
      },
    },
  },

  data: {
    visible: true,
    leaving: false,
  },

  methods: {
    noop() {},

    tryFinish(force = false) {
      if (!this.data.visible || this.data.leaving) return
      if (!force && (!this.minimumElapsed || !this.properties.ready)) return

      this.setData({ leaving: true })
      this.hideTimer = setTimeout(() => {
        this.setData({ visible: false })
      }, 480)
    },
  },

  lifetimes: {
    attached() {
      const duration = Math.max(Number(this.properties.duration) || 520, 360)
      this.minimumTimer = setTimeout(() => {
        this.minimumElapsed = true
        this.tryFinish()
      }, duration)
      this.maximumTimer = setTimeout(() => this.tryFinish(true), 20000)
    },

    detached() {
      clearTimeout(this.minimumTimer)
      clearTimeout(this.maximumTimer)
      clearTimeout(this.hideTimer)
    },
  },
})
