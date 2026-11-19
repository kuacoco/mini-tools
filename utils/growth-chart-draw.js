function geometry(model, width, height) {
  const left = 36, right = width - 12, top = 18, bottom = height - 30
  return { left, right, top, bottom,
    x: v => left + (v - model.minX) / (model.maxX - model.minX) * (right - left),
    y: v => bottom - (v - model.minY) / (model.maxY - model.minY) * (bottom - top) }
}
function drawGrowthChart(ctx, model, width, height, selected = -1) {
  const g = geometry(model, width, height)
  const ink = model.metric === 'height' ? '#4D8278' : '#C57C66'
  const fill = model.metric === 'height' ? 'rgba(139,194,177,.25)' : 'rgba(230,171,143,.24)'
  ctx.clearRect(0, 0, width, height)
  ctx.font = '10px sans-serif'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 4; i++) {
    const y = model.minY + (model.maxY - model.minY) * i / 4
    ctx.strokeStyle = '#ECEAF0'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(g.left, g.y(y)); ctx.lineTo(g.right, g.y(y)); ctx.stroke()
    ctx.fillStyle = '#777487'; ctx.textAlign = 'right'; ctx.fillText(Number(y.toFixed(1)), g.left - 7, g.y(y))
  }
  ctx.textAlign = 'left'; ctx.fillStyle = '#777487'; ctx.fillText(model.unit, 1, 6)
  for (let i = 0; i <= 4; i++) {
    const age = model.minX + (model.maxX - model.minX) * i / 4
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center'
    const label = model.maxX <= 24 ? `${Math.round(age)}月` : `${Number((age / 12).toFixed(1))}岁`
    ctx.fillText(label, g.x(age), height - 11)
  }
  for (const segment of model.segments) {
    ctx.beginPath()
    segment.forEach((p, i) => i ? ctx.lineTo(g.x(p.x), g.y(p.high)) : ctx.moveTo(g.x(p.x), g.y(p.high)))
    segment.slice().reverse().forEach(p => ctx.lineTo(g.x(p.x), g.y(p.low)))
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill()
    ctx.beginPath(); ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.strokeStyle = ink
    segment.forEach((p, i) => i ? ctx.lineTo(g.x(p.x), g.y(p.median)) : ctx.moveTo(g.x(p.x), g.y(p.median)))
    ctx.stroke(); ctx.setLineDash([])
  }
  ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.strokeStyle = ink
  ctx.beginPath()
  model.points.forEach((p, i) => i ? ctx.lineTo(g.x(p.x), g.y(p.y)) : ctx.moveTo(g.x(p.x), g.y(p.y)))
  ctx.stroke()
  model.points.forEach((p, i) => {
    if (i === selected) {
      ctx.strokeStyle = '#B9B0CF'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(g.x(p.x), g.top); ctx.lineTo(g.x(p.x), g.bottom); ctx.stroke(); ctx.setLineDash([])
    }
    ctx.beginPath(); ctx.arc(g.x(p.x), g.y(p.y), i === selected ? 5 : 3.5, 0, Math.PI * 2)
    ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.stroke()
  })
  return g
}
module.exports = { geometry, drawGrowthChart }
