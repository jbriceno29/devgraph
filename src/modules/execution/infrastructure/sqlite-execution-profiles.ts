import type { SqliteDatabase } from '../../../platform/sqlite/database.js';
import type { AgentExecutionProfile } from '../application/ports/agent-execution-port.js';
import type { AgentProviderId } from '../domain/models.js';
import { parseConnectionConfig, providerDefaults } from './provider-catalog.js';
import {
  type ProfileRow,
  defaultPolicyId,
  mapProfile,
  mapProvider,
  seedDefaultPolicy,
} from './sqlite-execution-rows.js';

/** The wired provider, its connection and the DEVELOPER profile of each project (seeded once per process). */
export class SqliteExecutionProfiles {
  private readonly seeded = new Set<string>();
  /** `providerKey` is the adapter wired into this process; its provider and DEVELOPER profile are seeded per project. */
  constructor(
    private readonly db: SqliteDatabase,
    private readonly providerKey: AgentProviderId = 'claude-code',
  ) {}

  listProfiles(projectId: string): AgentExecutionProfile[] {
    this.ensureDefaults(projectId);
    const rows = this.db
      .prepare(`SELECT p.*,v.provider_key,v.display_name,v.adapter_version,v.capabilities_json,c.config_json
      FROM agent_profiles p JOIN agent_providers v ON v.id=p.default_provider_id
      LEFT JOIN provider_connections c ON c.id=v.id||':local'
      WHERE p.project_id=? ORDER BY p.role_key,p.name`)
      .all(projectId) as ProfileRow[];
    return rows.map(row => {
      const config = parseConnectionConfig(row.config_json);
      const available = (config.models?.available ?? []).filter((model): model is string => typeof model === 'string');
      const roleDefault = row.role_key === 'PLANNER' ? config.models?.planning : config.models?.execution;
      return {
        ...mapProfile(row),
        provider: mapProvider(row),
        models: {
          default: typeof roleDefault === 'string' ? roleDefault : null,
          planning: typeof config.models?.planning === 'string' ? config.models.planning : null,
          available,
        },
        connectionConfig: config as Record<string, unknown>,
      };
    });
  }

  findProfile(projectId: string, profileId: string): AgentExecutionProfile | null {
    return this.listProfiles(projectId).find(profile => profile.id === profileId) ?? null;
  }

  setProviderAuthMode(projectId: string, mode: 'subscription' | 'api_key'): void {
    this.ensureDefaults(projectId);
    const providerId = (
      this.db.prepare('SELECT id FROM agent_providers WHERE provider_key=?').get(this.providerKey) as { id: string }
    ).id;
    const row = this.db.prepare('SELECT config_json FROM provider_connections WHERE id=?').get(`${providerId}:local`) as
      | { config_json: string | null }
      | undefined;
    const config = { ...parseConnectionConfig(row?.config_json ?? null), authMode: mode };
    this.db
      .prepare('UPDATE provider_connections SET config_json=? WHERE id=?')
      .run(JSON.stringify(config), `${providerId}:local`);
  }

  /** Seeds the wired provider, its local connection, the default policy and the DEVELOPER profile, once per project per process. */
  ensureDefaults(projectId: string): void {
    if (this.seeded.has(projectId)) return;
    const defaults = providerDefaults(this.providerKey);
    const providerId = `provider:${defaults.providerKey}`;
    const profileId = `${projectId}:profile:developer`;
    const policyId = defaultPolicyId(projectId);
    const now = new Date().toISOString();
    const otherProfileNames = ['codex', 'claude-code']
      .filter(key => key !== defaults.providerKey)
      .map(key => providerDefaults(key as AgentProviderId).developerProfileName);
    this.db
      .transaction(() => {
        this.db
          .prepare(`INSERT INTO agent_providers(id,provider_key,display_name,adapter_version,capabilities_json)
        VALUES(?,?,?,?,?) ON CONFLICT(provider_key) DO UPDATE SET display_name=excluded.display_name,adapter_version=excluded.adapter_version,capabilities_json=excluded.capabilities_json`)
          .run(
            providerId,
            defaults.providerKey,
            defaults.displayName,
            defaults.adapterVersion,
            JSON.stringify(defaults.capabilities),
          );
        const actualProviderId = (
          this.db.prepare('SELECT id FROM agent_providers WHERE provider_key=?').get(defaults.providerKey) as {
            id: string;
          }
        ).id;
        // Keep user-edited config; fill it only when missing.
        this.db
          .prepare(`INSERT INTO provider_connections(id,provider_id,executable_path,config_json,health_status)
        VALUES(?,?,?,?,'UNKNOWN') ON CONFLICT(id) DO UPDATE SET config_json=COALESCE(provider_connections.config_json,excluded.config_json)`)
          .run(
            `${actualProviderId}:local`,
            actualProviderId,
            process.env[defaults.executableEnv] ?? null,
            JSON.stringify(defaults.connectionConfig),
          );
        seedDefaultPolicy(this.db, projectId);
        // Existing projects move to the wired provider; a profile renamed by the user keeps its name.
        this.db
          .prepare(`INSERT INTO agent_profiles(id,project_id,role_key,name,system_instructions,default_provider_id,default_policy_id)
        VALUES(?,?,'DEVELOPER',?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET default_provider_id=excluded.default_provider_id,default_policy_id=COALESCE(agent_profiles.default_policy_id,excluded.default_policy_id),
          name=CASE WHEN agent_profiles.name IN (SELECT value FROM json_each(?)) THEN excluded.name ELSE agent_profiles.name END`)
          .run(
            profileId,
            projectId,
            defaults.developerProfileName,
            'Implementa el WorkItem seleccionado siguiendo estrictamente su ContextSnapshot, los criterios de aceptación y las políticas del proyecto. Mantén el alcance acotado a la tarea. No reveles credenciales ni alteres configuración local.',
            actualProviderId,
            policyId,
            JSON.stringify(otherProfileNames),
          );
        this.db
          .prepare('UPDATE provider_connections SET last_checked_at=COALESCE(last_checked_at,?) WHERE id=?')
          .run(now, `${actualProviderId}:local`);
      })
      .immediate();
    this.seeded.add(projectId);
  }
}
