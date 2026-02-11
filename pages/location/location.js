const { checkLocationPermissionAndGet } = require("../../utils/tool.js");

Page({
  data: {
    latitude: null,
    longitude: null,
    loading: false,
    errorMsg: "",
    latitudeText: "--",
    longitudeText: "--",
    hasLocation: false,
  },

  onLoad() {
    this.fetchLocation();
  },

  fetchLocation() {
    this.setData({ loading: true, errorMsg: "" });
    checkLocationPermissionAndGet()
      .then((res) => {
        this.setData({
          latitude: res.latitude,
          longitude: res.longitude,
          latitudeText: String(res.latitude),
          longitudeText: String(res.longitude),
          hasLocation: true,
        });
      })
      .catch((e) => {
        console.error(e);

        this.setData({
          errorMsg:
            e && e.message ? e.message : "获取定位失败，请检查权限或网络",
          latitudeText: "--",
          longitudeText: "--",
          hasLocation: false,
        });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  onCopy() {
    const { hasLocation, latitude, longitude } = this.data;
    if (!hasLocation) return;
    const text = `${longitude},${latitude}`;
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: "已复制到剪贴板", icon: "success" });
      },
      fail: () => {
        wx.showToast({ title: "复制失败", icon: "none" });
      },
    });
  },

  onRefresh() {
    this.fetchLocation();
  },
});
