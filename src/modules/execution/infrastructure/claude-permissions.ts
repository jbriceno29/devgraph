import type { AgentRunPolicy } from '../application/ports/agent-adapter-port.js';

/** Hostnames a `WebFetch(domain:…)` rule accepts: plain DNS names, no scheme, port, path or wildcard. */
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Translates the autonomy policy into CLI permission rules.
 * - Only the tools an execution needs are exposed (`--tools`).
 * - Writable paths become `Write(...)`/`Edit(...)` allow rules; read-only and denied paths become deny rules.
 * - Denied paths are also unreadable: `Read(...)` deny rules also block `cat` through Bash.
 * - Without allowlisted commands Bash is removed, because `dontAsk` auto-approves read-only Bash in the cwd.
 * - Plan C1: documentation domains expose `WebFetch` with one `WebFetch(domain:…)` rule each; under `dontAsk` any other
 *   domain is denied (checked with CLI 2.1.318). Without domains the tool is not offered at all.
 * Patterns follow the validator's gitignore-like semantics: a pattern without `/` matches at any depth.
 */
export function buildClaudePermissionArgs(policy: AgentRunPolicy): string[] {
  const commands = policy.allowedCommands
    .map(command => command.trim())
    .filter(command => command && !/[,()]/.test(command));
  const domains = [...new Set((policy.docDomains ?? []).map(domain => domain.trim().toLowerCase()))].filter(domain =>
    HOSTNAME.test(domain),
  );
  const tools = [
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    ...(commands.length ? ['Bash'] : []),
    ...(domains.length ? ['WebFetch'] : []),
  ];
  const allowed = [
    ...policy.writablePaths.flatMap(pattern => [`Write(${toRulePath(pattern)})`, `Edit(${toRulePath(pattern)})`]),
    ...commands.flatMap(command => [`Bash(${command})`, `Bash(${command} *)`]),
    ...domains.map(domain => `WebFetch(domain:${domain})`),
  ];
  const disallowed = [
    ...policy.deniedPaths.flatMap(pattern => [
      `Read(${toRulePath(pattern)})`,
      `Write(${toRulePath(pattern)})`,
      `Edit(${toRulePath(pattern)})`,
    ]),
    ...policy.readonlyPaths.flatMap(pattern => [`Write(${toRulePath(pattern)})`, `Edit(${toRulePath(pattern)})`]),
    ...(commands.length ? [] : ['Bash']),
  ];
  const args = ['--tools', tools.join(',')];
  if (allowed.length) args.push('--allowedTools', allowed.join(','));
  if (disallowed.length) args.push('--disallowedTools', disallowed.join(','));
  return args;
}

function toRulePath(pattern: string): string {
  const trimmed = pattern.trim().replace(/\/+$/, '');
  if (trimmed.includes('/')) return trimmed.replace(/^\/+/, '');
  return `**/${trimmed}`;
}
