// 小程序按字符串引用路由、组件和事件，清理代码时需要一起检查。
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const exists = (file) => fs.existsSync(path.join(root, file))
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

function filesIn(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true })
    .filter((entry) => !['node_modules', '.git', '.claude', '.agents', '.codex'].includes(entry.name))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name)
      return entry.isDirectory() ? filesIn(file) : [file]
    })
}

const files = [
  'app.js', 'app.json', 'sitemap.json', 'project.config.json',
  ...['pages', 'components', 'utils', 'cloudfunctions', 'scripts', 'tests'].flatMap(filesIn),
]
const app = JSON.parse(read('app.json'))
const routes = new Set(app.pages.map((page) => `/${page}`))
const crudActions = new Map([
  ['callBudgetCrud', 'budgetCrud'],
  ['callCourseCrud', 'courseCrud'],
  ['callCalendarCrud', 'calendarCrud'],
].map(([wrapper, name]) => [wrapper, new Set(
  [...read(`cloudfunctions/${name}/index.js`).matchAll(/case ['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
)]))
let eventCount = 0

for (const file of files) {
  if (file.endsWith('.json')) {
    try {
      const config = JSON.parse(read(file))
      for (const component of Object.values(config.usingComponents || {})) {
        if (component.startsWith('plugin://')) continue
        const base = component.startsWith('/')
          ? component.slice(1) : path.join(path.dirname(file), component)
        for (const extension of ['js', 'json', 'wxml', 'wxss']) {
          check(exists(`${base}.${extension}`), `${file}: 组件文件缺失 ${base}.${extension}`)
        }
      }
    } catch (error) {
      failures.push(`${file}: ${error.message}`)
    }
  }
  if (!file.endsWith('.js')) continue
  const source = read(file)
  if (file.startsWith('utils/')) {
    for (const match of source.matchAll(/(callBudgetCrud|callCourseCrud|callCalendarCrud)\(['"]([^'"]+)['"]/g)) {
      check(crudActions.get(match[1]).has(match[2]), `${file}: 云函数 action 缺失 ${match[2]}`)
    }
  }
  try { new vm.Script(source, { filename: file }) } catch (error) {
    failures.push(`${file}: ${error.message}`)
  }
  for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
    if (!match[1].startsWith('.')) continue
    const target = path.join(path.dirname(file), match[1])
    check(exists(target) || exists(`${target}.js`) || exists(`${target}/index.js`),
      `${file}: 本地模块缺失 ${match[1]}`)
  }
  for (const match of source.matchAll(/['"`]\/?(pages\/[\w-]+\/[\w-]+)(?:[?'"`])/g)) {
    check(routes.has(`/${match[1]}`), `${file}: 未注册页面 ${match[1]}`)
  }
  for (const match of source.matchAll(/wx\.cloud\.callFunction\(\s*\{\s*name:\s*['"]([^'"]+)['"]/g)) {
    check(exists(`cloudfunctions/${match[1]}/index.js`), `${file}: 云函数缺失 ${match[1]}`)
  }
  if (!file.startsWith('pages/') && !file.startsWith('components/')) continue
  const wxmlFile = file.replace(/\.js$/, '.wxml')
  if (!exists(wxmlFile)) continue
  let definition
  try {
    vm.runInNewContext(source, {
      require: createRequire(path.join(root, file)),
      Page: (value) => { definition = value },
      Component: (value) => { definition = value },
      wx: {}, console, setTimeout, clearTimeout,
    }, { filename: file })
    const methods = definition.methods || definition
    const wxml = read(wxmlFile).replace(/<!--[\s\S]*?-->/g, '')
    for (const match of wxml.matchAll(/(?:bind|catch):?[\w-]+\s*=\s*['"]([\w$]+)['"]/g)) {
      eventCount += 1
      check(typeof methods[match[1]] === 'function', `${wxmlFile}: 事件方法缺失 ${match[1]}`)
    }
    for (const match of wxml.matchAll(/src=['"]([^'"{}]+)['"]/g)) {
      if (/^(?:https?:|data:|cloud:)/.test(match[1])) continue
      const target = match[1].startsWith('/') ? match[1].slice(1)
        : path.join(path.dirname(file), match[1])
      check(exists(target), `${wxmlFile}: 静态资源缺失 ${match[1]}`)
    }
  } catch (error) {
    failures.push(`${file}: 页面/组件初始化检查失败 ${error.message}`)
  }
}

for (const route of app.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    check(exists(`${route}.${extension}`), `页面文件缺失 ${route}.${extension}`)
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`检查通过：${app.pages.length} 个页面，${eventCount} 个事件绑定，JS/JSON、本地引用、组件、路由、云函数与静态资源。`)
}
