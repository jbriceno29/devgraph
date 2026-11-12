import type { AgentCapabilities, AgentProviderId } from '../../domain/agents/models.js';
import { CLAUDE_CODE_CAPABILITIES } from './claude-code-adapter.js';

/** Stored in `provider_connections.config_json`. */
export interface ProviderConnectionConfig {
  authMode?: 'subscription' | 'api_key';
  models?: { planning?: string | null; execution?: string | null; available?: string[] };
}

export interface ProviderDefaults {
  providerKey: AgentProviderId;
  displayName: string;
  adapterVersion: string;
  capabilities: AgentCapabilities;
  executableEnv: string;
  developerProfileName: string;
  connectionConfig: ProviderConnectionConfig;
}

export const PROVIDER_DEFAULTS: Record<'codex' | 'claude-code', ProviderDefaults> = {
  'claude-code': {
    providerKey: 'claude-code',
    displayName: 'Claude Code CLI',
    adapterVersion: '1.0.0',
    capabilities: CLAUDE_CODE_CAPABILITIES,
    executableEnv: 'GRAPHDEV_CLAUDE_PATH',
    developerProfileName: 'Desarrollador Claude Code',
    // Aliases always point at the latest model of each tier, so they survive model releases.
    connectionConfig: {
      authMode: 'subscription',
      models: { planning: 'opus', execution: 'sonnet', available: ['haiku', 'sonnet', 'opus'] },
    },
  },
  codex: {
    providerKey: 'codex',
    displayName: 'Codex CLI',
    adapterVersion: '1.0.0',
    capabilities: {
      supportsResume: false,
      supportsStreaming: true,
      supportsApprovals: false,
      supportsCancellation: true,
      supportsStructuredOutput: true,
      supportsWorktrees: true,
    },
    executableEnv: 'GRAPHDEV_CODEX_PATH',
    developerProfileName: 'Desarrollador Codex',
    connectionConfig: { models: { planning: null, execution: null, available: [] } },
  },
};

export function providerDefaults(providerKey: AgentProviderId): ProviderDefaults {
  if (providerKey === 'opencode') throw new Error('OpenCode todavía no tiene adaptador.');
  return PROVIDER_DEFAULTS[providerKey];
}

export function parseConnectionConfig(json: string | null): ProviderConnectionConfig {
  if (!json) return {};
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object' ? (value as ProviderConnectionConfig) : {};
  } catch {
    return {};
  }
}
