// app.js
App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: 'cloud2-1gytehldd551cd77',
      traceUser: true,
    })
  }
})
