/**
 * Host half of the completion-notifier bundle.
 *
 * A conversation turn commits `turn/end` with reason `completed` when the user's
 * request is finished; for a top-level Agent (the user-visible Session) the
 * plugin then runs `notify-windows.ps1`, which shows a Windows toast and plays a
 * short chime. Subagent and teammate Agents are ignored by default so only
 * conversations the user started notify.
 *
 * @module @local/completion-notifier
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HELPER_PATH = fileURLToPath(new URL('./notify-windows.ps1', import.meta.url))
const POWERSHELL_PATH = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)
const DEFAULT_SOUND_FILE = 'C:\\Windows\\Media\\notify.wav'
const FALLBACK_LOG_PATH = join(tmpdir(), 'dsh-completion-notifier.log')

const DEFAULTS = {
  /** Master switch for the whole plugin. */
  enabled: true,
  /** Show a Windows toast notification. */
  toast: true,
  /** Play a chime through the bundled PowerShell helper. */
  sound: true,
  /** WAV file played as the completion chime. */
  soundFile: DEFAULT_SOUND_FILE,
  /** Silence the toast's own system sound so only the chime is heard. */
  muteToastSound: true,
  /** AppUserModelId the toast is attributed to (registered Start-menu app id). */
  aumid: 'com.deepseek.dsh',
  /** Notify only for top-level Agents, not subagents or teammates. */
  onlyRootAgents: true,
  /** Minimum gap between two notifications, in milliseconds. */
  minIntervalMs: 1500,
  /** Toast headline. Supports {duration} {session} {time} {topic}. */
  title: '任务完成',
  /** Toast body. Supports {duration} {session} {time} {topic}. */
  body: '对话已完成，可以回来查看了 · 用时 {duration}',
  /** Append each helper result to this file; empty disables the result log. */
  logFile: '',
}

/** Services that must be present before this plugin activates. */
export const inject = ['agents']

/**
 * Register the turn-completion listeners.
 * @param ctx - the plugin context.
 * @param config - the Loader row config, merged over {@link DEFAULTS}.
 */
export function apply(ctx, config) {
  const settings = resolveConfig(config)
  if (!settings.enabled) return

  /** Session id -> timestamp of its current turn, for the `{duration}` token. */
  const turnStartedAt = new Map()
  let lastNotifiedAt = 0

  const isTopLevel = (agent) => {
    if (!settings.onlyRootAgents) return true
    try {
      const roots = ctx.agents.roots()
      if (roots.length === 0) return true
      return roots.includes(agent)
    } catch (error) {
      warn(ctx, `root-agent lookup failed: ${describe(error)}`)
      return true
    }
  }

  const topicOf = (session) => {
    try {
      const snapshot = session ? ctx.sessionTitle?.get?.(session) : undefined
      const title = snapshot && typeof snapshot === 'object' ? snapshot.title : undefined
      return typeof title === 'string' ? title.trim() : ''
    } catch {
      return ''
    }
  }

  const notify = (session, event, startedAt) => {
    const now = Date.now()
    if (now - lastNotifiedAt < settings.minIntervalMs) return
    lastNotifiedAt = now

    const durationMs =
      typeof startedAt === 'number' && typeof event?.time === 'number'
        ? Math.max(0, event.time - startedAt)
        : undefined
    const tokens = {
      duration: durationMs === undefined ? '' : formatDuration(durationMs),
      session: typeof session?.id === 'string' ? session.id.slice(0, 8) : '',
      time: formatClock(now),
      topic: topicOf(session),
    }

    let body = renderTemplate(settings.body, tokens)
    if (tokens.duration === '') body = body.replace(/\s*·\s*用时\s*$/, '')
    body = body.trim()
    if (body === '') body = '对话已完成，可以回来查看了'

    const title = renderTemplate(settings.title, tokens).trim() || DEFAULTS.title
    launchHelper(ctx, settings, title, body)
  }

  // `turn/end` is the durable close of one user request: reason `completed` is
  // a finished answer, while aborted/interrupted/error/max-tokens are not.
  ctx.on('session/event', (session, event) => {
    if (!session || !event) return
    if (event.type === 'turn/start') {
      turnStartedAt.set(session.id, event.time)
      return
    }
    if (event.type !== 'turn/end') return
    const startedAt = turnStartedAt.get(session.id)
    turnStartedAt.delete(session.id)
    if (event.data?.reason?.kind !== 'completed') return
    const agent = ctx.agents.get(session.id)
    if (!agent) return
    if (!isTopLevel(agent)) return
    notify(session, event, startedAt)
  })

  ctx.on('session/disposed', (session) => {
    if (session) turnStartedAt.delete(session.id)
  })
}

/**
 * Fire the PowerShell helper and forget it. A notification must never delay the
 * turn-closing path, so the child is detached and its output ignored.
 */
function launchHelper(ctx, settings, title, body) {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    HELPER_PATH,
    '-TitleB64',
    encodeBase64(title),
    '-BodyB64',
    encodeBase64(body),
    '-Aumid',
    settings.aumid,
    '-SoundPath',
    settings.sound ? settings.soundFile : '',
    '-SoundFallbackPath',
    settings.sound ? DEFAULT_SOUND_FILE : '',
    '-MuteToastSound',
    settings.muteToastSound ? '1' : '0',
    '-Toast',
    settings.toast ? '1' : '0',
    '-LogPath',
    settings.logFile,
  ]

  let child
  try {
    child = spawn(POWERSHELL_PATH, args, {
      stdio: 'ignore',
      windowsHide: true,
    })
  } catch (error) {
    logFailure(settings, `spawn failed: ${describe(error)}`)
    return
  }
  child.on('error', (error) => logFailure(settings, `helper error: ${describe(error)}`))
  child.unref()
}

/** Merge the row config over the defaults, tolerating odd values. */
function resolveConfig(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const settings = { ...DEFAULTS, ...raw }
  if (!Number.isFinite(settings.minIntervalMs) || settings.minIntervalMs < 0) {
    settings.minIntervalMs = DEFAULTS.minIntervalMs
  }
  for (const key of ['enabled', 'toast', 'sound', 'muteToastSound', 'onlyRootAgents']) {
    if (typeof settings[key] !== 'boolean') settings[key] = DEFAULTS[key]
  }
  for (const key of ['soundFile', 'aumid', 'title', 'body', 'logFile']) {
    if (typeof settings[key] !== 'string') settings[key] = DEFAULTS[key]
  }
  return settings
}

/** Replace `{token}` placeholders; unknown tokens stay verbatim. */
function renderTemplate(template, tokens) {
  return String(template).replace(/\{([a-zA-Z]+)\}/g, (match, key) =>
    Object.hasOwn(tokens, key) ? tokens[key] : match,
  )
}

/** Human-readable Chinese duration for the `{duration}` token. */
function formatDuration(milliseconds) {
  const totalSeconds = Math.max(1, Math.round(milliseconds / 1000))
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${restMinutes} 分`
}

/** `HH:mm:ss` for the `{time}` token, independent of the machine locale. */
function formatClock(timestamp) {
  const date = new Date(timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function encodeBase64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64')
}

function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

function warn(ctx, message) {
  try {
    ctx.logger?.warn?.(`[completion-notifier] ${message}`)
  } catch {
    // Logging must never break the notification path.
  }
}

/** Record helper failures for later diagnosis; never throw. */
function logFailure(settings, message) {
  try {
    const file = settings.logFile || FALLBACK_LOG_PATH
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    // A broken log must not surface into the agent loop.
  }
}
