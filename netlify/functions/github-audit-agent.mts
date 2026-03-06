import type { Config, Context } from '@netlify/functions'

type Severity = 'critical' | 'high' | 'medium' | 'low'
type Decision = 'approve' | 'approve_with_conditions' | 'block'

type HeuristicFinding = {
  severity: Severity
  category: string
  title: string
  details: string
  file?: string
  evidence?: string
  remediation: string
}

type RepoAnalysis = {
  repository: string
  defaultBranch: string
  sampledFiles: number
  sampledBytes: number
  heuristicFindings: HeuristicFinding[]
  aiAssessment?: {
    decision: Decision
    summary: string
    findings: HeuristicFinding[]
    costLatencyActions: string[]
    complianceNotes: string[]
    confidence: number
  }
  finalDecision: Decision
  blockedReasons: string[]
}

type GitHubRepo = {
  name: string
  full_name: string
  default_branch: string
  pushed_at: string
  private: boolean
}

type RepoTreeEntry = {
  path: string
  type: 'blob' | 'tree'
  size?: number
  sha: string
}

const DEFAULT_USER = 'pgcarvalheira86'
const DEFAULT_MAX_REPOS = 100
const DEFAULT_FILE_LIMIT = 10
const MAX_FILE_BYTES = 50_000
const MAX_SNIPPET_CHARS = 3_200
const MAX_TOTAL_PROMPT_CHARS = 18_000
const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.sql',
  '.yml',
  '.yaml',
  '.json',
  '.toml',
  '.html',
  '.css',
  '.md',
  '.sh',
  '.dockerfile',
])

const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /AKIA[0-9A-Z]{16}/g, label: 'AWS access key candidate' },
  { pattern: /(?:api|secret|token|password|passwd)\s*[:=]\s*['"][^'"]{10,}['"]/gi, label: 'Hardcoded secret pattern' },
  { pattern: /-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/g, label: 'Private key material' },
  { pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/g, label: 'Slack token candidate' },
  { pattern: /ghp_[0-9A-Za-z]{30,}/g, label: 'GitHub token candidate' },
]

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  })
}

function getEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : undefined
}

function extFromPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('dockerfile')) return '.dockerfile'
  const dot = lower.lastIndexOf('.')
  return dot >= 0 ? lower.slice(dot) : ''
}

function scorePath(path: string): number {
  const lower = path.toLowerCase()
  let score = 0
  if (lower.includes('package.json')) score += 15
  if (lower.includes('dockerfile')) score += 12
  if (lower.includes('netlify.toml')) score += 12
  if (lower.includes('requirements')) score += 10
  if (lower.includes('pom.xml')) score += 10
  if (lower.includes('build.gradle')) score += 10
  if (lower.includes('src/')) score += 7
  if (lower.includes('/api/')) score += 7
  if (lower.includes('/auth')) score += 7
  if (lower.includes('/config')) score += 6
  if (lower.includes('/infra') || lower.includes('/terraform')) score += 6
  if (lower.includes('/test') || lower.includes('.test.') || lower.includes('.spec.')) score -= 2
  return score
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n/* truncated */` : value
}

function redactLikelySecrets(content: string): string {
  let redacted = content
  for (const rule of SECRET_PATTERNS) {
    rule.pattern.lastIndex = 0
    redacted = redacted.replace(rule.pattern, '[REDACTED_SECRET]')
  }
  return redacted
}

function heuristicAudit(path: string, content: string): HeuristicFinding[] {
  const findings: HeuristicFinding[] = []
  const lower = content.toLowerCase()

  for (const rule of SECRET_PATTERNS) {
    rule.pattern.lastIndex = 0
    if (rule.pattern.test(content)) {
      findings.push({
        severity: 'critical',
        category: 'security',
        title: 'Potential secret exposure',
        details: `${rule.label} detected in repository content.`,
        file: path,
        remediation: 'Remove the secret from source control, rotate credentials, and use environment variables or a secrets manager.',
      })
    }
  }

  if (/(eval\(|new Function\(|exec\()/i.test(content)) {
    findings.push({
      severity: 'high',
      category: 'security',
      title: 'Dangerous dynamic execution pattern',
      details: 'Dynamic code or shell execution can increase injection risk.',
      file: path,
      remediation: 'Use validated allow-lists and safer alternatives to dynamic execution.',
    })
  }

  if (/(console\.log\(|print\()/i.test(content) && /(token|secret|password|auth)/i.test(content)) {
    findings.push({
      severity: 'high',
      category: 'security',
      title: 'Potential sensitive logging',
      details: 'Logging statements near credential terms were detected.',
      file: path,
      remediation: 'Avoid logging secrets and use structured redaction for operational logs.',
    })
  }

  if (/\bTODO\b|\bHACK\b|\bFIXME\b/.test(content)) {
    findings.push({
      severity: 'low',
      category: 'quality',
      title: 'Unresolved implementation marker',
      details: 'TODO/HACK/FIXME marker found in audited files.',
      file: path,
      remediation: 'Track unresolved markers in issue management and clean before production release.',
    })
  }

  if (path.endsWith('package.json') && /"latest"/i.test(content)) {
    findings.push({
      severity: 'medium',
      category: 'cost_latency',
      title: 'Unpinned dependency risk',
      details: 'Version alias "latest" can produce non-deterministic builds and performance regressions.',
      file: path,
      remediation: 'Pin dependency versions and enforce lockfiles in CI.',
    })
  }

  if (path.endsWith('.js') || path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.mjs')) {
    if (lower.includes('for (;;)') || lower.includes('while (true)')) {
      findings.push({
        severity: 'medium',
        category: 'cost_latency',
        title: 'Potential unbounded loop',
        details: 'Long-running or infinite loops can increase runtime cost and latency.',
        file: path,
        remediation: 'Add explicit loop limits, exit guards, and timeout controls.',
      })
    }
  }

  return findings
}

async function fetchJson<T>(url: string, headers: Record<string, string>, timeoutMs = 12000): Promise<T> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub request failed (${res.status}): ${text.slice(0, 280)}`)
  }
  return (await res.json()) as T
}

