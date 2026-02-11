/**
 * 检查并请求位置权限，再获取位置信息（微信小程序原生）
 * @returns {Promise<{ latitude: number, longitude: number }>} 成功时返回经纬度，失败时 reject
 */
function checkLocationPermissionAndGet() {
  const doGetLocation = () =>
    new Promise((resolve, reject) => {
      wx.getLocation({
        type: "gcj02",
        success: (res) =>
          resolve({ latitude: res.latitude, longitude: res.longitude }),
        fail: reject,
      });
    });

  return new Promise((resolve, reject) => {
    wx.getSetting({
      success: (res) => {
        if (res.authSetting["scope.userLocation"]) {
          doGetLocation().then(resolve).catch(reject);
          return;
        }
        wx.authorize({
          scope: "scope.userLocation",
          success: () => doGetLocation().then(resolve).catch(reject),
          fail: () => {
            wx.showModal({
              title: "提示",
              content:
                "将获取你的具体位置信息，用于导航服务。请在设置中开启位置权限",
              confirmText: "去设置",
              cancelText: "取消",
              success: (modalRes) => {
                if (modalRes.confirm) {
                  wx.openSetting({
                    success: (settingRes) => {
                      if (settingRes.authSetting["scope.userLocation"]) {
                        doGetLocation().then(resolve).catch(reject);
                      } else {
                        reject(new Error("用户未开启位置权限"));
                      }
                    },
                  });
                } else {
                  reject(new Error("用户取消授权"));
                }
              },
            });
          },
        });
      },
      fail: () => {
        console.warn("获取定位权限状态失败");
        reject(new Error("获取定位权限状态失败"));
      },
    });
  });
}

module.exports = {
  checkLocationPermissionAndGet,
};
