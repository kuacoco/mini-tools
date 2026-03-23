Component({
  data: {
    innerSwiperIndex: 1,
  },

  properties: {
    weekDays: {
      type: Array,
      value: () => [],
    },
    monthPickerItems: {
      type: Array,
      value: () => [],
    },
    currentPickerIndex: {
      type: Number,
      value: 0,
    },
    currentMonthLabel: {
      type: String,
      value: '',
    },
    /** 三个月的格子数据：[上月, 当月, 下月] */
    calendarDaysSwipe: {
      type: Array,
      value: () => [[], [], []],
    },
    swiperMonthIndex: {
      type: Number,
      value: 1,
    },
    /** 与页面 calendarSwiperKey 同步，变化时重建 swiper */
    swiperRemountKey: {
      type: Number,
      value: 0,
    },
    selectedDate: {
      type: String,
      value: '',
    },
    todayDateString: {
      type: String,
      value: '',
    },
    selectedDateDisplay: {
      type: String,
      value: '',
    },
    caption: {
      type: String,
      value: '',
    },
  },

  observers: {
    swiperMonthIndex(next) {
      if (typeof next !== 'number') return
      if (next === this.data.innerSwiperIndex) return
      this.setData({ innerSwiperIndex: next })
    },
  },

  methods: {
    onPrevMonth() {
      if (this.data.innerSwiperIndex !== 1) return
      this.setData({ innerSwiperIndex: 0 })
    },
    onNextMonth() {
      if (this.data.innerSwiperIndex !== 1) return
      this.setData({ innerSwiperIndex: 2 })
    },
    onSelectMonth(e) {
      this.triggerEvent('selectmonth', { value: e.detail.value })
    },
    onSelectDate(e) {
      const { date } = e.currentTarget.dataset
      if (!date) return
      this.triggerEvent('selectdate', { date })
    },
    onGoToToday() {
      this.triggerEvent('gotoday')
    },
    onSwiperCalendarChange(e) {
      const cur = e.detail.current
      this.setData({ innerSwiperIndex: cur })
      if (cur === 1) return
      if (cur === 0) {
        this.triggerEvent('swipeprev')
      } else if (cur === 2) {
        this.triggerEvent('swipenext')
      }
    },
  },
})
