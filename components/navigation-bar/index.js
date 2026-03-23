Component({
  options: {
    multipleSlots: true, // 在组件定义时的选项中启用多slot支持
  },
  /**
   * 组件的属性列表
   */
  properties: {
    title: {
      type: String,
      value: '',
    },
    background: {
      type: String,
      value: 'transparent',
    },
    color: {
      type: String,
      value: '#1f1f1f',
    },
    back: {
      type: Boolean,
      value: true,
    },
    loading: {
      type: Boolean,
      value: false,
    },
    // back为true的时候，返回的页面深度
    delta: {
      type: Number,
      value: 1,
    },
    sideWidth: {
      type: Number,
      value: 0,
    },
    /** 页面栈仅一层时（如分享直达），无法 navigateBack，则 reLaunch 到此路径（一般为首页） */
    homeUrl: {
      type: String,
      value: '',
    },
  },

  attached() {
    const isSupport = !!wx.getMenuButtonBoundingClientRect;
    const rect = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    wx.getSystemInfo({
      success: (res) => {
        const ios = !!(res.system.toLowerCase().search('ios') + 1);
        const sideWidth = isSupport ? res.windowWidth - rect.left : 0;

        this.setData({
          ios,
          sideWidth: this.data.sideWidth || sideWidth,
          statusBarHeight: res.statusBarHeight,
        });
      },
    });
  },
  /**
   * 组件的方法列表
   */
  methods: {
    back() {
      const { data } = this;
      const homeUrl = data.homeUrl || '';
      if (data.delta) {
        const pages = getCurrentPages();
        if (pages.length <= 1 && homeUrl) {
          wx.reLaunch({ url: homeUrl });
        } else {
          wx.navigateBack({
            delta: data.delta,
            fail: () => {
              if (homeUrl) wx.reLaunch({ url: homeUrl });
            },
          });
        }
      }
      this.triggerEvent('back', { delta: data.delta }, {});
    },
  },
});