async function listRepos(user: string, maxRepos: number, headers: Record<string, string>): Promise<GitHubRepo[]> {
  const all: GitHubRepo[] = []
  let page = 1

  while (all.length < maxRepos) {
    const perPage = Math.min(100, maxRepos - all.length)
    const url = `https://api.github.com/users/${encodeURIComponent(user)}/repos?sort=pushed&direction=desc&per_page=${perPage}&page=${page}`
    const repos = await fetchJson<GitHubRepo[]>(url, headers)
    if (repos.length === 0) break
    all.push(...repos.filter((repo) => !repo.private))
    if (repos.length < perPage) break
    page += 1
  }

  return all.slice(0, maxRepos)
}

async function listTree(owner: string, repo: string, branch: string, headers: Record<string, string>): Promise<RepoTreeEntry[]> {
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  const treeData = await fetchJson<{ tree: RepoTreeEntry[] }>(treeUrl, headers)
  return treeData.tree ?? []
}

async function downloadRaw(owner: string, repo: string, branch: string, path: string, headers: Record<string, string>): Promise<string> {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path}`
  const res = await fetch(rawUrl, { headers, signal: AbortSignal.timeout(10000) })
  if (!res.ok) {
    throw new Error(`Unable to download file ${path} (${res.status})`)
  }
  return await res.text()
}

function normalizeDecision(hasCritical: boolean, hasHigh: boolean, aiDecision?: Decision): Decision {
  if (hasCritical) return 'block'
  if (hasHigh) return aiDecision === 'approve' ? 'approve_with_conditions' : aiDecision ?? 'approve_with_conditions'
  return aiDecision ?? 'approve'
}

async function callAiAssessment(model: string, promptPayload: unknown): Promise<RepoAnalysis['aiAssessment']> {
  const apiKey = getEnv('OPENAI_API_KEY')
  const base = getEnv('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1'
  if (!apiKey) {
    return undefined
  }

  const system = [
    'You are a principal software audit agent.',
    'Assess quality, security, compliance, latency, and cost optimization.',
    'Output strict JSON only.',
    'Do not invent files, vulnerabilities, or facts not present in evidence.',
    'Every finding must include an exact evidence snippet copied from provided code.',
    'Treat reputation risk as highest priority.',
  ].join(' ')

  const schema = {
    name: 'repo_audit',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        decision: { type: 'string', enum: ['approve', 'approve_with_conditions', 'block'] },
        summary: { type: 'string' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
              category: { type: 'string' },
              title: { type: 'string' },
              details: { type: 'string' },
              file: { type: 'string' },
              evidence: { type: 'string' },
              remediation: { type: 'string' },
            },
            required: ['severity', 'category', 'title', 'details', 'evidence', 'remediation'],
          },
        },
        costLatencyActions: {
          type: 'array',
          items: { type: 'string' },
        },
        complianceNotes: {
          type: 'array',
          items: { type: 'string' },
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['decision', 'summary', 'findings', 'costLatencyActions', 'complianceNotes', 'confidence'],
    },
  }

  const response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(25_000),
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_schema', json_schema: schema },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(promptPayload) },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`AI gateway call failed (${response.status})`)
  }

  const completion = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const content = completion.choices?.[0]?.message?.content
  if (!content) return undefined
  const parsed = JSON.parse(content) as RepoAnalysis['aiAssessment']
  return parsed
}

function parseBody(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return Promise.resolve({})
  return req.json().catch(() => ({}))
}

function severityRank(severity: Severity): number {
  if (severity === 'critical') return 4
  if (severity === 'high') return 3
  if (severity === 'medium') return 2
  return 1
}

function topFindings(findings: HeuristicFinding[], limit = 15): HeuristicFinding[] {
  return [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)).slice(0, limit)
}

function sanitizeAiFindings(findings: HeuristicFinding[], sampledPaths: Set<string>, sampledCorpus: string): HeuristicFinding[] {
  return findings.map((finding) => {
    const hasFile = typeof finding.file === 'string' && finding.file.trim().length > 0
    const isVerified = hasFile ? sampledPaths.has(finding.file!.trim()) : true
    const hasEvidence = typeof finding.evidence === 'string' && finding.evidence.trim().length > 0
    const evidenceLower = hasEvidence ? finding.evidence!.toLowerCase().trim() : ''
    const evidenceVerified = hasEvidence ? sampledCorpus.includes(evidenceLower) : false

    const needsDowngrade = (!isVerified || !evidenceVerified) && (finding.severity === 'critical' || finding.severity === 'high')
    const detailsSuffix = [
      !isVerified ? 'Evidence for the specific file path was not found in sampled data.' : '',
      !evidenceVerified ? 'Provided evidence snippet was not found in sampled content.' : '',
    ]
      .filter(Boolean)
      .join(' ')

    return {
      ...finding,
      severity: needsDowngrade ? 'medium' : finding.severity,
      file: isVerified ? finding.file : undefined,
      details: detailsSuffix ? `${finding.details} ${detailsSuffix}` : finding.details,
    }
  })
}

async function analyzeRepo(owner: string, repo: GitHubRepo, fileLimit: number, githubHeaders: Record<string, string>, model: string): Promise<RepoAnalysis> {
  const tree = await listTree(owner, repo.name, repo.default_branch, githubHeaders)
  const candidates = tree
    .filter((entry) => entry.type === 'blob')
    .filter((entry) => (entry.size ?? 0) > 0 && (entry.size ?? 0) <= MAX_FILE_BYTES)
    .filter((entry) => ALLOWED_EXTENSIONS.has(extFromPath(entry.path)))
    .sort((a, b) => scorePath(b.path) - scorePath(a.path))
    .slice(0, fileLimit)

  const snippets: Array<{ path: string; snippet: string }> = []
  const findings: HeuristicFinding[] = []
  let sampledBytes = 0
  let totalPromptChars = 0

  for (const entry of candidates) {
    if (totalPromptChars >= MAX_TOTAL_PROMPT_CHARS) break
    try {
      const raw = await downloadRaw(owner, repo.name, repo.default_branch, entry.path, githubHeaders)
      sampledBytes += raw.length
      findings.push(...heuristicAudit(entry.path, raw))
      const cleaned = truncate(redactLikelySecrets(raw), MAX_SNIPPET_CHARS)
      totalPromptChars += cleaned.length
      snippets.push({ path: entry.path, snippet: cleaned })
    } catch {
      findings.push({
        severity: 'low',
        category: 'process',
        title: 'File read skipped',
        details: `A prioritized file could not be downloaded for analysis: ${entry.path}`,
        file: entry.path,
        remediation: 'Ensure repository content is accessible and repeat audit.',
      })
    }
  }

  const promptPayload = {
    objective: 'Audit this repository for publish readiness with strict reputation and compliance standards.',
    repository: repo.full_name,
    defaultBranch: repo.default_branch,
    checkedAt: new Date().toISOString(),
    standards: [
      'Security baseline',
      'Compliance and privacy by design',
      'Performance and latency efficiency',
      'Cloud cost optimization',
      'Maintainability and testability',
    ],
    heuristicFindings: topFindings(findings, 12),
    codeSnippets: snippets,
  }

  let aiAssessment: RepoAnalysis['aiAssessment']
  if (snippets.length > 0) {
    try {
      aiAssessment = await callAiAssessment(model, promptPayload)
    } catch {
      aiAssessment = undefined
    }
  } else {
    findings.push({
      severity: 'low',
      category: 'coverage',
      title: 'Limited sample coverage',
      details: 'No supported source files were sampled from the repository.',
      remediation: 'Expand extension filters or provide explicit file targets for analysis.',
    })
  }

  const sampledPaths = new Set(snippets.map((item) => item.path))
  const sampledCorpus = snippets.map((item) => item.snippet.toLowerCase()).join('\n')
  const safeAiFindings = aiAssessment?.findings ? sanitizeAiFindings(aiAssessment.findings, sampledPaths, sampledCorpus) : []
  const mergedFindings = topFindings([...safeAiFindings, ...findings], 20)
  const hasCritical = mergedFindings.some((finding) => finding.severity === 'critical')
  const hasHigh = mergedFindings.some((finding) => finding.severity === 'high')
  const finalDecision = normalizeDecision(hasCritical, hasHigh, aiAssessment?.decision)

  const blockedReasons = mergedFindings
    .filter((finding) => finding.severity === 'critical' || finding.severity === 'high')
    .slice(0, 5)
    .map((finding) => `${finding.severity.toUpperCase()}: ${finding.title}${finding.file ? ` (${finding.file})` : ''}`)

  return {
    repository: repo.full_name,
    defaultBranch: repo.default_branch,
    sampledFiles: snippets.length,
    sampledBytes,
    heuristicFindings: topFindings(findings, 10),
    aiAssessment: aiAssessment
      ? {
          ...aiAssessment,
          findings: mergedFindings,
        }
      : undefined,
    finalDecision,
    blockedReasons,
  }
}

async function runLimited<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const queue = [...items]
  const results: R[] = []

  async function runOne(): Promise<void> {
    while (queue.length > 0) {
      const next = queue.shift()
      if (!next) return
      const result = await worker(next)
      results.push(result)
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => runOne())
  await Promise.all(workers)
  return results
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method === 'GET') {
    return json({
      name: 'github-audit-agent',
      purpose: 'Audits GitHub repositories for quality, compliance, cost, and latency risks before publication.',
      usage: 'POST JSON with optional keys: githubUsername, maxRepos, fileLimit, model',
      defaultGithubUsername: DEFAULT_USER,
      checkedAt: new Date().toISOString(),
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  const body = await parseBody(req)
  const githubUsername = typeof body.githubUsername === 'string' && body.githubUsername.trim() ? body.githubUsername.trim() : DEFAULT_USER
  const maxReposInput = typeof body.maxRepos === 'number' ? body.maxRepos : DEFAULT_MAX_REPOS
  const fileLimitInput = typeof body.fileLimit === 'number' ? body.fileLimit : DEFAULT_FILE_LIMIT
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : getEnv('AUDIT_MODEL') ?? 'gpt-4o-mini'

  const maxRepos = Math.max(1, Math.min(100, Math.floor(maxReposInput)))
  const fileLimit = Math.max(2, Math.min(20, Math.floor(fileLimitInput)))

  const githubToken = getEnv('GITHUB_TOKEN')
  const githubHeaders: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'liuv-ai-audit-agent',
  }
  if (githubToken) {
    githubHeaders.authorization = `Bearer ${githubToken}`
  }

  let repos: GitHubRepo[]
  try {
    repos = await listRepos(githubUsername, maxRepos, githubHeaders)
  } catch (error) {
    return json(
      {
        error: 'Failed to retrieve repositories from GitHub.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502 },
    )
  }

  if (repos.length === 0) {
    return json(
      {
        githubUsername,
        checkedAt: new Date().toISOString(),
        overallDecision: 'approve_with_conditions',
        summary: 'No public repositories were found for auditing.',
        repos: [],
      },
      { status: 200 },
    )
  }

  const owner = githubUsername
  const repoAnalyses = await runLimited(repos, 3, (repo) => analyzeRepo(owner, repo, fileLimit, githubHeaders, model))

  const overallDecision: Decision = repoAnalyses.some((analysis) => analysis.finalDecision === 'block')
    ? 'block'
    : repoAnalyses.some((analysis) => analysis.finalDecision === 'approve_with_conditions')
      ? 'approve_with_conditions'
      : 'approve'

  const highRiskRepos = repoAnalyses.filter((analysis) => analysis.finalDecision !== 'approve')
  const summary =
    overallDecision === 'approve'
      ? 'All audited repositories met publish standards for reputation, compliance, and engineering quality.'
      : `Audit identified ${highRiskRepos.length} repository(s) requiring remediation before publication.`

  return json({
    githubUsername,
    checkedAt: new Date().toISOString(),
    overallDecision,
    summary,
    policy: {
      reputationFirst: true,
      blockOnCriticalOrHighRisk: true,
      optimizeForCostAndLatency: true,
    },
    modelUsed: model,
    repositoriesAudited: repoAnalyses.length,
    repoResults: repoAnalyses,
    nextActions: [
      'Block publication for repositories marked block.',
      'Create remediation tasks for every high/critical finding.',
      'Re-run this endpoint after fixes and archive reports for compliance evidence.',
    ],
  })
}

export const config: Config = {
  path: '/api/github-audit-agent',
}
