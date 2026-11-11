import type { GraphEdgeType, KnowledgeEntityType } from '../../shared/contracts/graph-view.js';

/** Textos en español para los valores internos del núcleo; la UI nunca muestra el código crudo si hay traducción. */
const human=(value:string)=>value.toLowerCase().replaceAll('_',' ').replace(/^./,first=>first.toUpperCase());
const pick=(map:Record<string,string>)=>(value:string|null|undefined)=>value?map[value]??human(value):'—';

export const ENTITY_LABEL:Record<KnowledgeEntityType,string>={PROJECT_ROOT:'Proyecto',MODULE:'Módulo',FEATURE:'Feature',REQUIREMENT:'Requisito',WORK_ITEM:'Tarea',MILESTONE:'Hito',DECISION_RECORD:'Decisión',ARTIFACT:'Documento',CODE_REFERENCE:'Código'};
export const entityLabel=pick(ENTITY_LABEL);

export const EDGE_LABEL:Record<GraphEdgeType,string>={DEPENDS_ON:'depende de',IMPLEMENTS:'implementa',SATISFIES:'satisface',AFFECTS:'afecta a',SUPERSEDES:'reemplaza a',DOCUMENTED_BY:'documentado en',VERIFIED_BY:'verificado por',TOUCHES_CODE:'toca código',MODIFIES:'modifica',GENERATED_BY:'generado por',SCOPED_IN:'pertenece a'};
export const edgeLabel=pick(EDGE_LABEL);
/** La misma relación leída desde el otro extremo («A depende de B» → en B: «requerida por A»). */
export const inverseEdgeLabel=pick({DEPENDS_ON:'requerida por',IMPLEMENTS:'implementado por',SATISFIES:'satisfecho por',AFFECTS:'afectado por',SUPERSEDES:'reemplazado por',DOCUMENTED_BY:'documenta a',VERIFIED_BY:'verifica a',TOUCHES_CODE:'tocado por',MODIFIES:'modificado por',GENERATED_BY:'generó',SCOPED_IN:'contiene'});
export const capitalize=(text:string)=>text.replace(/^./,first=>first.toUpperCase());

/** Estado de una entidad del grafo (tareas, features, módulos…). */
export const statusLabel=pick({DRAFT:'Borrador',READY:'Lista',IN_PROGRESS:'En curso',IN_REVIEW:'En revisión',DONE:'Hecha',BLOCKED:'Bloqueada',ARCHIVED:'Archivada',REMOVED:'Eliminada',ACTIVE:'Activo',GHOST:'Propuesta'});
/** Estado de una ejecución de agente. */
export const executionStatusLabel=pick({QUEUED:'En cola',PREPARING_CONTEXT:'Preparando contexto',RUNNING:'En marcha',AWAITING_APPROVAL:'Esperando tu aprobación',VALIDATING:'Verificando',COMPLETED:'Terminada',FAILED:'Falló',CANCELLED:'Cancelada',SUCCEEDED:'Terminada'});
/** Estado de una propuesta de cambios al plan. */
export const changeSetStatusLabel=pick({PENDING_APPROVAL:'Pendiente',VALIDATED:'Lista para aplicar',CONFLICTED:'Con conflictos',APPLIED:'Aplicada',REJECTED:'Rechazada'});
export const provenanceLabel=pick({USER:'creada a mano',CHANGESET:'de una propuesta',EXECUTION:'de una ejecución'});
export const fileChangeLabel=pick({ADDED:'Nuevo',MODIFIED:'Modificado',DELETED:'Eliminado',RENAMED:'Renombrado',A:'Nuevo',M:'Modificado',D:'Eliminado',R:'Renombrado'});
export const sourceTypeLabel=pick({POLICY:'Política',ADR:'Decisión',REQUIREMENT:'Requisito',SPECIFICATION:'Especificación',WORK_ITEM:'Tarea',CODE_FILE:'Código',DOC:'Documento',CHAT_NOTE:'Nota'});
export const retrievalLabel=pick({FOCUS_NODE:'elemento elegido',HIERARCHY_PARENT:'elemento padre',GRAPH_EDGE:'relación del grafo',FULL_TEXT_SEARCH:'búsqueda de texto',SEMANTIC_SEARCH:'búsqueda semántica'});
export const exclusionLabel=pick({TOKEN_BUDGET_EXCEEDED:'no cabe en el presupuesto',SUPERSEDED_DECISION:'decisión reemplazada',LOW_RELEVANCE_SCORE:'poco relevante',DRIFTED_UNVERIFIED:'cambió fuera de la app'});
export const AUTHORITY_TIER:Record<number,string>={1:'reglas y convenciones',2:'decisiones',3:'especificación y jerarquía',4:'código',5:'historial de tareas'};
export const authorityLabel=(tier:number)=>`Nivel de autoridad ${tier}${AUTHORITY_TIER[tier]?` · ${AUTHORITY_TIER[tier]}`:''}`;
export const eventLabel=pick({SESSION_INITIALIZED:'Sesión iniciada',TEXT_DELTA:'Mensaje',TOOL_INVOCATION_STARTED:'Herramienta',TOOL_INVOCATION_FINISHED:'Resultado',FILE_TOUCHED:'Archivo',EXECUTION_FINISHED:'Terminada',EXECUTION_FAILED:'Error',ACTION_DENIED:'Acción denegada',RATE_LIMIT_UPDATED:'Límite de uso',APPROVAL_REQUIRED:'Pide aprobación',APPROVAL_RESOLVED:'Aprobación resuelta'});
export const operationLabel=pick({CREATE_MODULE:'Crear módulo',CREATE_FEATURE:'Crear feature',CREATE_REQUIREMENT:'Crear requisito',CREATE_WORK_ITEM:'Crear tarea',CREATE_DECISION_RECORD:'Registrar decisión',UPSERT_ARTIFACT:'Crear o actualizar documento',CREATE_RELATIONSHIP:'Relacionar',UPDATE_ENTITY:'Modificar',UPDATE_STATUS:'Cambiar estado',ARCHIVE_ENTITY:'Archivar'});
/** «12 nov, 10:04» o '' si la fecha no se puede leer. */
export const shortDate=(value:string|null|undefined)=>{const time=value?Date.parse(value):Number.NaN;return Number.isNaN(time)?'':new Date(time).toLocaleString('es',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});};
