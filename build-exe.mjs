/**
 * build-exe.mjs — 把注入器打包成单个 Windows 可执行文件（CodexSkin.exe）。
 * 用 Node 内置的 SEA（Single Executable Application），无需用户安装 Node。
 * 运行：node build-exe.mjs（首次会用 npx 拉取 postject，需要网络）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, 'dist')
mkdirSync(dist, { recursive: true })

const blob = join(dist, 'sea-prep.blob')
const exe = join(dist, 'CodexSkin.exe')
const cjs = join(dist, 'inject.cjs')

console.log('1/4 esbuild 打包 ESM -> CJS...')
execFileSync(
  'npx esbuild injector/inject.mjs --bundle --platform=node --format=cjs --outfile=' + cjs,
  { stdio: 'inherit', cwd: root, shell: true },
)

console.log('2/4 生成 SEA blob...')
execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], { stdio: 'inherit', cwd: root })
if (!existsSync(blob)) throw new Error('未生成 ' + blob)

console.log('3/4 复制 node.exe 为 ' + exe + '...')
copyFileSync(process.execPath, exe)

console.log('4/4 注入 blob（npx postject）...')
const fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
execFileSync(
  'npx --yes postject "' + exe + '" NODE_SEA_BLOB "' + blob + '" --sentinel-fuse ' + fuse,
  { stdio: 'inherit', cwd: root, shell: true },
)

console.log('打包完成: ' + exe)
